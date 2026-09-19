'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/** สร้าง/อัปเดตโครงสร้างฐานข้อมูล */
function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  seedDefaults();
}

const DEFAULT_SETTINGS = {
  school_name: 'โรงเรียนทุนวิทยาคม',
  school_short: 'ทุนวิทยาคม',
  school_address: '',
  school_phone: '',
  school_logo: '',
  system_title: 'ระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ',
  contact_note: 'หากมีข้อสงสัยกรุณาติดต่อฝ่ายการเงินของโรงเรียน',
  require_member_pin: '1',           // ต้องใส่รหัสสมาชิกก่อนแจ้งชำระ
  show_pin_to_admin: '1',            // แอดมินเห็นรหัสสมาชิกเพื่อแจ้งต่อ
  allow_public_member_list: '1',     // แสดงรายชื่อผู้ต้องชำระบนหน้าสาธารณะ
  mask_member_name: '0',             // ปิดบังนามสกุลบางส่วนบนหน้าสาธารณะ
  detect_duplicate_slip: '1',        // ตรวจจับสลิปซ้ำ
  max_upload_mb: '10',
  receipt_prefix: 'RC',
  receipt_running: '0',
  auto_approve: '0',                 // อนุมัติอัตโนมัติเมื่อมีการแจ้ง (ไม่แนะนำ)
  notify_email_on_submit: '0',
  theme_color: 'indigo',
};

function seedDefaults() {
  const ins = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  const tx = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) ins.run(k, String(v));
  });
  tx(DEFAULT_SETTINGS);
}

/* ------------------------- settings helpers ------------------------- */

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? fallback);
}

function getSettingBool(key) {
  return String(getSetting(key, '0')) === '1';
}

function getSettingNumber(key, fallback = 0) {
  const n = Number(getSetting(key, fallback));
  return Number.isFinite(n) ? n : fallback;
}

function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value === null || value === undefined ? '' : String(value));
}

function setSettings(obj) {
  const tx = db.transaction((o) => {
    for (const [k, v] of Object.entries(o)) setSetting(k, v);
  });
  tx(obj);
}

/** เลขที่ใบเสร็จถัดไป (atomic) */
function nextReceiptNo() {
  const tx = db.transaction(() => {
    const cur = Number(getSetting('receipt_running', '0')) || 0;
    const next = cur + 1;
    setSetting('receipt_running', String(next));
    const prefix = getSetting('receipt_prefix', 'RC') || 'RC';
    const year = new Date().getFullYear() + 543;
    return `${prefix}${year}-${String(next).padStart(5, '0')}`;
  });
  return tx();
}

module.exports = {
  db,
  migrate,
  DATA_DIR,
  UPLOAD_DIR,
  DB_FILE,
  DEFAULT_SETTINGS,
  getSetting,
  getSettingBool,
  getSettingNumber,
  getAllSettings,
  setSetting,
  setSettings,
  nextReceiptNo,
};
