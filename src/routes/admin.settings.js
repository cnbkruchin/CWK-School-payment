'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');

const { db, getAllSettings, setSettings, setSetting, DEFAULT_SETTINGS, DB_FILE, UPLOAD_DIR } = require('../db');
const audit = require('../services/audit');
const mailer = require('../services/mailer');
const promptpay = require('../services/promptpay');
const { requireAdmin, requireWrite, requireSuper } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const v = require('../utils/validate');
const { logoUpload } = require('../middleware/upload');
const { normalizePhone, padCode } = require('../utils/thai');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

const EDITABLE = Object.keys(DEFAULT_SETTINGS);

/* ------------------------------- อ่านการตั้งค่า ------------------------------- */
router.get('/', v.wrap((req, res) => {
  res.json({
    settings: getAllSettings(),
    mail_mode: mailer.getMode(),
    banks: db.prepare('SELECT * FROM bank_accounts ORDER BY is_default DESC, sort_order, id').all(),
  });
}));

/* ---------------- จัดรูปแบบเบอร์โทรและเติมเลข 0 นำหน้าที่หายไป ---------------- */

const REPAIR_TARGETS = [
  { table: 'members',       column: 'phone',        mode: 'phone', label: 'เบอร์โทรสมาชิก',        key: 'member_code' },
  { table: 'admins',        column: 'phone',        mode: 'phone', label: 'เบอร์โทรผู้ดูแลระบบ',  key: 'username' },
  { table: 'bank_accounts', column: 'promptpay_id', mode: 'phone', label: 'เลขพร้อมเพย์',          key: 'bank_name' },
  { table: 'members',       column: 'pin_plain',    mode: 'pad6',  label: 'รหัส PIN สมาชิก',       key: 'member_code' },
  { table: 'payments',      column: 'ref_code',     mode: 'pad4',  label: 'เลขอ้างอิงการแจ้งชำระ', key: 'ref_code' },
];

function repairValue(value, mode) {
  if (mode === 'phone') return normalizePhone(value);
  if (mode === 'pad6') return padCode(value, 6);
  if (mode === 'pad4') return padCode(value, 4);
  return String(value ?? '');
}

function repairPhoneData(dryRun) {
  const report = { formatted: 0, fixed: 0, scanned: 0, details: [], samples: [] };

  const run = db.transaction(() => {
    for (const t of REPAIR_TARGETS) {
      const rows = db.prepare(`SELECT id, ${t.key} AS k, ${t.column} AS v FROM ${t.table} WHERE ${t.column} IS NOT NULL AND ${t.column} <> ''`).all();
      const upd = db.prepare(`UPDATE ${t.table} SET ${t.column} = ? WHERE id = ?`);
      let n = 0;
      for (const r of rows) {
        report.scanned += 1;
        const after = repairValue(r.v, t.mode);
        if (String(after) === String(r.v)) continue;
        if (!dryRun) upd.run(after, r.id);
        n += 1;
        if (report.samples.length < 12) {
          report.samples.push({ table: t.label, key: String(r.k), before: String(r.v), after: String(after) });
        }
      }
      report.fixed += n;
      report.details.push({ label: t.label, count: n });
    }

    const phone = getAllSettings().school_phone;
    if (phone) {
      report.scanned += 1;
      const fixed = normalizePhone(phone);
      if (fixed !== String(phone)) {
        if (!dryRun) setSetting('school_phone', fixed);
        report.fixed += 1;
        report.details.push({ label: 'เบอร์โทรโรงเรียน', count: 1 });
        if (report.samples.length < 12) {
          report.samples.push({ table: 'เบอร์โทรโรงเรียน', key: 'school_phone', before: String(phone), after: fixed });
        }
      }
    }
  });
  run();
  return report;
}

router.post('/repair-phones', requireSuper, v.wrap((req, res) => {
  const dryRun = v.bool(req.body.dry_run);
  const report = repairPhoneData(dryRun);
  if (!dryRun) {
    audit.log(req, 'จัดรูปแบบเบอร์โทรและเติมเลข 0 นำหน้า', { detail: { fixed: report.fixed } });
  }
  res.json(report);
}));

