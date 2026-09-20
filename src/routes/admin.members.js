'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const { db, getSettingBool } = require('../db');
const audit = require('../services/audit');
const finance = require('../services/finance');
const { parseMembers } = require('../services/importer');
const { importUpload } = require('../middleware/upload');
const { requireAdmin, requireWrite } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const { generatePin, generateMemberCode } = require('../utils/codes');
const v = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

const PIN_ROUNDS = 10;

function publicMember(m) {
  const out = { ...m, full_name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim() };
  delete out.pin_hash;
  if (!getSettingBool('show_pin_to_admin')) delete out.pin_plain;
  return out;
}

/** หา (หรือสร้าง) กลุ่มจากชื่อ */
function resolveGroup(name) {
  const n = v.str(name, 120);
  if (!n) return null;
  const found = db.prepare('SELECT id FROM groups WHERE name = ?').get(n);
  if (found) return found.id;
  return db.prepare('INSERT INTO groups (name) VALUES (?)').run(n).lastInsertRowid;
}

/* ------------------------------ รายชื่อสมาชิก ------------------------------ */
router.get('/', v.wrap((req, res) => {
  const q = v.str(req.query.q, 100);
  const groupId = v.id(req.query.group);
  const active = req.query.active;
  const page = Math.max(1, v.num(req.query.page, 1));
  const perPage = Math.min(500, Math.max(10, v.num(req.query.per_page, 50)));

  const where = [];
  const params = [];
  if (q) {
    where.push(`(m.member_code LIKE ? OR m.first_name LIKE ? OR m.last_name LIKE ?
                 OR (m.first_name || ' ' || m.last_name) LIKE ? OR m.phone LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (groupId) { where.push('m.group_id = ?'); params.push(groupId); }
  if (active === '1' || active === '0') { where.push('m.is_active = ?'); params.push(Number(active)); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) n FROM members m ${sql}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT m.*, g.name AS group_name,
              (SELECT COUNT(*) FROM assignments a WHERE a.member_id = m.id) AS assignment_count
         FROM members m LEFT JOIN groups g ON g.id = m.group_id
         ${sql}
     ORDER BY g.sort_order, g.name, m.sort_order, m.member_code
        LIMIT ? OFFSET ?`
    )
    .all(...params, perPage, (page - 1) * perPage);

  res.json({
    members: rows.map(publicMember),
    total,
    page,
    per_page: perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    show_pin: getSettingBool('show_pin_to_admin'),
  });
}));

/* ----------------------------- ข้อมูลสมาชิกรายคน ----------------------------- */
router.get('/:id(\\d+)', v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const m = db
    .prepare('SELECT m.*, g.name AS group_name FROM members m LEFT JOIN groups g ON g.id = m.group_id WHERE m.id = ?')
    .get(id);
  if (!m) v.fail(404, 'ไม่พบสมาชิกรายนี้');
  const ledger = finance.getMemberLedger(id);
  res.json({ member: publicMember(m), ledger, totals: finance.summarize(ledger) });
}));

/* -------------------------------- เพิ่มสมาชิก -------------------------------- */
router.post('/', requireWrite, v.wrap((req, res) => {
  const first = v.str(req.body.first_name, 120);
  const last = v.str(req.body.last_name, 120);
  if (!first) v.fail(400, 'กรุณากรอกชื่อ');
  if (!last) v.fail(400, 'กรุณากรอกนามสกุล');

  let code = v.str(req.body.member_code, 40);
  if (code && db.prepare('SELECT 1 FROM members WHERE member_code = ?').get(code)) {
    v.fail(409, `รหัสสมาชิก "${code}" ถูกใช้ไปแล้ว`);
  }
  if (!code) code = generateMemberCode(db);

  const email = v.str(req.body.email, 160);
  if (email && !v.isEmail(email)) v.fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');

  const pin = v.str(req.body.pin, 20) || generatePin(6, db);
  const groupId = v.id(req.body.group_id) || resolveGroup(req.body.group_name);

  const info = db
    .prepare(
      `INSERT INTO members (member_code, prefix, first_name, last_name, nickname, group_id,
                            phone, email, guardian, note, pin_hash, pin_plain, sort_order, is_active)
       VALUES (@code, @prefix, @first, @last, @nick, @gid, @phone, @email, @guardian, @note, @hash, @pin, @sort, 1)`
    )
    .run({
      code, prefix: v.str(req.body.prefix, 40) || null, first, last,
      nick: v.str(req.body.nickname, 60) || null, gid: groupId,
      phone: v.str(req.body.phone, 40) || null, email: email || null,
      guardian: v.str(req.body.guardian, 160) || null, note: v.str(req.body.note, 500) || null,
      hash: bcrypt.hashSync(pin, PIN_ROUNDS), pin, sort: v.num(req.body.sort_order, 0),
    });

  audit.log(req, 'เพิ่มสมาชิก', { targetType: 'member', targetId: info.lastInsertRowid, detail: `${code} ${first} ${last}` });
  res.status(201).json({ ok: true, id: info.lastInsertRowid, member_code: code, pin });
}));

