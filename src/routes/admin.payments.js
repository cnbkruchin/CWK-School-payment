'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');

const { db, UPLOAD_DIR, nextReceiptNo, getSetting } = require('../db');
const audit = require('../services/audit');
const finance = require('../services/finance');
const { requireAdmin, requireWrite } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const { generateRefCode } = require('../utils/codes');
const v = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

const STATUS_LABEL = { pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่านการตรวจสอบ', cancelled: 'ยกเลิก' };

const DETAIL_SQL = `
  SELECT p.*, a.amount_due, a.discount, a.waived, a.collection_id,
         m.id AS member_id, m.member_code, m.prefix, m.first_name, m.last_name, m.phone,
         g.name AS group_name,
         c.name AS collection_name, c.code AS collection_code, c.allow_partial,
         ad.full_name AS verified_by_name,
         ba.bank_name, ba.account_number, ba.account_name
    FROM payments p
    JOIN assignments a  ON a.id = p.assignment_id
    JOIN members m      ON m.id = a.member_id
    JOIN collections c  ON c.id = a.collection_id
LEFT JOIN groups g       ON g.id = m.group_id
LEFT JOIN admins ad      ON ad.id = p.verified_by
LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
`;

const shape = (p) => ({
  ...p,
  slip_path: undefined,
  submitted_ip: undefined,
  has_slip: !!p.slip_path,
  status_label: STATUS_LABEL[p.status] || p.status,
  full_name: `${p.prefix || ''}${p.first_name} ${p.last_name}`.trim(),
});

/* ------------------------------ รายการแจ้งชำระ ------------------------------ */
router.get('/', v.wrap((req, res) => {
  const status = v.str(req.query.status, 20);
  const collectionId = v.id(req.query.collection);
  const groupId = v.id(req.query.group);
  const q = v.str(req.query.q, 100);
  const page = Math.max(1, v.num(req.query.page, 1));
  const perPage = Math.min(200, Math.max(10, v.num(req.query.per_page, 50)));

  const where = [];
  const params = [];
  if (status && STATUS_LABEL[status]) { where.push('p.status = ?'); params.push(status); }
  else where.push("p.status <> 'cancelled'");
  if (collectionId) { where.push('a.collection_id = ?'); params.push(collectionId); }
  if (groupId) { where.push('m.group_id = ?'); params.push(groupId); }
  if (q) {
    where.push("(p.ref_code LIKE ? OR m.member_code LIKE ? OR (m.first_name || ' ' || m.last_name) LIKE ? OR p.payer_name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sql = 'WHERE ' + where.join(' AND ');

  const total = db
    .prepare(`SELECT COUNT(*) n FROM payments p JOIN assignments a ON a.id=p.assignment_id JOIN members m ON m.id=a.member_id ${sql}`)
    .get(...params).n;

  const rows = db
    .prepare(`${DETAIL_SQL} ${sql} ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage);

  res.json({
    payments: rows.map(shape),
    total, page, per_page: perPage, pages: Math.max(1, Math.ceil(total / perPage)),
    counts: {
      pending: db.prepare("SELECT COUNT(*) n FROM payments WHERE status='pending'").get().n,
      approved: db.prepare("SELECT COUNT(*) n FROM payments WHERE status='approved'").get().n,
      rejected: db.prepare("SELECT COUNT(*) n FROM payments WHERE status='rejected'").get().n,
    },
  });
}));

/* ---------------------------- รายละเอียดการแจ้งชำระ ---------------------------- */
router.get('/:id(\\d+)', v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare(`${DETAIL_SQL} WHERE p.id = ?`).get(id);
  if (!p) v.fail(404, 'ไม่พบรายการแจ้งชำระนี้');

  const assignment = finance.getAssignment(p.assignment_id);
  const history = finance.getPayments(p.assignment_id).map((x) => ({
    id: x.id, ref_code: x.ref_code, amount: x.amount, status: x.status,
    status_label: STATUS_LABEL[x.status], created_at: x.created_at, verified_at: x.verified_at,
  }));

  // ตรวจหาสลิปที่ซ้ำกับรายการอื่น
  const duplicates = p.slip_hash
    ? db.prepare(
        `SELECT p2.id, p2.ref_code, p2.status, p2.created_at, m2.member_code
           FROM payments p2 JOIN assignments a2 ON a2.id=p2.assignment_id JOIN members m2 ON m2.id=a2.member_id
          WHERE p2.slip_hash = ? AND p2.id <> ? AND p2.status <> 'cancelled'`
      ).all(p.slip_hash, id)
    : [];

  res.json({
    payment: shape(p),
    assignment: assignment ? { ...assignment, pin_hash: undefined } : null,
    items: finance.getAssignmentItems(p.assignment_id),
    history,
    duplicates,
  });
}));

/* ------------------------------- ดูไฟล์สลิป ------------------------------- */
router.get('/:id(\\d+)/slip', v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare('SELECT slip_path, slip_mime, ref_code FROM payments WHERE id = ?').get(id);
  if (!p || !p.slip_path) v.fail(404, 'ไม่พบไฟล์สลิป');

  const abs = path.resolve(UPLOAD_DIR, p.slip_path);
  if (!abs.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(abs)) v.fail(404, 'ไม่พบไฟล์สลิปในระบบ');

  res.setHeader('Content-Type', p.slip_mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  const disp = v.bool(req.query.download) ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename="slip-${p.ref_code}${path.extname(abs)}"`);
  fs.createReadStream(abs).pipe(res);
}));

/* -------------------------------- อนุมัติ -------------------------------- */
router.post('/:id(\\d+)/approve', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) v.fail(404, 'ไม่พบรายการแจ้งชำระนี้');
  if (p.status === 'approved') v.fail(400, 'รายการนี้ได้รับการอนุมัติไปแล้ว');
  if (p.status === 'cancelled') v.fail(400, 'รายการนี้ถูกยกเลิกแล้ว');

  const amount = req.body.amount !== undefined ? v.money(req.body.amount, p.amount) : p.amount;
  if (amount <= 0) v.fail(400, 'จำนวนเงินต้องมากกว่า 0');

  const a = finance.getAssignment(p.assignment_id);
  const alreadyPaid = a.paid_amount;
  if (alreadyPaid + amount > a.net_due + 0.005) {
    v.fail(400, `ยอดรวมหลังอนุมัติ (${(alreadyPaid + amount).toFixed(2)} บาท) เกินยอดที่ต้องชำระ (${a.net_due.toFixed(2)} บาท)`);
  }

  const receiptNo = p.receipt_no || nextReceiptNo();
  db.prepare(
    `UPDATE payments SET status='approved', amount=?, verified_by=?, verified_at=datetime('now'),
            reject_reason=NULL, receipt_no=?, note=COALESCE(?, note), updated_at=datetime('now')
      WHERE id=?`
  ).run(amount, req.admin.id, receiptNo, v.str(req.body.note, 500) || null, id);

  const after = finance.getAssignment(p.assignment_id);
  audit.log(req, 'อนุมัติการชำระเงิน', {
    targetType: 'payment', targetId: id,
    detail: `เลขอ้างอิง ${p.ref_code} ยอด ${amount} บาท (${a.member_code} ${a.full_name}) ใบเสร็จ ${receiptNo}`,
  });
  res.json({
    ok: true, status: 'approved', receipt_no: receiptNo,
    assignment_status: after.status, assignment_status_label: after.status_label,
    message: `อนุมัติเรียบร้อย สถานะของ ${a.full_name} เปลี่ยนเป็น "${after.status_label}"`,
  });
}));

