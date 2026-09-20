/** 帳號管理。僅系統管理員可用。 */
import { getDb } from '../db/index.js';
import { hashPassword, checkPasswordPolicy } from '../auth/password.js';
import { destroyUserSessions } from '../auth/session.js';
import { requirePerm } from '../middleware/rbac.js';
import { audit, reqMeta } from '../lib/audit.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { broadcast } from '../lib/events.js';
import { listRecords } from '../lib/records.js';

const ROLES = [
  '藍隊隊長', '藍隊副隊長', '網路分析員', '主機分析員',
  '惡意程式分析員', '情資分析員', '系統管理員',
];
const PERMS = ['admin', 'manage', 'analyst'];

const shape = u => ({
  id: u.id,
  name: u.name,
  role: u.role,
  perm: u.perm,
  provider: u.provider,
  disabled: Boolean(u.disabled),
  mustChangePassword: Boolean(u.must_change_pw),
  hasPassword: Boolean(u.pw_hash),
  locked: Boolean(u.locked_until && u.locked_until > nowIso()),
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
});

/** 帳號一旦有留下紀錄就不宜實體刪除，否則稽核與報告作者會斷鏈。 */
function recordsOwnedBy(id) {
  let n = 0;
  for (const coll of ['cases', 'requests', 'assets', 'apts', 'intels', 'hunts']) {
    n += listRecords(coll).filter(r => (r.data.analyst ?? r.data.applicant) === id).length;
  }
  return n;
}