/* -------------------------------- แก้ไขสมาชิก -------------------------------- */
router.put('/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) v.fail(404, 'ไม่พบสมาชิกรายนี้');

  const code = v.str(req.body.member_code, 40) || m.member_code;
  if (code !== m.member_code && db.prepare('SELECT 1 FROM members WHERE member_code = ?').get(code)) {
    v.fail(409, `รหัสสมาชิก "${code}" ถูกใช้ไปแล้ว`);
  }
  const email = v.str(req.body.email, 160);
  if (email && !v.isEmail(email)) v.fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');

  const groupId = req.body.group_id !== undefined
    ? v.id(req.body.group_id)
    : (req.body.group_name !== undefined ? resolveGroup(req.body.group_name) : m.group_id);

  db.prepare(
    `UPDATE members SET member_code=@code, prefix=@prefix, first_name=@first, last_name=@last,
            nickname=@nick, group_id=@gid, phone=@phone, email=@email, guardian=@guardian,
            note=@note, sort_order=@sort, is_active=@active, updated_at=datetime('now')
      WHERE id=@id`
  ).run({
    id, code,
    prefix: req.body.prefix !== undefined ? v.str(req.body.prefix, 40) || null : m.prefix,
    first: v.str(req.body.first_name, 120) || m.first_name,
    last: v.str(req.body.last_name, 120) || m.last_name,
    nick: req.body.nickname !== undefined ? v.str(req.body.nickname, 60) || null : m.nickname,
    gid: groupId,
    phone: req.body.phone !== undefined ? v.str(req.body.phone, 40) || null : m.phone,
    email: req.body.email !== undefined ? email || null : m.email,
    guardian: req.body.guardian !== undefined ? v.str(req.body.guardian, 160) || null : m.guardian,
    note: req.body.note !== undefined ? v.str(req.body.note, 500) || null : m.note,
    sort: v.num(req.body.sort_order, m.sort_order),
    active: req.body.is_active === undefined ? m.is_active : v.bool(req.body.is_active) ? 1 : 0,
  });

  audit.log(req, 'แก้ไขสมาชิก', { targetType: 'member', targetId: id, detail: code });
  res.json({ ok: true });
}));

/* --------------------------------- ลบสมาชิก --------------------------------- */
router.delete('/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) v.fail(404, 'ไม่พบสมาชิกรายนี้');

  const paid = db
    .prepare(
      `SELECT COUNT(*) n FROM payments p JOIN assignments a ON a.id = p.assignment_id
        WHERE a.member_id = ? AND p.status = 'approved'`
    )
    .get(id).n;
  if (paid > 0 && !v.bool(req.query.force)) {
    v.fail(409, `สมาชิกรายนี้มีประวัติการชำระเงินที่อนุมัติแล้ว ${paid} รายการ ระบบแนะนำให้ "ปิดการใช้งาน" แทนการลบ เพื่อรักษาประวัติการเงิน`);
  }

  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  audit.log(req, 'ลบสมาชิก', { targetType: 'member', targetId: id, detail: `${m.member_code} ${m.first_name} ${m.last_name}` });
  res.json({ ok: true });
}));

