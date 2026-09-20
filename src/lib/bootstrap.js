/**
 * 首次啟動初始化：建立管理員帳號，並視組態載入示範資料。
 *
 * 密碼來源依序為：
 *   1. BTMS_ADMIN_PASSWORD 環境變數
 *   2. 皆未設定時自動產生高強度隨機密碼，印在容器日誌中（只印這一次）
 * 兩種情形都會標記為「首次登入強制變更密碼」。
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { hashPassword } from '../auth/password.js';
import { nowIso } from './time.js';
import { audit } from './audit.js';
import { COLLECTIONS } from './collections.js';
import { setSetting, getSetting } from './settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, '../../seed');

/** 產生易於輸入但足夠強的隨機密碼（避免形近字）。 */
function randomPassword(len = 20) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=?';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += abc[bytes[i] % abc.length];
  return out;
}

export async function ensureAdmin(log) {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) n FROM users WHERE perm = 'admin' AND disabled = 0").get().n;
  if (count > 0) return { created: false };

  const id = String(config.auth.bootstrapUser).trim().toLowerCase();
  const generated = !config.auth.bootstrapPassword;
  const password = config.auth.bootstrapPassword || randomPassword();
  const now = nowIso();

  db.prepare(
    `INSERT INTO users (id, name, role, perm, pw_hash, provider, must_change_pw,
       disabled, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', ?, 'local', ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET perm = 'admin', disabled = 0, updated_at = excluded.updated_at`,
  ).run(
    id, '系統管理員', '系統管理員',
    await hashPassword(password),
    config.auth.forcePasswordChange ? 1 : 0,
    now, now,
  );

  audit({ userId: null, action: 'bootstrap_admin', summary: `建立初始管理員帳號 ${id}` });

  if (generated) {
    const line = '─'.repeat(52);
    log.warn(
      `\n${line}\n` +
      `  首次啟動 — 已建立初始管理員帳號\n` +
      `    帳號：${id}\n` +
      `    密碼：${password}\n` +
      `  此密碼只顯示這一次，登入後系統會要求立即變更。\n` +
      `  若要自行指定，請以 BTMS_ADMIN_PASSWORD 環境變數設定。\n` +
      `${line}\n`,
    );
  } else {
    log.info(`首次啟動：已依 BTMS_ADMIN_USER 建立管理員帳號 ${id}（首次登入需變更密碼）`);
  }

  return { created: true, id, generated };
}

/** 參照資料（ATT&CK 技術表、職務、事件類型…）：每次啟動都確保為最新。 */
export function loadReference(log) {
  const file = resolve(seedDir, 'reference.json');
  if (!existsSync(file)) {
    log.warn('找不到 seed/reference.json，ATT&CK 參照資料將為空');
    return null;
  }
  const ref = JSON.parse(readFileSync(file, 'utf8'));
  setSetting('reference_version', { loadedAt: nowIso() });
  return ref;
}

/**
 * 示範資料：僅在 BTMS_SEED_DEMO=true 且資料庫尚無業務資料時載入，
 * 避免在既有環境上重複灌入或覆蓋現場資料。
 */
export async function loadDemoData(log) {
  if (!config.seed.demo) return { loaded: false, reason: 'disabled' };
  if (getSetting('demo_seeded')) return { loaded: false, reason: 'already_seeded' };

  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) n FROM records').get().n;
  if (existing > 0) {
    log.info('資料庫已有資料，略過示範資料載入');
    return { loaded: false, reason: 'not_empty' };
  }

  const file = resolve(seedDir, 'demo.json');
  if (!existsSync(file)) {
    log.warn('BTMS_SEED_DEMO=true 但找不到 seed/demo.json');
    return { loaded: false, reason: 'missing_file' };
  }

  const demo = JSON.parse(readFileSync(file, 'utf8'));
  const now = nowIso();
  const counts = {};

  const insert = db.prepare(
    `INSERT INTO records (collection, id, data, version, deleted,
       created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, 1, 0, ?, 'system', ?, 'system')`,
  );

  const run = db.transaction(() => {
    for (const [name, cfg] of Object.entries(COLLECTIONS)) {
      const src = demo[cfg.clientKey];
      if (!src) continue;
      const entries = Array.isArray(src)
        ? src.map((d, i) => [d.id ?? `${cfg.idPrefix || name}-${i + 1}`, d])
        : Object.entries(src);
      for (const [id, data] of entries) {
        insert.run(name, String(id), JSON.stringify(data), now, now);
      }
      counts[name] = entries.length;
    }
  });
  run();

  // 示範帳號：一律不帶密碼，需由管理員另行設定後才能登入
  const demoUsers = demo.users || {};
  const upsertUser = db.prepare(
    `INSERT INTO users (id, name, role, perm, pw_hash, provider, must_change_pw,
       disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'local', 1, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  let userCount = 0;
  for (const [id, u] of Object.entries(demoUsers)) {
    if (u.perm === 'admin') continue; // 管理員已由 ensureAdmin 建立
    upsertUser.run(id, u.name, u.role, u.perm, now, now);
    userCount += 1;
  }

  setSetting('demo_seeded', { at: now, counts, users: userCount });
  audit({ userId: null, action: 'seed_demo', summary: `載入示範資料：${JSON.stringify(counts)}` });

  log.info(
    `已載入示範資料：${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}；` +
    `另建立 ${userCount} 個示範帳號（皆為停用狀態、無密碼，需由管理員啟用並設定密碼）`,
  );
  return { loaded: true, counts, users: userCount };
}

export async function runBootstrap(log) {
  const admin = await ensureAdmin(log);
  const reference = loadReference(log);
  const demo = await loadDemoData(log);
  return { admin, reference: Boolean(reference), demo };
}
