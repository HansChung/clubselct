-- 社團志願序系統資料表（Cloudflare D1 / SQLite）
CREATE TABLE IF NOT EXISTS students (
  student_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  grade      INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,       -- SHA-256(SESSION_SECRET + 學號 + 密碼)
  seat_no    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clubs (
  club_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  capacity    INTEGER NOT NULL DEFAULT 0,
  grades      TEXT NOT NULL DEFAULT '',   -- 允許年級，逗號分隔；空字串 = 不限
  teacher     TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preferences (
  student_id TEXT PRIMARY KEY,
  prefs      TEXT NOT NULL,            -- JSON 陣列，依志願序排列的 club_id
  receipt    TEXT NOT NULL,            -- 送出確認碼
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  student_id TEXT PRIMARY KEY,
  club_id    TEXT,                     -- NULL = 未分發
  rank       INTEGER,                  -- 錄取第幾志願
  lottery    INTEGER                   -- 抽籤順位（未填志願者為 NULL）
);

CREATE TABLE IF NOT EXISTS allocation_runs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  seed    TEXT NOT NULL,
  mode    TEXT NOT NULL,
  run_at  TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('status', 'auto'),            -- auto | open | closed
  ('open_at', ''),               -- ISO 時間，status=auto 時生效
  ('close_at', ''),
  ('max_prefs', '15'),
  ('min_prefs', '15'),
  ('announce', ''),
  ('results_public', '0');

-- 後台管理帳號（username=admin 且密碼為 ADMIN_PASSWORD 環境變數者為初始備援帳號，不在此表）
CREATE TABLE IF NOT EXISTS admins (
  username      TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
