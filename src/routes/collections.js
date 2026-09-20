/**
 * 業務資料的 REST 端點。
 *
 * 五套子系統共用同一組泛型端點，集合代碼即路徑第一段：
 *   GET    /api/v1/collections/:collection          列出
 *   POST   /api/v1/collections/:collection          建立（可請系統配號）
 *   GET    /api/v1/collections/:collection/:id      取單筆
 *   PUT    /api/v1/collections/:collection/:id      更新（帶 version 樂觀鎖）
 *   DELETE /api/v1/collections/:collection/:id      軟刪除
 *
 * 另有 /bootstrap 供用戶端啟動時一次取回整棵資料樹，
 * 以及 /sync 供前端把一批異動一次送出（減少往返次數）。
 */
import { COLLECTIONS, isCollection } from '../lib/collections.js';
import {
  listRecords, getRecord, createRecord, updateRecord, deleteRecord,
  nextId, snapshotAll, versionMap,
} from '../lib/records.js';
import { computeDashboard } from '../lib/dashboard.js';
import { allSettings, getSetting, setSetting } from '../lib/settings.js';
import { SETTING_KEYS } from '../lib/collections.js';
import { assertCanMutate } from '../middleware/rbac.js';
import { audit, diffFields, reqMeta } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { getDb } from '../db/index.js';

const collParam = {
  type: 'object',
  required: ['collection'],
  properties: { collection: { type: 'string', enum: Object.keys(COLLECTIONS) } },
};

const assertColl = name => {
  if (!isCollection(name)) throw notFound(`未知的集合：${name}`);
  return COLLECTIONS[name];
};

