/**
 * 會話管理。
 *
 * Cookie 只帶隨機 token，資料庫存的是該 token 的 SHA-256——即使資料庫外流
 * 也無法反推出可用的 Cookie。同時採「閒置逾時」與「絕對逾時」雙重限制。
 * 另發一組 CSRF token，寫入類請求需於標頭帶回。
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { nowIso, plusHours, plusMinutes } from '../lib/time.js';

const sha256 = v => createHash('sha256').update(v).digest('hex');
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const COOKIE = config.auth.cookieName;
export const CSRF_HEADER = 'x-btms-csrf';

export function createSession(userId, { ip, userAgent } = {}) {
  const db = getDb();
  const raw = token();
  const csrf = token(24);
  const now = nowIso();
  const idleUntil = plusMinutes(config.auth.sessionIdleMinutes);
  const absUntil = plusHours(config.auth.sessionAbsoluteHours);
  const expires = idleUntil < absUntil ? idleUntil : absUntil;

  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sha256(raw), userId, csrf, now, now, expires, ip || null, (userAgent || '').slice(0, 400));

  return { token: raw, csrf, expiresAt: expires };
}

/**
 * 驗證 Cookie 並順延閒置逾時。回傳 null 代表未登入或已逾期。
 */
export function resolveSession(rawToken) {
  if (!rawToken) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sha256(rawToken));
  if (!row) return null;

  const now = nowIso();
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }

  const absLimit = plusHours(config.auth.sessionAbsoluteHours, Date.parse(row.created_at));
  if (absLimit <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.disabled) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }

  // 順延閒置逾時，但不得超過絕對逾時
  const nextIdle = plusMinutes(config.auth.sessionIdleMinutes);
  const next = nextIdle < absLimit ? nextIdle : absLimit;
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
    .run(now, next, row.id);

  return { session: { ...row, expires_at: next }, user };
}

export function destroySession(rawToken) {
  if (!rawToken) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(rawToken));
}

/** 變更密碼、停用帳號時把該帳號其他會話一併作廢。 */
export function destroyUserSessions(userId, exceptRawToken = null) {
  const db = getDb();
  if (exceptRawToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .run(userId, sha256(exceptRawToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function purgeExpiredSessions() {
  return getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    maxAge: config.auth.sessionAbsoluteHours * 3600,
  };
}

export function csrfMatches(expected, provided) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
