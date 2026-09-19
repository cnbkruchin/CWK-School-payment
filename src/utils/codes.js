'use strict';
const crypto = require('crypto');

/** สุ่มตัวเลขความยาว n หลัก (ไม่ขึ้นต้นด้วย 0 เมื่อ n>1) */
function randomDigits(n, allowLeadingZero = true) {
  let s = '';
  while (s.length < n) {
    const b = crypto.randomBytes(n * 2);
    for (const byte of b) {
      if (s.length >= n) break;
      const d = byte % 10;
      if (s.length === 0 && !allowLeadingZero && d === 0) continue;
      s += d;
    }
  }
  return s;
}

/**
 * สร้าง "เลขอ้างอิง 4 หลัก" สำหรับใช้ดูสลิปภายหลัง
 * ถ้าเลข 4 หลักถูกใช้จนเกือบเต็ม ระบบจะขยายเป็น 5 และ 6 หลักโดยอัตโนมัติ
 * @param {import('better-sqlite3').Database} db
 */
function generateRefCode(db) {
  const exists = db.prepare(
    "SELECT 1 FROM payments WHERE ref_code = ? AND status <> 'cancelled' LIMIT 1"
  );
  for (const len of [4, 5, 6]) {
    const tries = len === 4 ? 200 : 400;
    for (let i = 0; i < tries; i++) {
      const code = randomDigits(len, len > 4);
      if (!exists.get(code)) return code;
    }
  }
  // ทางออกสุดท้าย: ใช้เวลาระบบผสมสุ่ม (ไม่ซ้ำแน่นอน)
  return String(Date.now()).slice(-6) + randomDigits(2);
}

/** รหัส PIN ของสมาชิก (ค่าเริ่มต้น 6 หลัก) */
function generatePin(len = 6) {
  return randomDigits(len, true);
}

/** รหัสสมาชิกอัตโนมัติ เช่น M0001 */
function generateMemberCode(db, prefix = 'M') {
  const row = db
    .prepare(
      `SELECT member_code FROM members WHERE member_code LIKE ? ORDER BY LENGTH(member_code) DESC, member_code DESC LIMIT 1`
    )
    .get(prefix + '%');
  let next = 1;
  if (row) {
    const n = parseInt(String(row.member_code).replace(prefix, ''), 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  let code = prefix + String(next).padStart(4, '0');
  const has = db.prepare('SELECT 1 FROM members WHERE member_code = ?');
  while (has.get(code)) {
    next += 1;
    code = prefix + String(next).padStart(4, '0');
  }
  return code;
}

/** รหัสรายการจัดเก็บอัตโนมัติ เช่น CWK69-001 */
function generateCollectionCode(db) {
  const yy = String((new Date().getFullYear() + 543) % 100).padStart(2, '0');
  const prefix = `CWK${yy}-`;
  const row = db
    .prepare('SELECT code FROM collections WHERE code LIKE ? ORDER BY code DESC LIMIT 1')
    .get(prefix + '%');
  let next = 1;
  if (row) {
    const n = parseInt(String(row.code).slice(prefix.length), 10);
    if (Number.isFinite(n)) next = n + 1;
  }
  let code = prefix + String(next).padStart(3, '0');
  const has = db.prepare('SELECT 1 FROM collections WHERE code = ?');
  while (has.get(code)) {
    next += 1;
    code = prefix + String(next).padStart(3, '0');
  }
  return code;
}

/** โทเคนแบบสุ่มปลอดภัย (สำหรับลิงก์รีเซ็ตรหัสผ่าน) */
function secureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = {
  randomDigits,
  generateRefCode,
  generatePin,
  generateMemberCode,
  generateCollectionCode,
  secureToken,
  sha256,
};
