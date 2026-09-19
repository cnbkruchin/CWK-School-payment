'use strict';
const { db } = require('../db');

/**
 * สถานะการชำระของสมาชิกแต่ละคนในรายการจัดเก็บ
 *  unpaid   = ยังไม่ชำระ        (ปุ่มสีแดง)
 *  rejected = สลิปไม่ผ่าน       (ปุ่มสีแดง ต้องแจ้งใหม่)
 *  pending  = รอตรวจสอบ         (ปุ่มสีเหลือง)
 *  partial  = ชำระบางส่วน       (ปุ่มสีฟ้า)
 *  paid     = ชำระแล้ว          (ปุ่มสีเขียว)
 *  waived   = ยกเว้นการชำระ     (ปุ่มสีเทา)
 */
const STATUS_LABEL = {
  unpaid: 'ยังไม่ชำระ',
  rejected: 'ไม่ผ่านการตรวจสอบ',
  pending: 'รอตรวจสอบ',
  partial: 'ชำระบางส่วน',
  paid: 'ชำระแล้ว',
  waived: 'ยกเว้นการชำระ',
};

function decideStatus(row) {
  const net = Math.max(0, (Number(row.amount_due) || 0) - (Number(row.discount) || 0));
  const paid = Number(row.paid_amount) || 0;
  const pending = Number(row.pending_count) || 0;
  const rejected = Number(row.rejected_count) || 0;

  if (row.waived) return 'waived';
  if (net <= 0 || paid >= net - 0.005) return 'paid';
  if (paid > 0) return pending > 0 ? 'pending' : 'partial';
  if (pending > 0) return 'pending';
  if (rejected > 0) return 'rejected';
  return 'unpaid';
}

/** SQL ย่อยสำหรับรวมยอดการชำระของแต่ละ assignment */
const PAY_AGG = `
  COALESCE((SELECT SUM(p.amount) FROM payments p
            WHERE p.assignment_id = a.id AND p.status = 'approved'), 0) AS paid_amount,
  COALESCE((SELECT SUM(p.amount) FROM payments p
            WHERE p.assignment_id = a.id AND p.status = 'pending'), 0)  AS pending_amount,
  (SELECT COUNT(*) FROM payments p WHERE p.assignment_id = a.id AND p.status = 'pending')  AS pending_count,
  (SELECT COUNT(*) FROM payments p WHERE p.assignment_id = a.id AND p.status = 'rejected') AS rejected_count,
  (SELECT COUNT(*) FROM payments p WHERE p.assignment_id = a.id AND p.status <> 'cancelled') AS payment_count,
  (SELECT p.ref_code FROM payments p WHERE p.assignment_id = a.id AND p.status <> 'cancelled'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_ref,
  (SELECT p.status FROM payments p WHERE p.assignment_id = a.id AND p.status <> 'cancelled'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_payment_status,
  (SELECT p.created_at FROM payments p WHERE p.assignment_id = a.id AND p.status <> 'cancelled'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS latest_submitted_at,
  (SELECT p.verified_at FROM payments p WHERE p.assignment_id = a.id AND p.status = 'approved'
     ORDER BY p.verified_at DESC, p.id DESC LIMIT 1) AS last_verified_at,
  (SELECT p.reject_reason FROM payments p WHERE p.assignment_id = a.id AND p.status = 'rejected'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS last_reject_reason
`;

function decorate(row) {
  const net = Math.max(0, (Number(row.amount_due) || 0) - (Number(row.discount) || 0));
  const status = decideStatus(row);
  const paid = Number(row.paid_amount) || 0;
  return {
    ...row,
    waived: !!row.waived,
    net_due: net,
    paid_amount: paid,
    outstanding: status === 'waived' ? 0 : Math.max(0, net - paid),
    status,
    status_label: STATUS_LABEL[status],
    full_name: `${row.prefix || ''}${row.first_name} ${row.last_name}`.trim(),
  };
}

/** รายชื่อสมาชิกที่ต้องชำระในรายการจัดเก็บหนึ่ง ๆ พร้อมสถานะ */
function getBoard(collectionId, { search = '', groupId = null, status = null } = {}) {
  const rows = db
    .prepare(
      `SELECT a.id AS assignment_id, a.amount_due, a.discount, a.waived, a.note,
              m.id AS member_id, m.member_code, m.prefix, m.first_name, m.last_name,
              m.group_id, g.name AS group_name, m.is_active,
              ${PAY_AGG}
         FROM assignments a
         JOIN members m ON m.id = a.member_id
    LEFT JOIN groups  g ON g.id = m.group_id
        WHERE a.collection_id = ?
     ORDER BY g.sort_order, g.name, m.sort_order, m.member_code`
    )
    .all(collectionId)
    .map(decorate);

  let out = rows;
  if (groupId) out = out.filter((r) => String(r.group_id) === String(groupId));
  if (status) out = out.filter((r) => r.status === status);
  if (search) {
    const q = String(search).trim().toLowerCase();
    out = out.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        String(r.member_code).toLowerCase().includes(q) ||
        String(r.group_name || '').toLowerCase().includes(q)
    );
  }
  return out;
}