/* ------------------------------ รีเซ็ตรหัสสมาชิก ------------------------------ */
router.post('/:id(\\d+)/reset-pin', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) v.fail(404, 'ไม่พบสมาชิกรายนี้');

  const pin = v.str(req.body.pin, 20) || generatePin(6, db);
  if (!/^\d{4,12}$/.test(pin)) v.fail(400, 'รหัสสมาชิกต้องเป็นตัวเลข 4-12 หลัก');

  db.prepare("UPDATE members SET pin_hash = ?, pin_plain = ?, pin_reset_at = datetime('now') WHERE id = ?")
    .run(bcrypt.hashSync(pin, PIN_ROUNDS), pin, id);
  audit.log(req, 'รีเซ็ตรหัสสมาชิก', { targetType: 'member', targetId: id, detail: m.member_code });
  res.json({ ok: true, pin, member_code: m.member_code, full_name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim() });
}));

/* ---------------------------- รีเซ็ตรหัสหลายคนพร้อมกัน ---------------------------- */
router.post('/bulk/reset-pin', requireWrite, v.wrap((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v.id).filter(Boolean) : [];
  const groupId = v.id(req.body.group_id);
  const all = v.bool(req.body.all);

  let targets = [];
  if (ids.length) {
    targets = db.prepare(`SELECT * FROM members WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  } else if (groupId) {
    targets = db.prepare('SELECT * FROM members WHERE group_id = ? AND is_active = 1').all(groupId);
  } else if (all) {
    targets = db.prepare('SELECT * FROM members WHERE is_active = 1').all();
  } else {
    v.fail(400, 'กรุณาเลือกสมาชิก กลุ่ม หรือระบุว่าต้องการรีเซ็ตทั้งหมด');
  }
  if (!targets.length) v.fail(400, 'ไม่พบสมาชิกที่ตรงกับเงื่อนไข');

  const upd = db.prepare("UPDATE members SET pin_hash = ?, pin_plain = ?, pin_reset_at = datetime('now') WHERE id = ?");
  const bulkPins = new Set();
  const out = db.transaction(() =>
    targets.map((m) => {
      const pin = generatePin(6, db, bulkPins);
      upd.run(bcrypt.hashSync(pin, PIN_ROUNDS), pin, m.id);
      return {
        id: m.id, member_code: m.member_code,
        full_name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim(), pin,
      };
    })
  )();

  audit.log(req, 'รีเซ็ตรหัสสมาชิกหลายคน', { detail: `จำนวน ${out.length} คน` });
  res.json({ ok: true, count: out.length, members: out });
}));

/* --------------------------- เปิด/ปิดการใช้งานหลายคน --------------------------- */
router.post('/bulk/status', requireWrite, v.wrap((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v.id).filter(Boolean) : [];
  if (!ids.length) v.fail(400, 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
  const active = v.bool(req.body.is_active) ? 1 : 0;
  db.prepare(`UPDATE members SET is_active = ?, updated_at = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(active, ...ids);
  audit.log(req, active ? 'เปิดใช้งานสมาชิก' : 'ปิดใช้งานสมาชิก', { detail: `จำนวน ${ids.length} คน` });
  res.json({ ok: true, count: ids.length });
}));

/* ------------------------------ ย้ายกลุ่มหลายคน ------------------------------ */
router.post('/bulk/group', requireWrite, v.wrap((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v.id).filter(Boolean) : [];
  if (!ids.length) v.fail(400, 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
  const groupId = v.id(req.body.group_id) || resolveGroup(req.body.group_name);
  db.prepare(`UPDATE members SET group_id = ?, updated_at = datetime('now') WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(groupId, ...ids);
  audit.log(req, 'ย้ายกลุ่มสมาชิก', { detail: `จำนวน ${ids.length} คน` });
  res.json({ ok: true, count: ids.length });
}));

/* ----------------------------- ลบสมาชิกหลายคน ----------------------------- */
router.post('/bulk/delete', requireWrite, v.wrap((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v.id).filter(Boolean) : [];
  if (!ids.length) v.fail(400, 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
  const ph = ids.map(() => '?').join(',');
  const blocked = db
    .prepare(
      `SELECT m.id, m.member_code, m.first_name, m.last_name
         FROM members m
        WHERE m.id IN (${ph})
          AND EXISTS (SELECT 1 FROM payments p JOIN assignments a ON a.id = p.assignment_id
                       WHERE a.member_id = m.id AND p.status = 'approved')`
    )
    .all(...ids);

  if (blocked.length && !v.bool(req.body.force)) {
    v.fail(409,
      `มีสมาชิก ${blocked.length} คนที่มีประวัติการชำระเงินแล้ว (เช่น ${blocked.slice(0, 3).map((b) => b.member_code).join(', ')}) ` +
      'ระบบแนะนำให้ปิดการใช้งานแทนการลบ');
  }
  const info = db.prepare(`DELETE FROM members WHERE id IN (${ph})`).run(...ids);
  audit.log(req, 'ลบสมาชิกหลายคน', { detail: `จำนวน ${info.changes} คน` });
  res.json({ ok: true, count: info.changes });
}));

/* --------------------- นำเข้าสมาชิกจากไฟล์ CSV / Excel --------------------- */
router.post('/import', requireWrite, (req, res, next) => {
  importUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'อัปโหลดไฟล์ไม่สำเร็จ' });
    next();
  });
}, v.wrap(async (req, res) => {
  if (!req.file) v.fail(400, 'กรุณาเลือกไฟล์ CSV หรือ Excel');
  const dryRun = v.bool(req.body.dry_run);
  const updateExisting = v.bool(req.body.update_existing);
  const defaultGroupId = v.id(req.body.group_id);

  let parsed;
  try {
    parsed = await parseMembers(req.file.buffer, req.file.originalname);
  } catch (e) {
    v.fail(400, e.message);
  }
  if (!parsed.rows.length) v.fail(400, 'ไม่พบข้อมูลสมาชิกในไฟล์ (ตรวจสอบว่ามีคอลัมน์ ชื่อ/นามสกุล)');

  const findByCode = db.prepare('SELECT * FROM members WHERE member_code = ?');
  const findByName = db.prepare('SELECT * FROM members WHERE first_name = ? AND last_name = ?');
  const result = { created: 0, updated: 0, skipped: 0, errors: [], preview: [], credentials: [] };
  const importPins = new Set();
  const seen = new Set();

  const run = db.transaction(() => {
    for (const r of parsed.rows) {
      try {
        if (!r.first_name || !r.last_name) {
          result.errors.push({ line: r.line, message: 'ข้อมูลชื่อหรือนามสกุลไม่ครบ' });
          result.skipped++;
          continue;
        }
        const key = (r.member_code || `${r.first_name}|${r.last_name}`).toLowerCase();
        if (seen.has(key)) {
          result.errors.push({ line: r.line, message: `ข้อมูลซ้ำในไฟล์: ${r.member_code || r.first_name + ' ' + r.last_name}` });
          result.skipped++;
          continue;
        }
        seen.add(key);

        const existing = r.member_code ? findByCode.get(r.member_code) : findByName.get(r.first_name, r.last_name);
        const groupId = r.group_name ? resolveGroup(r.group_name) : defaultGroupId;

        if (existing) {
          if (!updateExisting) {
            result.skipped++;
            result.preview.push({ line: r.line, action: 'ข้าม (มีอยู่แล้ว)', member_code: existing.member_code, name: `${r.first_name} ${r.last_name}` });
            continue;
          }
          if (!dryRun) {
            db.prepare(
              `UPDATE members SET prefix = COALESCE(NULLIF(?,''), prefix), first_name = ?, last_name = ?,
                      group_id = COALESCE(?, group_id), phone = COALESCE(NULLIF(?,''), phone),
                      email = COALESCE(NULLIF(?,''), email), guardian = COALESCE(NULLIF(?,''), guardian),
                      note = COALESCE(NULLIF(?,''), note), updated_at = datetime('now')
                WHERE id = ?`
            ).run(r.prefix, r.first_name, r.last_name, groupId, r.phone, r.email, r.guardian, r.note, existing.id);
          }
          result.updated++;
          result.preview.push({ line: r.line, action: 'อัปเดต', member_code: existing.member_code, name: `${r.first_name} ${r.last_name}`, group: r.group_name });
          continue;
        }

        const code = r.member_code || generateMemberCode(db);
        const pin = generatePin(6, db, importPins);
        if (!dryRun) {
          db.prepare(
            `INSERT INTO members (member_code, prefix, first_name, last_name, group_id, phone, email,
                                  guardian, note, pin_hash, pin_plain)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).run(code, r.prefix || null, r.first_name, r.last_name, groupId, r.phone || null,
                r.email || null, r.guardian || null, r.note || null, bcrypt.hashSync(pin, PIN_ROUNDS), pin);
          result.credentials.push({ member_code: code, full_name: `${r.prefix || ''}${r.first_name} ${r.last_name}`.trim(), pin, group: r.group_name || '' });
        }
        result.created++;
        result.preview.push({ line: r.line, action: 'เพิ่มใหม่', member_code: code, name: `${r.first_name} ${r.last_name}`, group: r.group_name, amount: r.amount });
      } catch (e) {
        result.errors.push({ line: r.line, message: e.message });
        result.skipped++;
      }
    }
    if (dryRun) throw { __rollback: true };
  });

  try { run(); } catch (e) { if (!e || !e.__rollback) throw e; }

  if (!dryRun) {
    audit.log(req, 'นำเข้าสมาชิกจากไฟล์', {
      detail: `ไฟล์ ${req.file.originalname}: เพิ่ม ${result.created}, อัปเดต ${result.updated}, ข้าม ${result.skipped}`,
    });
  }
  res.json({ ok: true, dry_run: dryRun, file: req.file.originalname, total_rows: parsed.rows.length, ...result });
}));