/* ------------------------------- ไม่อนุมัติ ------------------------------- */
router.post('/:id(\\d+)/reject', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) v.fail(404, 'ไม่พบรายการแจ้งชำระนี้');
  if (p.status === 'cancelled') v.fail(400, 'รายการนี้ถูกยกเลิกแล้ว');

  const reason = v.str(req.body.reason, 500);
  if (!reason) v.fail(400, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ เพื่อให้สมาชิกทราบและแจ้งใหม่ได้ถูกต้อง');

  db.prepare(
    `UPDATE payments SET status='rejected', reject_reason=?, verified_by=?, verified_at=datetime('now'),
            receipt_no=NULL, updated_at=datetime('now') WHERE id=?`
  ).run(reason, req.admin.id, id);

  const a = finance.getAssignment(p.assignment_id);
  audit.log(req, 'ไม่อนุมัติการชำระเงิน', {
    targetType: 'payment', targetId: id, detail: `เลขอ้างอิง ${p.ref_code}: ${reason}`,
  });
  res.json({ ok: true, status: 'rejected', assignment_status: a.status, assignment_status_label: a.status_label });
}));

/* --------------------------- คืนสถานะเป็นรอตรวจสอบ --------------------------- */
router.post('/:id(\\d+)/revert', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) v.fail(404, 'ไม่พบรายการแจ้งชำระนี้');
  if (p.status === 'pending') v.fail(400, 'รายการนี้อยู่ในสถานะรอตรวจสอบอยู่แล้ว');

  db.prepare(
    `UPDATE payments SET status='pending', verified_by=NULL, verified_at=NULL,
            reject_reason=NULL, receipt_no=NULL, updated_at=datetime('now') WHERE id=?`
  ).run(id);
  audit.log(req, 'คืนสถานะการชำระเงินเป็นรอตรวจสอบ', { targetType: 'payment', targetId: id, detail: `เลขอ้างอิง ${p.ref_code}` });
  res.json({ ok: true, status: 'pending' });
}));

