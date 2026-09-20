/**
 * SQLite 連線與遷移。
 * WAL 模式讓讀取不被寫入阻塞，30 人並行讀寫綽綽有餘；
 * busy_timeout 讓偶發的寫入競爭自動重試而非直接丟錯。
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

let db = null;

export function getDb() {
  if (db) return db;

  mkdirSync(dirname(config.paths.db), { recursive: true });
  db = new Database(config.paths.db);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

function migrate(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  const applied = new Set(
    conn.prepare('SELECT name FROM schema_migrations').all().map(r => r.name),
  );
  const dir = resolve(here, 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  const record = conn.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    conn.transaction(() => {
      conn.exec(sql);
      record.run(file, new Date().toISOString());
    })();
  }
  return files.length;
}

export function closeDb() {
  if (db) {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* 關閉期間忽略 */ }
    db.close();
    db = null;
  }
}

/** 線上備份：SQLite 原生 backup API，不必停機。 */
export async function backupTo(path) {
  const conn = getDb();
  mkdirSync(dirname(path), { recursive: true });
  await conn.backup(path);
  return path;
}

export default getDb;
