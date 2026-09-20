/** 整體設定的鍵值存放（熱圖顯示設定、站台名稱等）。 */
import { getDb } from '../db/index.js';
import { nowIso } from './time.js';

export function getSetting(key, dflt = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return dflt;
  try {
    return JSON.parse(row.value);
  } catch {
    return dflt;
  }
}

export function setSetting(key, value, userId = null) {
  getDb().prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(key, JSON.stringify(value), nowIso(), userId);
  return value;
}

export function allSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* 略過毀損值 */ }
  }
  return out;
}