/* ------------------------------ บันทึกการตั้งค่า ------------------------------ */
router.put('/', requireWrite, v.wrap((req, res) => {
  const patch = {};
  for (const key of EDITABLE) {
    if (req.body[key] === undefined) continue;
    if (key === 'receipt_running') continue; // ป้องกันการแก้เลขรันใบเสร็จโดยไม่ตั้งใจ
    const val = req.body[key];
    patch[key] = typeof val === 'boolean' ? (val ? '1' : '0') : String(val).slice(0, 2000);
  }
  if (!Object.keys(patch).length) v.fail(400, 'ไม่มีข้อมูลที่ต้องบันทึก');

  // เบอร์โทรโรงเรียนเก็บเป็นข้อความ และเติมเลข 0 นำหน้าให้ครบตามมาตรฐานไทย
  if (patch.school_phone !== undefined) patch.school_phone = normalizePhone(patch.school_phone);

  const mb = Number(patch.max_upload_mb);
  if (patch.max_upload_mb !== undefined && (!Number.isFinite(mb) || mb < 1 || mb > 50)) {
    v.fail(400, 'ขนาดไฟล์สูงสุดต้องอยู่ระหว่าง 1-50 MB');
  }

  setSettings(patch);
  audit.log(req, 'แก้ไขการตั้งค่าระบบ', { detail: Object.keys(patch).join(', ') });
  res.json({ ok: true, settings: getAllSettings() });
}));

/** ตั้งเลขรันใบเสร็จ (เฉพาะผู้ดูแลสูงสุด) */
router.put('/receipt-running', requireSuper, v.wrap((req, res) => {
  const n = v.num(req.body.value, -1);
  if (!Number.isInteger(n) || n < 0) v.fail(400, 'เลขรันใบเสร็จต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  setSetting('receipt_running', String(n));
  audit.log(req, 'ตั้งค่าเลขรันใบเสร็จ', { detail: `เป็น ${n}` });
  res.json({ ok: true });
}));

/* -------------------------------- โลโก้โรงเรียน -------------------------------- */
router.post('/logo', requireWrite, (req, res, next) => {
  logoUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'อัปโหลดโลโก้ไม่สำเร็จ' });
    next();
  });
}, v.wrap((req, res) => {
  if (!req.file) v.fail(400, 'กรุณาเลือกไฟล์รูปภาพ');
  const url = `/uploads/branding/${path.basename(req.file.path)}`;
  setSetting('school_logo', url);
  audit.log(req, 'เปลี่ยนโลโก้โรงเรียน', { detail: url });
  res.json({ ok: true, url });
}));

router.delete('/logo', requireWrite, v.wrap((req, res) => {
  setSetting('school_logo', '');
  audit.log(req, 'ลบโลโก้โรงเรียน');
  res.json({ ok: true });
}));