export default async function userRoutes(app) {
  app.addHook('preHandler', requirePerm('admin'));

  app.get('/users', async () => ({
    users: getDb().prepare('SELECT * FROM users ORDER BY id').all().map(shape),
    roles: ROLES,
    perms: PERMS,
  }));

  app.post('/users', async (req, reply) => {
    const { id, name, role, perm, password } = req.body || {};
    const uid = String(id || '').trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(uid)) {
      throw badRequest('帳號需為 2–32 個字元，僅限小寫英數字與 . _ -', 'invalid_id');
    }
    if (!name || !role || !perm) throw badRequest('姓名、職務、權限為必填', 'missing_fields');
    if (!PERMS.includes(perm)) throw badRequest('權限值不正確', 'invalid_perm');

    const db = getDb();
    if (db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid)) {
      throw conflict('此帳號已存在', 'user_exists');
    }

    let hash = null;
    if (password) {
      const policy = checkPasswordPolicy(password, { username: uid, name });
      if (!policy.ok) throw badRequest(policy.reason, 'weak_password');
      hash = await hashPassword(password);
    }

    const now = nowIso();
    db.prepare(
      `INSERT INTO users (id, name, role, perm, pw_hash, provider, must_change_pw,
         disabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'local', 1, ?, ?, ?)`,
    ).run(uid, name, role, perm, hash, hash ? 0 : 1, now, now);

    audit({
      ...reqMeta(req), action: 'user_create', collection: 'users', recordId: uid,
      summary: `建立帳號 ${uid}（${role}／${perm}）${hash ? '' : '，未設定密碼故停用'}`,
    });
    broadcast('users', { op: 'create', id: uid }, req.user.id);
    return reply.code(201).send(shape(db.prepare('SELECT * FROM users WHERE id = ?').get(uid)));
  });

  app.put('/users/:id', async req => {
    const db = getDb();
    const uid = req.params.id;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!u) throw notFound('找不到此帳號');

    const { name, role, perm, disabled, password, unlock } = req.body || {};
    if (perm && !PERMS.includes(perm)) throw badRequest('權限值不正確', 'invalid_perm');

    // 防呆：不得把最後一個啟用中的管理員降權或停用，否則沒人能再進系統
    const admins = db
      .prepare("SELECT COUNT(*) n FROM users WHERE perm = 'admin' AND disabled = 0 AND id != ?")
      .get(uid).n;
    const losingAdmin = u.perm === 'admin' && !u.disabled &&
      ((perm && perm !== 'admin') || disabled === true);
    if (losingAdmin && admins === 0) {
      throw badRequest('系統至少需保留一名啟用中的管理員', 'last_admin');
    }

    const changes = {};
    const set = [];
    const vals = [];
    const put = (col, val, key) => {
      if (val === undefined || val === u[col]) return;
      set.push(`${col} = ?`);
      vals.push(val);
      changes[key || col] = { from: u[col], to: val };
    };
    put('name', name);
    put('role', role);
    put('perm', perm);
    if (disabled !== undefined) put('disabled', disabled ? 1 : 0);

    if (password) {
      const policy = checkPasswordPolicy(password, { username: uid, name: name || u.name });
      if (!policy.ok) throw badRequest(policy.reason, 'weak_password');
      set.push('pw_hash = ?', 'must_change_pw = 1');
      vals.push(await hashPassword(password));
      changes.password = { from: '（未顯示）', to: '（已重設，登入後須變更）' };
    }
    if (unlock) {
      set.push('locked_until = NULL', 'failed_count = 0');
      changes.locked = { from: u.locked_until, to: null };
    }

    if (!set.length) return shape(u);

    set.push('updated_at = ?');
    vals.push(nowIso(), uid);
    db.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...vals);

    // 停用、改權限或重設密碼時，強制該帳號重新登入
    if (disabled || perm || password) destroyUserSessions(uid);

    audit({
      ...reqMeta(req), action: 'user_update', collection: 'users', recordId: uid,
      summary: `變更帳號 ${uid}`, changes,
    });
    broadcast('users', { op: 'update', id: uid }, req.user.id);
    return shape(db.prepare('SELECT * FROM users WHERE id = ?').get(uid));
  });

  app.delete('/users/:id', async req => {
    const db = getDb();
    const uid = req.params.id;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!u) throw notFound('找不到此帳號');
    if (uid === req.user.id) throw badRequest('不能刪除自己的帳號', 'self_delete');

    const admins = db
      .prepare("SELECT COUNT(*) n FROM users WHERE perm = 'admin' AND disabled = 0 AND id != ?")
      .get(uid).n;
    if (u.perm === 'admin' && !u.disabled && admins === 0) {
      throw badRequest('系統至少需保留一名啟用中的管理員', 'last_admin');
    }

    const owned = recordsOwnedBy(uid);
    if (owned > 0) {
      // 有作者關聯就改為停用，保住報告的作者資訊與稽核鏈
      db.prepare('UPDATE users SET disabled = 1, updated_at = ? WHERE id = ?').run(nowIso(), uid);
      destroyUserSessions(uid);
      audit({
        ...reqMeta(req), action: 'user_disable', collection: 'users', recordId: uid,
        summary: `帳號 ${uid} 名下尚有 ${owned} 筆紀錄，改為停用以保留作者資訊`,
      });
      broadcast('users', { op: 'update', id: uid }, req.user.id);
      return { ok: true, disabledInstead: true, ownedRecords: owned };
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    destroyUserSessions(uid);
    audit({
      ...reqMeta(req), action: 'user_delete', collection: 'users', recordId: uid,
      summary: `刪除帳號 ${uid}`,
    });
    broadcast('users', { op: 'delete', id: uid }, req.user.id);
    return { ok: true };
  });

  /** 檢視某帳號目前的登入會話，並可強制登出。 */
  app.get('/users/:id/sessions', async req => {
    const rows = getDb()
      .prepare('SELECT created_at, last_seen_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ?')
      .all(req.params.id);
    return { sessions: rows };
  });

  app.delete('/users/:id/sessions', async req => {
    destroyUserSessions(req.params.id);
    audit({
      ...reqMeta(req), action: 'user_sessions_revoked', collection: 'users',
      recordId: req.params.id, summary: `強制登出帳號 ${req.params.id}`,
    });
    return { ok: true };
  });
}