export default async function collectionRoutes(app) {
  /* ---------- 啟動載入：一次取回整棵樹 ---------- */
  app.get('/bootstrap', async req => {
    if (!req.user) throw unauthorized();
    const db = getDb();
    return {
      data: snapshotAll(),
      versions: versionMap(),
      dashboard: computeDashboard(),
      settings: {
        ttpHidden: getSetting(SETTING_KEYS.ttpHidden, {}),
      },
      users: db
        .prepare(
          `SELECT id, name, role, perm, disabled, must_change_pw, locked_until,
                  pw_hash IS NOT NULL AS has_pw, last_login_at
           FROM users ORDER BY id`,
        )
        .all()
        .map(u => ({
          id: u.id, name: u.name, role: u.role, perm: u.perm,
          disabled: Boolean(u.disabled),
          mustChangePassword: Boolean(u.must_change_pw),
          hasPassword: Boolean(u.has_pw),
          locked: Boolean(u.locked_until && u.locked_until > new Date().toISOString()),
          lastLoginAt: u.last_login_at,
        })),
      me: {
        id: req.user.id, name: req.user.name, role: req.user.role, perm: req.user.perm,
      },
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/dashboard', async req => {
    if (!req.user) throw unauthorized();
    return computeDashboard();
  });

  /* ---------- 熱圖顯示設定 ---------- */
  app.get('/settings', async req => {
    if (!req.user) throw unauthorized();
    return allSettings();
  });

  app.put('/settings/ttp-hidden', async req => {
    if (!req.user) throw unauthorized();
    const value = req.body && typeof req.body === 'object' ? req.body : {};
    setSetting(SETTING_KEYS.ttpHidden, value, req.user.id);
    audit({ ...reqMeta(req), action: 'settings_update', summary: '更新 TTP 顯示設定' });
    broadcast('settings', { key: 'ttpHidden' }, req.user.id);
    return { ok: true };
  });

  /* ---------- 列表 ---------- */
  app.get('/collections/:collection', { schema: { params: collParam } }, async req => {
    if (!req.user) throw unauthorized();
    assertColl(req.params.collection);
    const rows = listRecords(req.params.collection);
    const { owner, limit, offset } = req.query || {};
    let out = rows;
    if (owner) out = out.filter(r => (r.data.analyst ?? r.data.applicant) === owner);
    const start = Number.parseInt(offset ?? '0', 10) || 0;
    const size = Math.min(Number.parseInt(limit ?? '0', 10) || out.length, 1000);
    return {
      total: out.length,
      items: out.slice(start, start + size).map(r => ({
        id: r.id, version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy, data: r.data,
      })),
    };
  });

  /* ---------- 單筆 ---------- */
  app.get('/collections/:collection/:id', { schema: { params: collParam } }, async req => {
    if (!req.user) throw unauthorized();
    assertColl(req.params.collection);
    const row = getRecord(req.params.collection, req.params.id);
    if (!row) throw notFound();
    return row;
  });

  /* ---------- 建立 ---------- */
  app.post('/collections/:collection', { schema: { params: collParam } }, async (req, reply) => {
    if (!req.user) throw unauthorized();
    const name = req.params.collection;
    const cfg = assertColl(name);
    const body = req.body || {};
    if (!body.data || typeof body.data !== 'object') {
      throw badRequest('缺少 data 欄位', 'missing_data');
    }

    let id = body.id ?? body.data.id;
    if (!id) {
      if (!cfg.idPrefix) throw badRequest(`${name} 需自行指定 id`, 'missing_id');
      id = nextId(name, cfg.idPrefix);
    }
    id = String(id);
    const data = { ...body.data, id };

    // 分析員建立的紀錄，擁有者一律記為本人，不接受前端指定他人
    if (req.user.perm === 'analyst') {
      if ('analyst' in data) data.analyst = req.user.id;
      if ('applicant' in data) data.applicant = req.user.id;
    }

    const rec = createRecord(name, id, data, req.user.id);
    audit({
      ...reqMeta(req), action: 'create', collection: name, recordId: id,
      summary: `建立${cfg.label} ${id}`, changes: diffFields({}, data),
    });
    broadcast('record', { collection: name, id, op: 'create', version: rec.version }, req.user.id);
    return reply.code(201).send(rec);
  });

  /* ---------- 更新 ---------- */
  app.put('/collections/:collection/:id', { schema: { params: collParam } }, async req => {
    if (!req.user) throw unauthorized();
    const name = req.params.collection;
    const cfg = assertColl(name);
    const id = req.params.id;
    const body = req.body || {};
    if (!body.data || typeof body.data !== 'object') {
      throw badRequest('缺少 data 欄位', 'missing_data');
    }

    const current = getRecord(name, id);
    if (!current) throw notFound();

    // detail 類集合本身沒有擁有者欄位，改看母紀錄
    const ownerSource = cfg.parent ? getRecord(cfg.parent, id)?.data : current.data;
    assertCanMutate(req.user, ownerSource, `${cfg.label} ${id}`);

    const data = { ...body.data, id };
    const { before, after } = updateRecord(
      name, id, data, req.user.id,
      body.version === undefined ? null : body.version,
    );
    audit({
      ...reqMeta(req), action: 'update', collection: name, recordId: id,
      summary: `更新${cfg.label} ${id}`, changes: diffFields(before.data, after.data),
    });
    broadcast('record', { collection: name, id, op: 'update', version: after.version }, req.user.id);
    return after;
  });

  /* ---------- 刪除 ---------- */
  app.delete('/collections/:collection/:id', { schema: { params: collParam } }, async req => {
    if (!req.user) throw unauthorized();
    const name = req.params.collection;
    const cfg = assertColl(name);
    const id = req.params.id;
    const current = getRecord(name, id);
    if (!current) throw notFound();

    const ownerSource = cfg.parent ? getRecord(cfg.parent, id)?.data : current.data;
    assertCanMutate(req.user, ownerSource, `${cfg.label} ${id}`);

    deleteRecord(name, id, req.user.id);
    audit({
      ...reqMeta(req), action: 'delete', collection: name, recordId: id,
      summary: `刪除${cfg.label} ${id}`,
    });
    broadcast('record', { collection: name, id, op: 'delete' }, req.user.id);
    return { ok: true };
  });

  /* ---------- 批次同步 ---------- */
  /**
   * 前端把一次操作產生的多筆異動一起送出（例如建立案件會同時寫入
   * cases 與 case_detail）。逐筆處理並回報個別結果，
   * 其中一筆衝突不會讓整批失敗。
   */
  app.post('/sync', async req => {
    if (!req.user) throw unauthorized();
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : null;
    if (!ops) throw badRequest('缺少 ops 陣列', 'missing_ops');
    if (ops.length > 500) throw badRequest('單次同步上限 500 筆', 'too_many_ops');

    const results = [];
    for (const op of ops) {
      try {
        const name = op.collection;
        const cfg = assertColl(name);
        const id = String(op.id);

        if (op.op === 'delete') {
          const current = getRecord(name, id);
          if (!current) { results.push({ id, collection: name, ok: true, skipped: 'not_found' }); continue; }
          const ownerSource = cfg.parent ? getRecord(cfg.parent, id)?.data : current.data;
          assertCanMutate(req.user, ownerSource, `${cfg.label} ${id}`);
          deleteRecord(name, id, req.user.id);
          audit({
            ...reqMeta(req), action: 'delete', collection: name, recordId: id,
            summary: `刪除${cfg.label} ${id}`,
          });
          broadcast('record', { collection: name, id, op: 'delete' }, req.user.id);
          results.push({ id, collection: name, ok: true, op: 'delete' });
          continue;
        }

        const data = { ...op.data, id };
        const existing = getRecord(name, id);
        if (existing) {
          const ownerSource = cfg.parent ? getRecord(cfg.parent, id)?.data : existing.data;
          assertCanMutate(req.user, ownerSource, `${cfg.label} ${id}`);
          const { before, after } = updateRecord(
            name, id, data, req.user.id,
            op.version === undefined ? null : op.version,
          );
          audit({
            ...reqMeta(req), action: 'update', collection: name, recordId: id,
            summary: `更新${cfg.label} ${id}`, changes: diffFields(before.data, after.data),
          });
          broadcast('record', { collection: name, id, op: 'update', version: after.version }, req.user.id);
          results.push({ id, collection: name, ok: true, op: 'update', version: after.version });
        } else {
          if (req.user.perm === 'analyst') {
            if ('analyst' in data) data.analyst = req.user.id;
            if ('applicant' in data) data.applicant = req.user.id;
          }
          const rec = createRecord(name, id, data, req.user.id);
          audit({
            ...reqMeta(req), action: 'create', collection: name, recordId: id,
            summary: `建立${cfg.label} ${id}`, changes: diffFields({}, data),
          });
          broadcast('record', { collection: name, id, op: 'create', version: rec.version }, req.user.id);
          results.push({ id, collection: name, ok: true, op: 'create', version: rec.version });
        }
      } catch (err) {
        results.push({
          id: op?.id, collection: op?.collection, ok: false,
          code: err.code || 'error', message: err.message,
          details: err.details,
        });
      }
    }

    return {
      results,
      failed: results.filter(r => !r.ok).length,
      dashboard: computeDashboard(),
    };
  });

  /** 配號：前端在開新表單時先取得編號，避免多人同時建立撞號。 */
  app.get('/next-id/:collection', { schema: { params: collParam } }, async req => {
    if (!req.user) throw unauthorized();
    const cfg = assertColl(req.params.collection);
    if (!cfg.idPrefix) throw badRequest(`${req.params.collection} 不使用自動編號`, 'no_prefix');
    return { id: nextId(req.params.collection, cfg.idPrefix) };
  });
}