/* ================================ บัญชีรับโอน ================================ */
router.post('/banks', requireWrite, v.wrap((req, res) => {
  const bankName = v.str(req.body.bank_name, 120);
  const accountName = v.str(req.body.account_name, 160);
  const accountNumber = v.str(req.body.account_number, 40);
  if (!bankName) v.fail(400, 'กรุณาระบุชื่อธนาคาร');
  if (!accountName) v.fail(400, 'กรุณาระบุชื่อบัญชี');
  if (!accountNumber) v.fail(400, 'กรุณาระบุเลขที่บัญชี');

  const promptpayId = normalizePhone(v.str(req.body.promptpay_id, 40).replace(/\D/g, ''));
  if (promptpayId && !promptpay.normalizeTarget(promptpayId)) {
    v.fail(400, 'เลขพร้อมเพย์ไม่ถูกต้อง (ต้องเป็นเบอร์โทร 10 หลัก, เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก)');
  }

  const isDefault = v.bool(req.body.is_default) ? 1 : 0;
  const id = db.transaction(() => {
    if (isDefault) db.prepare('UPDATE bank_accounts SET is_default = 0').run();
    return db
      .prepare(
        `INSERT INTO bank_accounts (bank_name, account_name, account_number, branch, promptpay_id, note, is_default, sort_order)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(bankName, accountName, accountNumber, v.str(req.body.branch, 120) || null,
           promptpayId || null, v.str(req.body.note, 255) || null, isDefault, v.num(req.body.sort_order, 0))
      .lastInsertRowid;
  })();

  audit.log(req, 'เพิ่มบัญชีรับโอน', { targetType: 'bank_account', targetId: id, detail: `${bankName} ${accountNumber}` });
  res.status(201).json({ ok: true, id });
}));

router.put('/banks/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const b = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
  if (!b) v.fail(404, 'ไม่พบบัญชีนี้');

  const promptpayId = req.body.promptpay_id !== undefined
    ? normalizePhone(v.str(req.body.promptpay_id, 40).replace(/\D/g, ''))
    : b.promptpay_id;
  if (promptpayId && !promptpay.normalizeTarget(promptpayId)) v.fail(400, 'เลขพร้อมเพย์ไม่ถูกต้อง');

  const isDefault = req.body.is_default !== undefined ? (v.bool(req.body.is_default) ? 1 : 0) : b.is_default;
  db.transaction(() => {
    if (isDefault) db.prepare('UPDATE bank_accounts SET is_default = 0').run();
    db.prepare(
      `UPDATE bank_accounts SET bank_name=?, account_name=?, account_number=?, branch=?,
              promptpay_id=?, note=?, is_default=?, is_active=?, sort_order=? WHERE id=?`
    ).run(
      v.str(req.body.bank_name, 120) || b.bank_name,
      v.str(req.body.account_name, 160) || b.account_name,
      v.str(req.body.account_number, 40) || b.account_number,
      req.body.branch !== undefined ? v.str(req.body.branch, 120) || null : b.branch,
      promptpayId || null,
      req.body.note !== undefined ? v.str(req.body.note, 255) || null : b.note,
      isDefault,
      req.body.is_active !== undefined ? (v.bool(req.body.is_active) ? 1 : 0) : b.is_active,
      v.num(req.body.sort_order, b.sort_order),
      id
    );
  })();

  audit.log(req, 'แก้ไขบัญชีรับโอน', { targetType: 'bank_account', targetId: id });
  res.json({ ok: true });
}));

router.delete('/banks/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const b = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
  if (!b) v.fail(404, 'ไม่พบบัญชีนี้');
  db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
  audit.log(req, 'ลบบัญชีรับโอน', { targetType: 'bank_account', targetId: id, detail: `${b.bank_name} ${b.account_number}` });
  res.json({ ok: true });
}));

/** ดูตัวอย่าง QR พร้อมเพย์ */
router.get('/banks/:id(\\d+)/qr', v.wrap(async (req, res) => {
  const b = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(v.id(req.params.id));
  if (!b || !b.promptpay_id) v.fail(404, 'บัญชีนี้ยังไม่ได้ตั้งค่าพร้อมเพย์');
  const qr = await promptpay.buildQrDataUrl(b.promptpay_id, v.money(req.query.amount, 0));
  res.json({ qr });
}));

/* ================================ สำรองข้อมูล ================================ */
router.get('/backup', requireSuper, v.wrap((req, res) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmp = path.join(path.dirname(DB_FILE), `backup-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(tmp);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  audit.log(req, 'ดาวน์โหลดไฟล์สำรองฐานข้อมูล', { detail: `${(buf.length / 1024).toFixed(0)} KB` });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="cwk-backup-${stamp}.db"`);
  res.send(buf);
}));

/** สถิติการใช้พื้นที่ */
router.get('/storage', v.wrap((req, res) => {
  const dirSize = (dir) => {
    let total = 0;
    let count = 0;
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else { total += fs.statSync(p).size; count++; }
      }
    };
    walk(dir);
    return { bytes: total, files: count };
  };
  const uploads = dirSize(UPLOAD_DIR);
  const dbSize = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0;
  res.json({
    database_bytes: dbSize,
    uploads_bytes: uploads.bytes,
    uploads_files: uploads.files,
    total_bytes: dbSize + uploads.bytes,
    counts: {
      members: db.prepare('SELECT COUNT(*) n FROM members').get().n,
      collections: db.prepare('SELECT COUNT(*) n FROM collections').get().n,
      payments: db.prepare('SELECT COUNT(*) n FROM payments').get().n,
      audit_logs: db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,
    },
  });
}));

/** ลบบันทึกกิจกรรมเก่า */
router.post('/prune-logs', requireSuper, v.wrap((req, res) => {
  const days = Math.max(30, v.num(req.body.days, 365));
  const info = db.prepare("DELETE FROM audit_logs WHERE created_at < date('now', ?)").run(`-${days} days`);
  audit.log(req, 'ลบบันทึกกิจกรรมเก่า', { detail: `เก่ากว่า ${days} วัน จำนวน ${info.changes} รายการ` });
  res.json({ ok: true, deleted: info.changes });
}));

module.exports = router;