/* -------------------------------- ยกเลิกรายการ -------------------------------- */
router.post('/:id(\\d+)/cancel', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) v.fail(404, 'ไม่พบรายการแจ้งชำระนี้');

  db.prepare(
    `UPDATE payments SET status='cancelled', reject_reason=?, verified_by=?, verified_at=datetime('now'),
            receipt_no=NULL, updated_at=datetime('now') WHERE id=?`
  ).run(v.str(req.body.reason, 500) || 'ยกเลิกโดยผู้ดูแลระบบ', req.admin.id, id);
  audit.log(req, 'ยกเลิกรายการแจ้งชำระ', { targetType: 'payment', targetId: id, detail: `เลขอ้างอิง ${p.ref_code}` });
  res.json({ ok: true, status: 'cancelled' });
}));

/* ---------------------------- อนุมัติหลายรายการพร้อมกัน ---------------------------- */
router.post('/bulk/approve', requireWrite, v.wrap((req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(v.id).filter(Boolean) : [];
  if (!ids.length) v.fail(400, 'กรุณาเลือกรายการอย่างน้อย 1 รายการ');

  const result = { approved: 0, failed: [] };
  const get = db.prepare('SELECT * FROM payments WHERE id = ?');
  const upd = db.prepare(
    `UPDATE payments SET status='approved', verified_by=?, verified_at=datetime('now'),
            reject_reason=NULL, receipt_no=?, updated_at=datetime('now') WHERE id=?`
  );

  for (const id of ids) {
    const p = get.get(id);
    if (!p) { result.failed.push({ id, reason: 'ไม่พบรายการ' }); continue; }
    if (p.status === 'approved') { result.failed.push({ id, reason: 'อนุมัติไปแล้ว' }); continue; }
    const a = finance.getAssignment(p.assignment_id);
    if (!a) { result.failed.push({ id, reason: 'ไม่พบรายการที่ต้องชำระ' }); continue; }
    if (a.paid_amount + p.amount > a.net_due + 0.005) {
      result.failed.push({ id, ref_code: p.ref_code, reason: 'ยอดรวมเกินยอดที่ต้องชำระ' });
      continue;
    }
    upd.run(req.admin.id, p.receipt_no || nextReceiptNo(), id);
    result.approved++;
  }

  audit.log(req, 'อนุมัติการชำระเงินหลายรายการ', { detail: `อนุมัติ ${result.approved} รายการ, ไม่สำเร็จ ${result.failed.length} รายการ` });
  res.json({ ok: true, ...result });
}));