/** สรุปยอดของรายการจัดเก็บ */
function summarize(rows) {
  const s = {
    total_members: rows.length,
    total_due: 0,
    total_paid: 0,
    total_pending: 0,
    total_outstanding: 0,
    count_paid: 0,
    count_pending: 0,
    count_unpaid: 0,
    count_partial: 0,
    count_waived: 0,
    count_rejected: 0,
  };
  for (const r of rows) {
    s.total_due += r.waived ? 0 : r.net_due;
    s.total_paid += r.paid_amount;
    s.total_pending += Number(r.pending_amount) || 0;
    s.total_outstanding += r.outstanding;
    if (r.status === 'paid') s.count_paid++;
    else if (r.status === 'pending') s.count_pending++;
    else if (r.status === 'partial') s.count_partial++;
    else if (r.status === 'waived') s.count_waived++;
    else if (r.status === 'rejected') s.count_rejected++;
    else s.count_unpaid++;
  }
  s.percent_paid = s.total_due > 0 ? Math.round((s.total_paid / s.total_due) * 1000) / 10 : 0;
  return s;
}

/** ข้อมูล assignment เดี่ยว พร้อมสถานะ */
function getAssignment(assignmentId) {
  const row = db
    .prepare(
      `SELECT a.id AS assignment_id, a.collection_id, a.amount_due, a.discount, a.waived, a.note,
              m.id AS member_id, m.member_code, m.prefix, m.first_name, m.last_name, m.pin_hash,
              m.group_id, g.name AS group_name,
              c.name AS collection_name, c.code AS collection_code, c.status AS collection_status,
              c.due_date, c.allow_partial, c.description AS collection_description,
              ${PAY_AGG}
         FROM assignments a
         JOIN members m     ON m.id = a.member_id
         JOIN collections c ON c.id = a.collection_id
    LEFT JOIN groups g      ON g.id = m.group_id
        WHERE a.id = ?`
    )
    .get(assignmentId);
  return row ? decorate(row) : null;
}

/** กิจกรรมย่อยที่สมาชิกรายนี้ต้องชำระ */
function getAssignmentItems(assignmentId) {
  return db
    .prepare(
      `SELECT ai.id, ai.amount, ci.name, ci.description, ci.sort_order
         FROM assignment_items ai
         JOIN collection_items ci ON ci.id = ai.collection_item_id
        WHERE ai.assignment_id = ?
     ORDER BY ci.sort_order, ci.id`
    )
    .all(assignmentId);
}

/** ประวัติการแจ้งชำระของ assignment */
function getPayments(assignmentId) {
  return db
    .prepare(
      `SELECT p.*, ad.full_name AS verified_by_name
         FROM payments p
    LEFT JOIN admins ad ON ad.id = p.verified_by
        WHERE p.assignment_id = ?
     ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(assignmentId);
}

/** รายการทั้งหมดของสมาชิกหนึ่งคน (ทุกรอบการจัดเก็บ) */
function getMemberLedger(memberId, { collectionId = null, status = null, from = null, to = null } = {}) {
  const params = [memberId];
  let where = 'a.member_id = ?';
  if (collectionId) { where += ' AND a.collection_id = ?'; params.push(collectionId); }
  if (from) { where += ' AND date(c.created_at) >= date(?)'; params.push(from); }
  if (to) { where += ' AND date(c.created_at) <= date(?)'; params.push(to); }

  const rows = db
    .prepare(
      `SELECT a.id AS assignment_id, a.collection_id, a.amount_due, a.discount, a.waived, a.note,
              c.code AS collection_code, c.name AS collection_name, c.due_date,
              c.status AS collection_status, c.created_at AS collection_created_at,
              m.member_code, m.prefix, m.first_name, m.last_name, m.group_id,
              g.name AS group_name,
              ${PAY_AGG}
         FROM assignments a
         JOIN collections c ON c.id = a.collection_id
         JOIN members m     ON m.id = a.member_id
    LEFT JOIN groups g      ON g.id = m.group_id
        WHERE ${where}
     ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(...params)
    .map(decorate);

  return status ? rows.filter((r) => r.status === status) : rows;
}

/** ยอดรวมของทั้งระบบ (แดชบอร์ด) */
function dashboardStats() {
  const base = db
    .prepare(
      `SELECT a.id, a.amount_due, a.discount, a.waived, a.collection_id, ${PAY_AGG}
         FROM assignments a
         JOIN collections c ON c.id = a.collection_id
        WHERE c.status <> 'draft'`
    )
    .all()
    .map(decorate);

  const s = summarize(base);
  s.total_collections = db.prepare('SELECT COUNT(*) n FROM collections').get().n;
  s.open_collections = db.prepare("SELECT COUNT(*) n FROM collections WHERE status = 'open'").get().n;
  s.total_active_members = db.prepare('SELECT COUNT(*) n FROM members WHERE is_active = 1').get().n;
  s.pending_payments = db.prepare("SELECT COUNT(*) n FROM payments WHERE status = 'pending'").get().n;
  return s;
}

module.exports = {
  STATUS_LABEL,
  PAY_AGG,
  decideStatus,
  decorate,
  getBoard,
  summarize,
  getAssignment,
  getAssignmentItems,
  getPayments,
  getMemberLedger,
  dashboardStats,
};
