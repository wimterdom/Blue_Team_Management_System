-- 001_init — 藍隊管理系統初始結構
--
-- 設計取向：業務資料以「集合 + JSON 文件」保存（records 表）。
-- 五套子系統的文件欄位仍在演進，JSON 讓欄位增修不必每次改結構；
-- 需要排序／篩選的熱欄位另以產生欄位（generated column）外露並建索引，
-- 查詢效能與正規化資料表相當，而 30 人規模完全足夠。
-- 稽核、附件、帳號、會話這些「系統級」資料則採正規化欄位。

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL,
  perm            TEXT NOT NULL CHECK (perm IN ('admin','manage','analyst')),
  pw_hash         TEXT,                       -- 外部 IdP 帳號為 NULL
  provider        TEXT NOT NULL DEFAULT 'local',
  external_id     TEXT,
  must_change_pw  INTEGER NOT NULL DEFAULT 0,
  disabled        INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external
  ON users(provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,              -- 隨機 token 的 SHA-256，不存原值
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS records (
  collection  TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT NOT NULL,                  -- JSON 文件
  version     INTEGER NOT NULL DEFAULT 1,     -- 樂觀鎖：更新時需帶目前版本
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT,
  -- 熱欄位外露：擁有者判權、儀表板排序（依「案發時間」而非建立時間）
  owner       TEXT GENERATED ALWAYS AS
                (COALESCE(json_extract(data,'$.analyst'), json_extract(data,'$.applicant'))) VIRTUAL,
  occur_at    TEXT GENERATED ALWAYS AS (json_extract(data,'$.occurStart')) VIRTUAL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_coll    ON records(collection, deleted);
CREATE INDEX IF NOT EXISTS idx_records_occur   ON records(collection, occur_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_owner   ON records(collection, owner);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(collection, updated_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  collection   TEXT NOT NULL,
  record_id    TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  rel_path     TEXT NOT NULL,                 -- 相對於附件目錄
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_att_record ON attachments(collection, record_id, deleted);
CREATE INDEX IF NOT EXISTS idx_att_sha    ON attachments(sha256);

-- 稽核：規格要求「帳號即是誰改了什麼的紀錄」，因此所有寫入都留痕。
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  user_id     TEXT,
  action      TEXT NOT NULL,                  -- login / logout / create / update / delete / ...
  collection  TEXT,
  record_id   TEXT,
  summary     TEXT,
  ip          TEXT,
  user_agent  TEXT,
  changes     TEXT                            -- JSON：異動欄位的前後值
);
CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit(collection, record_id, ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
