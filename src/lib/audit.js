/**
 * 稽核紀錄。規格明訂「編輯需登入，帳號即是誰改了什麼的憑據」，
 * 因此所有寫入操作都留痕，並記錄異動欄位的前後值以供追查。
 */
import { getDb } from '../db/index.js';
import { nowIso } from './time.js';
import config from '../config.js';

const MAX_VALUE_CHARS = 2000;

const clip = v => {
  if (v === undefined) return undefined;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return undefined;
  return s.length > MAX_VALUE_CHARS ? s.slice(0, MAX_VALUE_CHARS) + '…（已截斷）' : s;
};

/** 只記錄真正變動的欄位，避免整份文件重複存兩次。 */
export function diffFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = {};
  for (const k of keys) {
    const a = JSON.stringify(before?.[k]);
    const b = JSON.stringify(after?.[k]);
    if (a !== b) out[k] = { from: clip(before?.[k]), to: clip(after?.[k]) };
  }
  return out;
}

export function audit({ userId, action, collection, recordId, summary, ip, userAgent, changes }) {
  try {
    getDb().prepare(
      `INSERT INTO audit (ts, user_id, action, collection, record_id, summary, ip, user_agent, changes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nowIso(), userId || null, action, collection || null, recordId || null,
      summary || null, ip || null, (userAgent || '').slice(0, 400),
      changes && Object.keys(changes).length ? JSON.stringify(changes) : null,
    );
  } catch (err) {
    // 稽核失敗不應讓業務操作連帶失敗，但必須讓維運看得到
    console.error('[audit] 寫入稽核紀錄失敗:', err.message);
  }
}

/** 依保留天數清理舊紀錄；設為 0 表示永久保留。 */
export function purgeAudit() {
  const days = config.log.auditRetentionDays;
  if (!days) return 0;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return getDb().prepare('DELETE FROM audit WHERE ts < ?').run(cutoff).changes;
}

/** 從 Fastify request 取出稽核所需的來源資訊。 */
export const reqMeta = req => ({
  userId: req.user?.id,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});