/* ------------------- บันทึกการชำระด้วยเงินสด/ที่โรงเรียน (โดยแอดมิน) ------------------- */
router.post('/manual', requireWrite, v.wrap((req, res) => {
  const assignmentId = v.id(req.body.assignment_id);
  if (!assignmentId) v.fail(400, 'กรุณาระบุรายการที่ต้องชำระ');
  const a = finance.getAssignment(assignmentId);
  if (!a) v.fail(404, 'ไม่พบรายการที่ต้องชำระ');
  if (a.waived) v.fail(400, 'รายการนี้ได้รับการยกเว้นการชำระ');
  if (a.outstanding <= 0) v.fail(400, 'รายการนี้ชำระครบแล้ว');

  const amount = v.money(req.body.amount, a.outstanding) || a.outstanding;
  if (amount > a.outstanding + 0.005) v.fail(400, `จำนวนเงินเกินยอดคงเหลือ (${a.outstanding.toFixed(2)} บาท)`);

  const method = ['cash', 'transfer', 'other'].includes(v.str(req.body.method, 20)) ? v.str(req.body.method, 20) : 'cash';
  const refCode = generateRefCode(db);
  const receiptNo = nextReceiptNo();

  const info = db
    .prepare(
      `INSERT INTO payments (ref_code, assignment_id, amount, method, payer_name, transferred_at,
                             note, status, verified_by, verified_at, receipt_no)
       VALUES (?,?,?,?,?,?,?, 'approved', ?, datetime('now'), ?)`
    )
    .run(refCode, assignmentId, amount, method,
         v.str(req.body.payer_name, 120) || a.full_name,
         v.dateTime(req.body.transferred_at) || new Date().toISOString().slice(0, 19).replace('T', ' '),
         v.str(req.body.note, 500) || 'บันทึกโดยผู้ดูแลระบบ', req.admin.id, receiptNo);

  audit.log(req, 'บันทึกการชำระเงินโดยผู้ดูแล', {
    targetType: 'payment', targetId: info.lastInsertRowid,
    detail: `${a.member_code} ${a.full_name} ยอด ${amount} บาท (${method === 'cash' ? 'เงินสด' : method})`,
  });
  const after = finance.getAssignment(assignmentId);
  res.status(201).json({
    ok: true, id: info.lastInsertRowid, ref_code: refCode, receipt_no: receiptNo,
    assignment_status: after.status, assignment_status_label: after.status_label,
  });
}));

/* -------------------------------- ใบเสร็จรับเงิน -------------------------------- */
router.get('/:id(\\d+)/receipt', v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const p = db.prepare(`${DETAIL_SQL} WHERE p.id = ?`).get(id);
  if (!p) v.fail(404, 'ไม่พบรายการแจ้งชำระนี้');
  if (p.status !== 'approved') v.fail(400, 'ออกใบเสร็จได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น');

  res.json({
    receipt: {
      receipt_no: p.receipt_no,
      ref_code: p.ref_code,
      amount: p.amount,
      method: p.method,
      payer_name: p.payer_name,
      paid_at: p.verified_at,
      transferred_at: p.transferred_at,
      member: {
        member_code: p.member_code,
        full_name: `${p.prefix || ''}${p.first_name} ${p.last_name}`.trim(),
        group_name: p.group_name,
      },
      collection: { code: p.collection_code, name: p.collection_name },
      items: finance.getAssignmentItems(p.assignment_id),
      verified_by_name: p.verified_by_name,
      school: {
        name: getSetting('school_name'),
        address: getSetting('school_address'),
        phone: getSetting('school_phone'),
        logo: getSetting('school_logo'),
      },
    },
  });
}));

module.exports = router;
