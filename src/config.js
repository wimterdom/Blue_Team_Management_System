/**
 * 組態：一律由環境變數注入，不在程式碼或映像檔內寫死任何機敏值。
 * 未設定者採用可安全上線的預設值。
 */
import { resolve } from 'node:path';

const bool = (v, dflt = false) => {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
};
const int = (v, dflt) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const DATA_DIR = process.env.BTMS_DATA_DIR || '/data';

export const config = {
  env: process.env.NODE_ENV || 'production',

  server: {
    host: process.env.BTMS_HOST || '0.0.0.0',
    port: int(process.env.BTMS_PORT, 8080),
    // 置於反向代理之後時設為 true，才會採信 X-Forwarded-* 取得真實來源 IP
    trustProxy: bool(process.env.BTMS_TRUST_PROXY, false),
    bodyLimitBytes: int(process.env.BTMS_BODY_LIMIT_BYTES, 2 * 1024 * 1024),
  },

  paths: {
    dataDir: DATA_DIR,
    db: process.env.BTMS_DB_PATH || resolve(DATA_DIR, 'btms.sqlite'),
    uploads: process.env.BTMS_UPLOAD_DIR || resolve(DATA_DIR, 'attachments'),
    backups: process.env.BTMS_BACKUP_DIR || resolve(DATA_DIR, 'backups'),
  },

  auth: {
    // 首次啟動建立的管理員。密碼僅用於建立雜湊，不會寫入資料庫或日誌。
    bootstrapUser: process.env.BTMS_ADMIN_USER || 'admin',
    bootstrapPassword: process.env.BTMS_ADMIN_PASSWORD || '',
    // 首次登入是否強制變更密碼
    forcePasswordChange: bool(process.env.BTMS_FORCE_PW_CHANGE, true),
    sessionIdleMinutes: int(process.env.BTMS_SESSION_IDLE_MIN, 60),
    sessionAbsoluteHours: int(process.env.BTMS_SESSION_MAX_HOURS, 12),
    maxFailedLogins: int(process.env.BTMS_MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(process.env.BTMS_LOCKOUT_MIN, 15),
    minPasswordLength: int(process.env.BTMS_MIN_PW_LEN, 12),
    // Cookie 加上 Secure 旗標。以 HTTPS 對外時務必開啟。
    cookieSecure: bool(process.env.BTMS_COOKIE_SECURE, false),
    cookieName: process.env.BTMS_COOKIE_NAME || 'btms_session',
  },

  /**
   * SSO 接縫：本地帳密為預設提供者，外部 IdP 由組態掛入，
   * 呼叫端一律只透過 AuthProvider 介面，不直接碰帳密比對。
   */
  sso: {
    enabled: bool(process.env.BTMS_SSO_ENABLED, false),
    provider: process.env.BTMS_SSO_PROVIDER || 'oidc',
    issuer: process.env.BTMS_SSO_ISSUER || '',
    clientId: process.env.BTMS_SSO_CLIENT_ID || '',
    clientSecret: process.env.BTMS_SSO_CLIENT_SECRET || '',
    redirectUri: process.env.BTMS_SSO_REDIRECT_URI || '',
    scopes: (process.env.BTMS_SSO_SCOPES || 'openid profile email').split(/\s+/),
    // 外部帳號首次登入時自動建檔所採用的預設權限
    defaultPerm: process.env.BTMS_SSO_DEFAULT_PERM || 'analyst',
    defaultRole: process.env.BTMS_SSO_DEFAULT_ROLE || '網路分析員',
    // 允許本地帳密與 SSO 併存，避免 IdP 故障時無法進入系統
    allowLocalFallback: bool(process.env.BTMS_SSO_LOCAL_FALLBACK, true),
  },

  uploads: {
    maxBytes: int(process.env.BTMS_UPLOAD_MAX_BYTES, 10 * 1024 * 1024),
    maxFilesPerRequest: int(process.env.BTMS_UPLOAD_MAX_FILES, 10),
    // 僅允許影像：調查報告的附圖用途。以實際位元組嗅探，不信任副檔名。
    allowedMime: (process.env.BTMS_UPLOAD_MIME ||
      'image/png,image/jpeg,image/gif,image/webp,image/avif').split(','),
  },

  seed: {
    // 正式部署預設空白；需要示範資料（教育訓練、驗收測試）時才開啟
    demo: bool(process.env.BTMS_SEED_DEMO, false),
  },

  backup: {
    enabled: bool(process.env.BTMS_BACKUP_ENABLED, true),
    intervalHours: int(process.env.BTMS_BACKUP_INTERVAL_HOURS, 24),
    keep: int(process.env.BTMS_BACKUP_KEEP, 7),
  },

  rateLimit: {
    // 一般 API
    max: int(process.env.BTMS_RATE_MAX, 600),
    windowMs: int(process.env.BTMS_RATE_WINDOW_MS, 60_000),
    // 登入端點另行加嚴
    loginMax: int(process.env.BTMS_RATE_LOGIN_MAX, 10),
    loginWindowMs: int(process.env.BTMS_RATE_LOGIN_WINDOW_MS, 60_000),
  },

  log: {
    level: process.env.BTMS_LOG_LEVEL || 'info',
    // 稽核紀錄保留天數，0 表示永不刪除
    auditRetentionDays: int(process.env.BTMS_AUDIT_RETENTION_DAYS, 0),
  },
};

export default config;