/* -------------------------- ดาวน์โหลดไฟล์ต้นแบบนำเข้า -------------------------- */
router.get('/template/download', v.wrap(async (req, res) => {
  const format = v.str(req.query.format, 10) || 'xlsx';
  const headers = ['รหัสสมาชิก', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'กลุ่ม', 'เบอร์โทร', 'อีเมล', 'ผู้ปกครอง', 'หมายเหตุ'];
  const sample = [
    ['', 'เด็กชาย', 'สมชาย', 'ใจดี', 'ม.1/1', '0812345678', '', 'นายสมบัติ ใจดี', ''],
    ['', 'เด็กหญิง', 'สมหญิง', 'รักเรียน', 'ม.1/1', '', '', '', ''],
  ];

  if (format === 'csv') {
    const csv = '﻿' + [headers, ...sample].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="member-import-template.csv"');
    return res.send(csv);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('รายชื่อสมาชิก');
  ws.addRow(headers);
  sample.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  ws.getRow(1).height = 22;
  ws.columns.forEach((c, i) => { c.width = [16, 12, 18, 20, 14, 16, 24, 24, 24][i] || 16; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const note = wb.addWorksheet('คำแนะนำ');
  [
    ['วิธีใช้ไฟล์ต้นแบบนำเข้าสมาชิก'],
    [''],
    ['1. กรอกข้อมูลในแผ่นงาน "รายชื่อสมาชิก" โดยห้ามลบหรือแก้ไขแถวหัวตาราง'],
    ['2. คอลัมน์ "รหัสสมาชิก" เว้นว่างได้ ระบบจะสร้างรหัสให้อัตโนมัติ (M0001, M0002, ...)'],
    ['3. คอลัมน์ "กลุ่ม" หากยังไม่มีในระบบ ระบบจะสร้างกลุ่มใหม่ให้อัตโนมัติ'],
    ['4. รองรับทั้งไฟล์ .xlsx และ .csv (บันทึกแบบ UTF-8 หรือ TIS-620 ก็ได้)'],
    ['5. ระบบจะสร้างรหัสยืนยันตัวตน (PIN) 6 หลักให้สมาชิกใหม่ทุกคน และแสดงให้ดาวน์โหลดหลังนำเข้าสำเร็จ'],
    ['6. หากต้องการใช้คอลัมน์ "ชื่อ-สกุล" รวมกัน ระบบจะแยกชื่อและนามสกุลให้อัตโนมัติ'],
  ].forEach((r) => note.addRow(r));
  note.getRow(1).font = { bold: true, size: 14 };
  note.getColumn(1).width = 100;

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="member-import-template.xlsx"');
  res.send(Buffer.from(buf));
}));

module.exports = router;
