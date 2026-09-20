/**
 * 認證接縫（AuthProvider）。
 *
 * 規格要求「認證內建，但要留有日後接 SSO 的空間」。因此呼叫端一律只看見
 * authenticate() / describe() 兩個方法，不直接碰帳密比對；日後要接
 * Entra ID、Keycloak、Google Workspace 等 IdP，只需在此新增一個 provider，
 * 路由與前端都不必改。
 *
 * 目前內含：
 *   LocalProvider — 內建帳密（argon2id），預設啟用
 *   OidcProvider  — 外部 IdP，由 BTMS_SSO_* 組態啟用
 */
import { randomUUID } from 'node:crypto';
import config from '../config.js';
import { verifyPassword } from './password.js';
import { getDb } from '../db/index.js';
import { nowIso } from '../lib/time.js';

export class AuthError extends Error {
  constructor(code, message, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class LocalProvider {
  constructor() {
    this.id = 'local';
    this.kind = 'password';
  }

  describe() {
    return { id: this.id, kind: this.kind, label: '帳號密碼', enabled: true };
  }

  /**
   * @returns {{user: object}} 驗證成功的使用者
   * @throws {AuthError}
   */
  async authenticate({ username, password, ip }) {
    const db = getDb();
    const uname = String(username || '').trim().toLowerCase();
    const row = db
      .prepare('SELECT * FROM users WHERE id = ? AND provider = ?')
      .get(uname, 'local');

    // 帳號不存在時仍走一次雜湊比對，避免以回應時間推測帳號是否存在
    if (!row) {
      await verifyPassword(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        String(password || ''),
      );
      throw new AuthError('invalid_credentials', '帳號或密碼不正確');
    }

    if (row.disabled) {
      throw new AuthError('account_disabled', '此帳號已停用，請洽系統管理員', 403);
    }

    if (row.locked_until && row.locked_until > nowIso()) {
      throw new AuthError(
        'account_locked',
        `登入失敗次數過多，帳號已鎖定至 ${row.locked_until.slice(11, 16)} UTC`,
        429,
      );
    }

    const ok = await verifyPassword(row.pw_hash, String(password || ''));
    if (!ok) {
      const failed = row.failed_count + 1;
      const lock =
        failed >= config.auth.maxFailedLogins
          ? new Date(Date.now() + config.auth.lockoutMinutes * 60_000).toISOString()
          : null;
      db.prepare(
        'UPDATE users SET failed_count = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      ).run(lock ? 0 : failed, lock, nowIso(), row.id);
      throw new AuthError(
        lock ? 'account_locked' : 'invalid_credentials',
        lock
          ? `登入失敗次數達上限，帳號已鎖定 ${config.auth.lockoutMinutes} 分鐘`
          : '帳號或密碼不正確',
        lock ? 429 : 401,
      );
    }

    db.prepare(
      'UPDATE users SET failed_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    ).run(nowIso(), nowIso(), row.id);

    return { user: row };
  }
}

class OidcProvider {
  constructor(cfg) {
    this.id = 'oidc';
    this.kind = 'redirect';
    this.cfg = cfg;
  }

  describe() {
    return {
      id: this.id,
      kind: this.kind,
      label: '企業 SSO',
      enabled: Boolean(this.cfg.issuer && this.cfg.clientId),
      authorizeUrl: '/api/v1/auth/sso/start',
    };
  }

  /**
   * 授權碼流程的回呼端點在取得 IdP 回傳的 claims 後呼叫此方法，
   * 依 sub 對應到本地帳號；首次登入者自動建檔，權限採組態預設值。
   */
  async upsertFromClaims(claims) {
    const db = getDb();
    const sub = String(claims.sub || '');
    if (!sub) throw new AuthError('sso_no_subject', 'IdP 未提供 sub');

    const existing = db
      .prepare('SELECT * FROM users WHERE provider = ? AND external_id = ?')
      .get('oidc', sub);
    if (existing) {
      if (existing.disabled) {
        throw new AuthError('account_disabled', '此帳號已停用，請洽系統管理員', 403);
      }
      db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .run(nowIso(), nowIso(), existing.id);
      return { user: existing };
    }

    const id = (claims.preferred_username || claims.email || `sso-${randomUUID().slice(0, 8)}`)
      .toString()
      .trim()
      .toLowerCase();
    const now = nowIso();
    db.prepare(
      `INSERT INTO users (id, name, role, perm, pw_hash, provider, external_id,
         must_change_pw, disabled, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, NULL, 'oidc', ?, 0, 0, ?, ?, ?)`,
    ).run(
      id,
      claims.name || claims.preferred_username || id,
      this.cfg.defaultRole,
      this.cfg.defaultPerm,
      sub,
      now,
      now,
      now,
    );
    return { user: db.prepare('SELECT * FROM users WHERE id = ?').get(id) };
  }

  async authenticate() {
    throw new AuthError(
      'sso_redirect_required',
      'SSO 需透過授權碼流程登入，請改用 /api/v1/auth/sso/start',
      400,
    );
  }
}

const local = new LocalProvider();
const oidc = new OidcProvider(config.sso);

/** 依組態回傳目前可用的認證方式，前端據此決定登入畫面要顯示什麼。 */
export function listProviders() {
  const out = [];
  if (!config.sso.enabled || config.sso.allowLocalFallback) out.push(local.describe());
  if (config.sso.enabled) out.push(oidc.describe());
  return out;
}

export function getProvider(id = 'local') {
  if (id === 'oidc') return oidc;
  return local;
}

export { local as localProvider, oidc as oidcProvider };
