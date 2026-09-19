-- ============================================================
--  ระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ โรงเรียนทุนวิทยาคม
--  Database schema (SQLite)
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- ผู้ดูแลระบบ ----------
CREATE TABLE IF NOT EXISTS admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  email           TEXT    NOT NULL UNIQUE,
  full_name       TEXT    NOT NULL,
  password_hash   TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'admin',   -- superadmin | admin | viewer
  phone           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  must_change_pw  INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- คำขอรีเซ็ตรหัสผ่านผู้ดูแล ----------
CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  request_ip  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token_hash);

-- ---------- กลุ่ม / ชั้นเรียน ----------
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- สมาชิก ----------
CREATE TABLE IF NOT EXISTS members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_code  TEXT    NOT NULL UNIQUE,            -- รหัสสมาชิก / เลขประจำตัว
  prefix       TEXT,                               -- คำนำหน้า
  first_name   TEXT    NOT NULL,
  last_name    TEXT    NOT NULL,
  nickname     TEXT,
  group_id     INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  phone        TEXT,
  email        TEXT,
  guardian     TEXT,                               -- ผู้ปกครอง
  note         TEXT,
  pin_hash     TEXT    NOT NULL,                   -- รหัสยืนยันตัวตน (PIN) แบบเข้ารหัส
  pin_plain    TEXT,                               -- เก็บไว้ให้แอดมินแจ้งสมาชิก (ล้างได้ในตั้งค่า)
  pin_reset_at TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_members_group  ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_members_active ON members(is_active);
CREATE INDEX IF NOT EXISTS idx_members_name   ON members(first_name, last_name);

-- ---------- รายการจัดเก็บ (รอบการเก็บเงิน) ----------
CREATE TABLE IF NOT EXISTS collections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,           -- รหัสรายการ เช่น CWK-2568-001
  name          TEXT    NOT NULL,                  -- วัตถุประสงค์การจัดเก็บ
  description   TEXT,
  fiscal_year   TEXT,                              -- ปีการศึกษา
  term          TEXT,                              -- ภาคเรียน
  default_amount REAL   NOT NULL DEFAULT 0,        -- ยอดตั้งต้น (ถ้าไม่ใช้กิจกรรมย่อย)
  due_date      TEXT,                              -- กำหนดชำระ
  allow_partial INTEGER NOT NULL DEFAULT 0,        -- อนุญาตให้ผ่อนชำระ
  status        TEXT    NOT NULL DEFAULT 'draft',  -- draft | open | closed
  is_public     INTEGER NOT NULL DEFAULT 1,        -- แสดงบนหน้าสาธารณะ
  created_by    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collections_status ON collections(status);

-- ---------- กิจกรรมย่อยของรายการจัดเก็บ ----------
CREATE TABLE IF NOT EXISTS collection_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,                  -- ชื่อกิจกรรมย่อย
  description   TEXT,
  amount        REAL    NOT NULL DEFAULT 0,        -- จำนวนเงิน
  is_optional   INTEGER NOT NULL DEFAULT 0,        -- เลือกได้รายบุคคล
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citems_collection ON collection_items(collection_id);

-- ---------- รายการที่สมาชิกต้องชำระ ----------
CREATE TABLE IF NOT EXISTS assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL REFERENCES members(id)     ON DELETE CASCADE,
  amount_due    REAL    NOT NULL DEFAULT 0,
  discount      REAL    NOT NULL DEFAULT 0,        -- ส่วนลด/ยกเว้น
  waived        INTEGER NOT NULL DEFAULT 0,        -- ยกเว้นการชำระ
  note          TEXT,
  created_by    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (collection_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_assign_collection ON assignments(collection_id);
CREATE INDEX IF NOT EXISTS idx_assign_member     ON assignments(member_id);

-- ---------- กิจกรรมย่อยที่เลือกให้สมาชิกรายบุคคล ----------
CREATE TABLE IF NOT EXISTS assignment_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id      INTEGER NOT NULL REFERENCES assignments(id)      ON DELETE CASCADE,
  collection_item_id INTEGER NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  amount             REAL    NOT NULL DEFAULT 0,
  UNIQUE (assignment_id, collection_item_id)
);

-- ---------- การแจ้งชำระเงิน ----------
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_code       TEXT    NOT NULL,                 -- เลข 4 หลักสำหรับดูสลิปภายหลัง
  assignment_id  INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  amount         REAL    NOT NULL DEFAULT 0,
  method         TEXT    NOT NULL DEFAULT 'transfer', -- transfer | cash | other
  payer_name     TEXT,
  transferred_at TEXT,                             -- วัน-เวลาที่โอน
  bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  slip_path      TEXT,                             -- ไฟล์สลิป
  slip_mime      TEXT,
  slip_size      INTEGER,
  slip_hash      TEXT,                             -- ตรวจจับสลิปซ้ำ
  note           TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  reject_reason  TEXT,
  verified_by    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  verified_at    TEXT,
  receipt_no     TEXT,                             -- เลขที่ใบเสร็จ
  submitted_ip   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_assignment ON payments(assignment_id);
CREATE INDEX IF NOT EXISTS idx_pay_status     ON payments(status);
CREATE INDEX IF NOT EXISTS idx_pay_ref        ON payments(ref_code);
CREATE INDEX IF NOT EXISTS idx_pay_hash       ON payments(slip_hash);
-- เลขอ้างอิง 4 หลักต้องไม่ซ้ำกันในกลุ่มรายการที่ยังไม่ถูกยกเลิก
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_ref_active
  ON payments(ref_code) WHERE status <> 'cancelled';

-- ---------- บัญชีรับโอน ----------
CREATE TABLE IF NOT EXISTS bank_accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name      TEXT    NOT NULL,
  account_name   TEXT    NOT NULL,
  account_number TEXT    NOT NULL,
  branch         TEXT,
  promptpay_id   TEXT,                             -- เบอร์โทร/เลขบัตร/เลขนิติบุคคล
  note           TEXT,
  is_default     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- ตั้งค่าระบบ ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- บันทึกกิจกรรม ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type  TEXT    NOT NULL,                    -- admin | member | system
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs(actor_type, actor_id);

-- ---------- เซสชันผู้ดูแล ----------
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  data       TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
