/**
 * 紀錄倉儲：records 表的讀寫，含樂觀鎖與編號配發。
 *
 * 原型把整份資料當成一塊 blob 存進 localStorage。正式版最關鍵的差別就在這裡——
 * 每筆紀錄各自獨立寫入並帶版本號，兩位分析員同時編輯不同案件不會互相覆蓋；
 * 編輯同一筆時後到者會收到 409，由前端提示重新載入，而不是無聲蓋掉對方的成果。
 */
import { getDb } from '../db/index.js';
import { nowIso } from './time.js';
import { conflict, notFound, badRequest } from './errors.js';
import { COLLECTIONS, isCollection } from './collections.js';

const parse = row =>
  row && {
    id: row.id,
    collection: row.collection,
    data: JSON.parse(row.data),
    version: row.version,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };

export function listRecords(collection, { includeDeleted = false } = {}) {
  if (!isCollection(collection)) throw badRequest(`未知的集合：${collection}`);
  const sql = includeDeleted
    ? 'SELECT * FROM records WHERE collection = ? ORDER BY rowid'
    : 'SELECT * FROM records WHERE collection = ? AND deleted = 0 ORDER BY rowid';
  return getDb().prepare(sql).all(collection).map(parse);
}

export function getRecord(collection, id, { includeDeleted = false } = {}) {
  if (!isCollection(collection)) throw badRequest(`未知的集合：${collection}`);
  const row = getDb()
    .prepare('SELECT * FROM records WHERE collection = ? AND id = ?')
    .get(collection, id);
  if (!row) return null;
  if (row.deleted && !includeDeleted) return null;
  return parse(row);
}

export function createRecord(collection, id, data, userId) {
  if (!isCollection(collection)) throw badRequest(`未知的集合：${collection}`);
  const db = getDb();
  const now = nowIso();
  const existing = db
    .prepare('SELECT deleted FROM records WHERE collection = ? AND id = ?')
    .get(collection, id);

  if (existing && !existing.deleted) {
    throw conflict(`${collection}/${id} 已存在`, 'already_exists');
  }
  if (existing && existing.deleted) {
    // 同一編號曾被刪除：復用主鍵但版本重新起算
    db.prepare(
      `UPDATE records SET data = ?, version = 1, deleted = 0,
         created_at = ?, created_by = ?, updated_at = ?, updated_by = ?
       WHERE collection = ? AND id = ?`,
    ).run(JSON.stringify(data), now, userId, now, userId, collection, id);
  } else {
    db.prepare(
      `INSERT INTO records (collection, id, data, version, deleted,
         created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)`,
    ).run(collection, id, JSON.stringify(data), now, userId, now, userId);
  }
  return getRecord(collection, id);
}

/**
 * 更新。expectedVersion 為 null 時略過樂觀鎖檢查（供匯入／管理用途）。
 */
export function updateRecord(collection, id, data, userId, expectedVersion = null) {
  const current = getRecord(collection, id);
  if (!current) throw notFound(`${collection}/${id} 不存在`);

  if (expectedVersion !== null && Number(expectedVersion) !== current.version) {
    throw conflict(
      '這筆紀錄已被其他人修改，請重新載入後再儲存',
      'version_conflict',
      { currentVersion: current.version, yourVersion: Number(expectedVersion) },
    );
  }

  getDb().prepare(
    `UPDATE records SET data = ?, version = version + 1, updated_at = ?, updated_by = ?
     WHERE collection = ? AND id = ?`,
  ).run(JSON.stringify(data), nowIso(), userId, collection, id);

  return { before: current, after: getRecord(collection, id) };
}

/** 軟刪除：紀錄留在資料庫中，稽核與還原都還查得到。 */
export function deleteRecord(collection, id, userId) {
  const current = getRecord(collection, id);
  if (!current) throw notFound(`${collection}/${id} 不存在`);
  getDb().prepare(
    `UPDATE records SET deleted = 1, version = version + 1, updated_at = ?, updated_by = ?
     WHERE collection = ? AND id = ?`,
  ).run(nowIso(), userId, collection, id);
  return current;
}

export function restoreRecord(collection, id, userId) {
  const row = getRecord(collection, id, { includeDeleted: true });
  if (!row) throw notFound(`${collection}/${id} 不存在`);
  getDb().prepare(
    `UPDATE records SET deleted = 0, version = version + 1, updated_at = ?, updated_by = ?
     WHERE collection = ? AND id = ?`,
  ).run(nowIso(), userId, collection, id);
  return getRecord(collection, id);
}

/**
 * 配發下一個編號。
 *
 * 原型在瀏覽器端算「目前最大值 +1」，多人同時建立就會撞號。
 * 這裡在單一交易內掃描全集合（含已刪除）取最大值，
 * SQLite 的寫入序列化保證同一時間只有一筆能成功配號。
 */
export function nextId(collection, prefix, pad = 4) {
  const db = getDb();
  const rows = db
    .prepare('SELECT id FROM records WHERE collection = ?')
    .all(collection);
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(pad, '0')}`;
}

export function countRecords(collection) {
  return getDb()
    .prepare('SELECT COUNT(*) n FROM records WHERE collection = ? AND deleted = 0')
    .get(collection).n;
}

/** 一次取回整棵資料樹，供用戶端啟動時載入。 */
export function snapshotAll() {
  const out = {};
  for (const [name, cfg] of Object.entries(COLLECTIONS)) {
    const rows = listRecords(name);
    if (cfg.kind === 'map') {
      out[cfg.clientKey] = Object.fromEntries(rows.map(r => [r.id, r.data]));
    } else {
      out[cfg.clientKey] = rows.map(r => r.data);
    }
  }
  return out;
}

/** 集合 → { id: version }，供用戶端偵測版本衝突。 */
export function versionMap() {
  const rows = getDb()
    .prepare('SELECT collection, id, version FROM records WHERE deleted = 0')
    .all();
  const out = {};
  for (const r of rows) {
    (out[r.collection] ||= {})[r.id] = r.version;
  }
  return out;
}
