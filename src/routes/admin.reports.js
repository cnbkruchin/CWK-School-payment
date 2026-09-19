'use strict';
const express = require('express');

const { db, getSetting } = require('../db');
const finance = require('../services/finance');
const exporter = require('../services/exporter');
const audit = require('../services/audit');
const { requireAdmin } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const { thaiDate, money, bahtText } = require('../utils/thai');
const v = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

const now = () => thaiDate(new Date(), { withTime: true });
const school = () => getSetting('school_name');

/* ================================ แดชบอร์ด ================================ */
router.get('/dashboard', v.wrap((req, res) => {
  const stats = finance.dashboardStats();

  const recent = db
    .prepare(
      `SELECT p.id, p.ref_code, p.amount, p.status, p.created_at, p.verified_at,
              m.member_code, m.prefix, m.first_name, m.last_name, c.name AS collection_name
         FROM payments p
         JOIN assignments a ON a.id = p.assignment_id
         JOIN members m     ON m.id = a.member_id
         JOIN collections c ON c.id = a.collection_id
        WHERE p.status <> 'cancelled'
     ORDER BY p.created_at DESC, p.id DESC LIMIT 12`
    )
    .all()
    .map((r) => ({ ...r, full_name: `${r.prefix || ''}${r.first_name} ${r.last_name}`.trim() }));

  const byCollection = db
    .prepare("SELECT id, code, name, status, due_date FROM collections WHERE status <> 'draft' ORDER BY created_at DESC LIMIT 8")
    .all()
    .map((c) => ({ ...c, summary: finance.summarize(finance.getBoard(c.id)) }));

  // ยอดรับชำระย้อนหลัง 12 เดือน
  const trend = db
    .prepare(
      `SELECT strftime('%Y-%m', verified_at) AS ym, SUM(amount) AS total, COUNT(*) AS cnt
         FROM payments
        WHERE status = 'approved' AND verified_at IS NOT NULL
          AND verified_at >= date('now','-12 months')
     GROUP BY ym ORDER BY ym`
    )
    .all();

  const byGroup = db
    .prepare(
      `SELECT g.id, g.name,
              COUNT(DISTINCT a.id) AS assignments,
              COALESCE(SUM(a.amount_due - a.discount),0) AS due,
              COALESCE((SELECT SUM(p.amount) FROM payments p
                         JOIN assignments a2 ON a2.id = p.assignment_id
                         JOIN members m2 ON m2.id = a2.member_id
                        WHERE m2.group_id = g.id AND p.status='approved'),0) AS paid
         FROM groups g
    LEFT JOIN members m ON m.group_id = g.id
    LEFT JOIN assignments a ON a.member_id = m.id
    LEFT JOIN collections c ON c.id = a.collection_id AND c.status <> 'draft'
     GROUP BY g.id, g.name
     ORDER BY g.sort_order, g.name`
    )
    .all();

  res.json({ stats, recent, by_collection: byCollection, trend, by_group: byGroup });
}));

/* ============================ รายงานภาพรวมทั้งหมด ============================ */
function overviewData(query) {
  const status = v.str(query.status, 20);
  const from = v.dateOnly(query.from);
  const to = v.dateOnly(query.to);

  const where = ["c.status <> 'draft'"];
  const params = [];
  if (status && ['open', 'closed'].includes(status)) { where.push('c.status = ?'); params.push(status); }
  if (from) { where.push('date(c.created_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(c.created_at) <= date(?)'); params.push(to); }

  const cols = db
    .prepare(`SELECT * FROM collections c WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC`)
    .all(...params);

  const rows = cols.map((c) => {
    const s = finance.summarize(finance.getBoard(c.id));
    return {
      code: c.code,
      name: c.name,
      fiscal_year: c.fiscal_year || '-',
      term: c.term || '-',
      due_date: c.due_date,
      status_label: { open: 'เปิดรับชำระ', closed: 'ปิดรับชำระ', draft: 'ฉบับร่าง' }[c.status],
      members: s.total_members,
      total_due: s.total_due,
      total_paid: s.total_paid,
      outstanding: s.total_outstanding,
      paid_count: s.count_paid,
      pending_count: s.count_pending,
      unpaid_count: s.count_unpaid + s.count_rejected,
      percent: s.percent_paid,
      id: c.id,
    };
  });

  const totals = rows.reduce(
    (t, r) => {
      t.members += r.members; t.total_due += r.total_due; t.total_paid += r.total_paid;
      t.outstanding += r.outstanding; t.paid_count += r.paid_count;
      t.pending_count += r.pending_count; t.unpaid_count += r.unpaid_count;
      return t;
    },
    { members: 0, total_due: 0, total_paid: 0, outstanding: 0, paid_count: 0, pending_count: 0, unpaid_count: 0 }
  );
  totals.percent = totals.total_due > 0 ? Math.round((totals.total_paid / totals.total_due) * 1000) / 10 : 0;

  return { rows, totals, filters: { status, from, to } };
}

const OVERVIEW_COLUMNS = [
  { header: 'รหัสรายการ', key: 'code', width: 16 },
  { header: 'วัตถุประสงค์การจัดเก็บ', key: 'name', width: 34, wrap: true },
  { header: 'ปีการศึกษา', key: 'fiscal_year', width: 12, align: 'center' },
  { header: 'ภาคเรียน', key: 'term', width: 10, align: 'center' },
  { header: 'กำหนดชำระ', key: 'due_date', width: 16, type: 'date' },
  { header: 'สถานะ', key: 'status_label', width: 14, align: 'center' },
  { header: 'ผู้ต้องชำระ (คน)', key: 'members', width: 14, type: 'number' },
  { header: 'ยอดที่ต้องเก็บ', key: 'total_due', width: 16, type: 'money' },
  { header: 'ยอดที่เก็บได้', key: 'total_paid', width: 16, type: 'money' },
  { header: 'ยอดค้างชำระ', key: 'outstanding', width: 16, type: 'money' },
  { header: 'ชำระแล้ว (คน)', key: 'paid_count', width: 14, type: 'number' },
  { header: 'รอตรวจสอบ (คน)', key: 'pending_count', width: 14, type: 'number' },
  { header: 'ยังไม่ชำระ (คน)', key: 'unpaid_count', width: 14, type: 'number' },
  { header: 'ร้อยละที่เก็บได้', key: 'percent', width: 14, type: 'number' },
];

router.get('/overview', v.wrap((req, res) => res.json(overviewData(req.query))));

router.get('/overview/export', v.wrap(async (req, res) => {
  const { rows, totals, filters } = overviewData(req.query);
  const fmt = v.str(req.query.format, 10) || 'xlsx';
  const meta = [
    `พิมพ์เมื่อ ${now()}`,
    filters.from || filters.to ? `ช่วงวันที่ ${filters.from ? thaiDate(filters.from) : 'เริ่มต้น'} ถึง ${filters.to ? thaiDate(filters.to) : 'ปัจจุบัน'}` : 'ทุกช่วงเวลา',
  ];
  audit.log(req, 'ออกรายงานภาพรวม', { detail: `รูปแบบ ${fmt}` });

  if (fmt === 'csv') {
    return exporter.sendFile(res, Buffer.from(exporter.buildCsv(OVERVIEW_COLUMNS, rows, { title: `รายงานภาพรวมการรับชำระเงิน — ${school()}`, meta }), 'utf8'),
      `รายงานภาพรวม-${new Date().toISOString().slice(0, 10)}.csv`, exporter.MIME_CSV);
  }
  const buf = await exporter.buildWorkbook({
    title: `รายงานภาพรวมการรับชำระเงิน — ${school()}`,
    subtitle: 'สรุปทุกรายการจัดเก็บ',
    meta,
    sheets: [{ name: 'ภาพรวม', landscape: true, columns: OVERVIEW_COLUMNS, rows, totals: { __label: 'รวมทั้งสิ้น', ...totals } }],
  });
  exporter.sendFile(res, buf, `รายงานภาพรวม-${new Date().toISOString().slice(0, 10)}.xlsx`, exporter.MIME_XLSX);
}));

/* ============================ รายงานรายชุด (รายการจัดเก็บ) ============================ */
function collectionReport(id, query) {
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');

  const board = finance.getBoard(id, {
    search: v.str(query.q, 100),
    groupId: v.id(query.group),
    status: v.str(query.status, 20) || null,
  });

  const rows = board.map((r, i) => ({
    no: i + 1,
    member_code: r.member_code,
    full_name: r.full_name,
    group_name: r.group_name || '-',
    amount_due: r.net_due,
    paid_amount: r.paid_amount,
    outstanding: r.outstanding,
    status_label: r.status_label,
    ref_code: r.latest_ref || '-',
    submitted_at: r.latest_submitted_at,
    verified_at: r.last_verified_at,
    note: r.note || '',
  }));

  const summary = finance.summarize(board);
  const items = db.prepare('SELECT name, amount, is_optional FROM collection_items WHERE collection_id = ? ORDER BY sort_order, id').all(id);
  return { collection: c, rows, summary, items };
}

const COLLECTION_COLUMNS = [
  { header: 'ลำดับ', key: 'no', width: 8, type: 'number' },
  { header: 'รหัสสมาชิก', key: 'member_code', width: 14, align: 'center' },
  { header: 'ชื่อ-สกุล', key: 'full_name', width: 28 },
  { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 14, align: 'center' },
  { header: 'ยอดที่ต้องชำระ', key: 'amount_due', width: 16, type: 'money' },
  { header: 'ยอดที่ชำระแล้ว', key: 'paid_amount', width: 16, type: 'money' },
  { header: 'คงเหลือ', key: 'outstanding', width: 14, type: 'money' },
  { header: 'สถานะ', key: 'status_label', width: 18, align: 'center' },
  { header: 'เลขอ้างอิง', key: 'ref_code', width: 12, align: 'center' },
  { header: 'วันที่แจ้ง', key: 'submitted_at', width: 18, type: 'date' },
  { header: 'วันที่อนุมัติ', key: 'verified_at', width: 18, type: 'date' },
  { header: 'หมายเหตุ', key: 'note', width: 22, wrap: true },
];

router.get('/collection/:id(\\d+)', v.wrap((req, res) => {
  res.json(collectionReport(v.id(req.params.id), req.query));
}));

router.get('/collection/:id(\\d+)/export', v.wrap(async (req, res) => {
  const { collection: c, rows, summary, items } = collectionReport(v.id(req.params.id), req.query);
  const fmt = v.str(req.query.format, 10) || 'xlsx';
  const meta = [
    `รหัสรายการ ${c.code}${c.fiscal_year ? ` • ปีการศึกษา ${c.fiscal_year}` : ''}${c.term ? ` • ภาคเรียนที่ ${c.term}` : ''}`,
    c.due_date ? `กำหนดชำระภายใน ${thaiDate(c.due_date)}` : 'ไม่กำหนดวันครบกำหนด',
    `ผู้ต้องชำระ ${summary.total_members} คน • ชำระแล้ว ${summary.count_paid} คน • รอตรวจสอบ ${summary.count_pending} คน • ยังไม่ชำระ ${summary.count_unpaid + summary.count_rejected} คน`,
    `ยอดที่ต้องเก็บ ${money(summary.total_due)} บาท • เก็บได้ ${money(summary.total_paid)} บาท • คงค้าง ${money(summary.total_outstanding)} บาท`,
    `พิมพ์เมื่อ ${now()}`,
  ];
  audit.log(req, 'ออกรายงานรายชุด', { targetType: 'collection', targetId: c.id, detail: `${c.code} รูปแบบ ${fmt}` });

  const fileBase = `รายงาน-${c.code}`;
  if (fmt === 'csv') {
    return exporter.sendFile(res, Buffer.from(exporter.buildCsv(COLLECTION_COLUMNS, rows, { title: `${c.name} — ${school()}`, meta }), 'utf8'),
      `${fileBase}.csv`, exporter.MIME_CSV);
  }

  const sheets = [{
    name: 'รายชื่อผู้ต้องชำระ', landscape: true, columns: COLLECTION_COLUMNS, rows,
    totals: { __label: 'รวมทั้งสิ้น', amount_due: summary.total_due, paid_amount: summary.total_paid, outstanding: summary.total_outstanding },
  }];
  if (items.length) {
    sheets.push({
      name: 'กิจกรรมย่อย',
      columns: [
        { header: 'กิจกรรมย่อย', key: 'name', width: 40 },
        { header: 'จำนวนเงิน', key: 'amount', width: 16, type: 'money' },
        { header: 'ประเภท', key: 'kind', width: 18, align: 'center' },
      ],
      rows: items.map((it) => ({ name: it.name, amount: it.amount, kind: it.is_optional ? 'เลือกได้' : 'บังคับ' })),
      totals: { __label: 'รวม (เฉพาะรายการบังคับ)', amount: items.filter((i) => !i.is_optional).reduce((s, i) => s + i.amount, 0) },
    });
  }

  const buf = await exporter.buildWorkbook({ title: `${c.name} — ${school()}`, subtitle: 'รายงานการรับชำระเงินรายชุด', meta, sheets });
  exporter.sendFile(res, buf, `${fileBase}.xlsx`, exporter.MIME_XLSX);
}));

/* ============================== รายงานรายบุคคล ============================== */
function memberReport(memberId, query) {
  const m = db
    .prepare('SELECT m.*, g.name AS group_name FROM members m LEFT JOIN groups g ON g.id = m.group_id WHERE m.id = ?')
    .get(memberId);
  if (!m) v.fail(404, 'ไม่พบสมาชิกรายนี้');

  const ledger = finance
    .getMemberLedger(memberId, {
      collectionId: v.id(query.collection),
      from: v.dateOnly(query.from),
      to: v.dateOnly(query.to),
    })
    .filter((r) => r.collection_status !== 'draft');

  const rows = ledger.map((r, i) => ({
    no: i + 1,
    collection_code: r.collection_code,
    collection_name: r.collection_name,
    due_date: r.due_date,
    amount_due: r.net_due,
    paid_amount: r.paid_amount,
    outstanding: r.outstanding,
    status_label: r.status_label,
    ref_code: r.latest_ref || '-',
    verified_at: r.last_verified_at,
  }));

  const payments = db
    .prepare(
      `SELECT p.ref_code, p.amount, p.status, p.method, p.transferred_at, p.created_at,
              p.verified_at, p.receipt_no, c.code AS collection_code, c.name AS collection_name
         FROM payments p
         JOIN assignments a ON a.id = p.assignment_id
         JOIN collections c ON c.id = a.collection_id
        WHERE a.member_id = ? AND p.status <> 'cancelled'
     ORDER BY p.created_at DESC`
    )
    .all(memberId);

  return { member: { ...m, pin_hash: undefined, pin_plain: undefined, full_name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim() },
           rows, payments, totals: finance.summarize(ledger) };
}

const MEMBER_COLUMNS = [
  { header: 'ลำดับ', key: 'no', width: 8, type: 'number' },
  { header: 'รหัสรายการ', key: 'collection_code', width: 16, align: 'center' },
  { header: 'วัตถุประสงค์การจัดเก็บ', key: 'collection_name', width: 36, wrap: true },
  { header: 'กำหนดชำระ', key: 'due_date', width: 16, type: 'date' },
  { header: 'ยอดที่ต้องชำระ', key: 'amount_due', width: 16, type: 'money' },
  { header: 'ยอดที่ชำระแล้ว', key: 'paid_amount', width: 16, type: 'money' },
  { header: 'คงเหลือ', key: 'outstanding', width: 14, type: 'money' },
  { header: 'สถานะ', key: 'status_label', width: 18, align: 'center' },
  { header: 'เลขอ้างอิง', key: 'ref_code', width: 12, align: 'center' },
  { header: 'วันที่อนุมัติ', key: 'verified_at', width: 18, type: 'date' },
];

router.get('/member/:id(\\d+)', v.wrap((req, res) => res.json(memberReport(v.id(req.params.id), req.query))));

router.get('/member/:id(\\d+)/export', v.wrap(async (req, res) => {
  const { member: m, rows, payments, totals } = memberReport(v.id(req.params.id), req.query);
  const fmt = v.str(req.query.format, 10) || 'xlsx';
  const meta = [
    `รหัสสมาชิก ${m.member_code}${m.group_name ? ` • กลุ่ม/ชั้น ${m.group_name}` : ''}`,
    `รวมต้องชำระ ${money(totals.total_due)} บาท • ชำระแล้ว ${money(totals.total_paid)} บาท • คงค้าง ${money(totals.total_outstanding)} บาท`,
    `คิดเป็นตัวอักษร (ยอดที่ชำระแล้ว): ${bahtText(totals.total_paid)}`,
    `พิมพ์เมื่อ ${now()}`,
  ];
  audit.log(req, 'ออกรายงานรายบุคคล', { targetType: 'member', targetId: m.id, detail: `${m.member_code} รูปแบบ ${fmt}` });

  const fileBase = `รายงานรายบุคคล-${m.member_code}`;
  if (fmt === 'csv') {
    return exporter.sendFile(res, Buffer.from(exporter.buildCsv(MEMBER_COLUMNS, rows, { title: `รายงานการชำระเงินรายบุคคล: ${m.full_name} — ${school()}`, meta }), 'utf8'),
      `${fileBase}.csv`, exporter.MIME_CSV);
  }

  const buf = await exporter.buildWorkbook({
    title: `รายงานการชำระเงินรายบุคคล — ${school()}`,
    subtitle: `${m.full_name} (${m.member_code})`,
    meta,
    sheets: [
      { name: 'สรุปรายรอบ', landscape: true, columns: MEMBER_COLUMNS, rows,
        totals: { __label: 'รวมทั้งสิ้น', amount_due: totals.total_due, paid_amount: totals.total_paid, outstanding: totals.total_outstanding } },
      { name: 'ประวัติการแจ้งชำระ', landscape: true,
        columns: [
          { header: 'เลขอ้างอิง', key: 'ref_code', width: 12, align: 'center' },
          { header: 'รายการจัดเก็บ', key: 'collection_name', width: 34, wrap: true },
          { header: 'จำนวนเงิน', key: 'amount', width: 14, type: 'money' },
          { header: 'ช่องทาง', key: 'method_label', width: 12, align: 'center' },
          { header: 'วันที่โอน', key: 'transferred_at', width: 18, type: 'date' },
          { header: 'วันที่แจ้ง', key: 'created_at', width: 18, type: 'date' },
          { header: 'สถานะ', key: 'status_label', width: 16, align: 'center' },
          { header: 'เลขที่ใบเสร็จ', key: 'receipt_no', width: 18, align: 'center' },
        ],
        rows: payments.map((p) => ({
          ...p,
          method_label: { cash: 'เงินสด', transfer: 'โอนเงิน', other: 'อื่น ๆ' }[p.method] || p.method,
          status_label: { pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่าน' }[p.status] || p.status,
          receipt_no: p.receipt_no || '-',
        })),
        totals: { __label: 'รวม', amount: payments.filter((p) => p.status === 'approved').reduce((s, p) => s + p.amount, 0) } },
    ],
  });
  exporter.sendFile(res, buf, `${fileBase}.xlsx`, exporter.MIME_XLSX);
}));

/* ==================== รายงานรวมทุกคน (แยกตามสมาชิก ทุกรอบ) ==================== */
function allMembersReport(query) {
  const groupId = v.id(query.group);
  const from = v.dateOnly(query.from);
  const to = v.dateOnly(query.to);
  const collectionId = v.id(query.collection);

  const params = [];
  let where = 'm.is_active = 1';
  if (groupId) { where += ' AND m.group_id = ?'; params.push(groupId); }

  const members = db
    .prepare(
      `SELECT m.id, m.member_code, m.prefix, m.first_name, m.last_name, g.name AS group_name
         FROM members m LEFT JOIN groups g ON g.id = m.group_id
        WHERE ${where} ORDER BY g.sort_order, g.name, m.sort_order, m.member_code`
    )
    .all(...params);

  const rows = members.map((m, i) => {
    const ledger = finance
      .getMemberLedger(m.id, { collectionId, from, to })
      .filter((r) => r.collection_status !== 'draft');
    const t = finance.summarize(ledger);
    return {
      no: i + 1,
      member_code: m.member_code,
      full_name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim(),
      group_name: m.group_name || '-',
      rounds: ledger.length,
      total_due: t.total_due,
      total_paid: t.total_paid,
      outstanding: t.total_outstanding,
      paid_rounds: t.count_paid,
      unpaid_rounds: t.count_unpaid + t.count_rejected,
      pending_rounds: t.count_pending,
      percent: t.total_due > 0 ? Math.round((t.total_paid / t.total_due) * 1000) / 10 : 0,
      member_id: m.id,
    };
  });

  const totals = rows.reduce(
    (t, r) => {
      t.total_due += r.total_due; t.total_paid += r.total_paid; t.outstanding += r.outstanding;
      t.rounds += r.rounds; t.paid_rounds += r.paid_rounds; t.unpaid_rounds += r.unpaid_rounds;
      t.pending_rounds += r.pending_rounds;
      return t;
    },
    { total_due: 0, total_paid: 0, outstanding: 0, rounds: 0, paid_rounds: 0, unpaid_rounds: 0, pending_rounds: 0 }
  );
  return { rows, totals, filters: { groupId, from, to, collectionId } };
}

const ALL_MEMBERS_COLUMNS = [
  { header: 'ลำดับ', key: 'no', width: 8, type: 'number' },
  { header: 'รหัสสมาชิก', key: 'member_code', width: 14, align: 'center' },
  { header: 'ชื่อ-สกุล', key: 'full_name', width: 28 },
  { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 14, align: 'center' },
  { header: 'จำนวนรอบ', key: 'rounds', width: 12, type: 'number' },
  { header: 'ยอดที่ต้องชำระรวม', key: 'total_due', width: 18, type: 'money' },
  { header: 'ยอดที่ชำระแล้วรวม', key: 'total_paid', width: 18, type: 'money' },
  { header: 'ยอดค้างชำระ', key: 'outstanding', width: 16, type: 'money' },
  { header: 'รอบที่ชำระครบ', key: 'paid_rounds', width: 14, type: 'number' },
  { header: 'รอบที่รอตรวจสอบ', key: 'pending_rounds', width: 15, type: 'number' },
  { header: 'รอบที่ค้างชำระ', key: 'unpaid_rounds', width: 14, type: 'number' },
  { header: 'ร้อยละที่ชำระ', key: 'percent', width: 13, type: 'number' },
];

router.get('/members', v.wrap((req, res) => res.json(allMembersReport(req.query))));

router.get('/members/export', v.wrap(async (req, res) => {
  const { rows, totals, filters } = allMembersReport(req.query);
  const fmt = v.str(req.query.format, 10) || 'xlsx';
  const groupName = filters.groupId ? db.prepare('SELECT name FROM groups WHERE id = ?').get(filters.groupId)?.name : null;
  const colName = filters.collectionId ? db.prepare('SELECT name FROM collections WHERE id = ?').get(filters.collectionId)?.name : null;
  const meta = [
    groupName ? `เฉพาะกลุ่ม/ชั้น ${groupName}` : 'ทุกกลุ่ม/ชั้น',
    colName ? `เฉพาะรายการ ${colName}` : 'ทุกรายการจัดเก็บ',
    filters.from || filters.to ? `ช่วงวันที่ ${filters.from ? thaiDate(filters.from) : 'เริ่มต้น'} ถึง ${filters.to ? thaiDate(filters.to) : 'ปัจจุบัน'}` : 'ทุกช่วงเวลา',
    `พิมพ์เมื่อ ${now()}`,
  ];
  audit.log(req, 'ออกรายงานสรุปรายบุคคลทุกคน', { detail: `รูปแบบ ${fmt}` });

  if (fmt === 'csv') {
    return exporter.sendFile(res, Buffer.from(exporter.buildCsv(ALL_MEMBERS_COLUMNS, rows, { title: `สรุปการชำระเงินรายบุคคล (ทุกคน) — ${school()}`, meta }), 'utf8'),
      `สรุปรายบุคคลทุกคน-${new Date().toISOString().slice(0, 10)}.csv`, exporter.MIME_CSV);
  }
  const buf = await exporter.buildWorkbook({
    title: `สรุปการชำระเงินรายบุคคล (ทุกคน) — ${school()}`,
    subtitle: 'รวมทุกรอบการจัดเก็บ',
    meta,
    sheets: [{ name: 'สรุปรายบุคคล', landscape: true, columns: ALL_MEMBERS_COLUMNS, rows, totals: { __label: 'รวมทั้งสิ้น', ...totals } }],
  });
  exporter.sendFile(res, buf, `สรุปรายบุคคลทุกคน-${new Date().toISOString().slice(0, 10)}.xlsx`, exporter.MIME_XLSX);
}));

/* ======================== รายงานการรับชำระ (ธุรกรรม) ======================== */
function transactionReport(query) {
  const from = v.dateOnly(query.from);
  const to = v.dateOnly(query.to);
  const status = v.str(query.status, 20) || 'approved';
  const collectionId = v.id(query.collection);
  const groupId = v.id(query.group);

  const where = ["p.status <> 'cancelled'"];
  const params = [];
  if (status !== 'all') { where.push('p.status = ?'); params.push(status); }
  if (collectionId) { where.push('a.collection_id = ?'); params.push(collectionId); }
  if (groupId) { where.push('m.group_id = ?'); params.push(groupId); }
  if (from) { where.push('date(COALESCE(p.verified_at, p.created_at)) >= date(?)'); params.push(from); }
  if (to) { where.push('date(COALESCE(p.verified_at, p.created_at)) <= date(?)'); params.push(to); }

  const rows = db
    .prepare(
      `SELECT p.id, p.ref_code, p.amount, p.status, p.method, p.payer_name, p.transferred_at,
              p.created_at, p.verified_at, p.receipt_no,
              m.member_code, m.prefix, m.first_name, m.last_name, g.name AS group_name,
              c.code AS collection_code, c.name AS collection_name, ad.full_name AS verified_by_name
         FROM payments p
         JOIN assignments a ON a.id = p.assignment_id
         JOIN members m     ON m.id = a.member_id
         JOIN collections c ON c.id = a.collection_id
    LEFT JOIN groups g      ON g.id = m.group_id
    LEFT JOIN admins ad     ON ad.id = p.verified_by
        WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(p.verified_at, p.created_at) DESC, p.id DESC`
    )
    .all(...params)
    .map((r, i) => ({
      ...r,
      no: i + 1,
      full_name: `${r.prefix || ''}${r.first_name} ${r.last_name}`.trim(),
      group_name: r.group_name || '-',
      receipt_no: r.receipt_no || '-',
      verified_by_name: r.verified_by_name || '-',
      method_label: { cash: 'เงินสด', transfer: 'โอนเงิน', other: 'อื่น ๆ' }[r.method] || r.method,
      status_label: { pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่าน' }[r.status] || r.status,
    }));

  const total = rows.filter((r) => r.status === 'approved').reduce((s, r) => s + r.amount, 0);
  return { rows, total, count: rows.length, baht_text: bahtText(total), filters: { from, to, status, collectionId, groupId } };
}

router.get('/transactions', v.wrap((req, res) => res.json(transactionReport(req.query))));

const TX_COLUMNS = [
  { header: 'ลำดับ', key: 'no', width: 8, type: 'number' },
  { header: 'เลขอ้างอิง', key: 'ref_code', width: 12, align: 'center' },
  { header: 'เลขที่ใบเสร็จ', key: 'receipt_no', width: 18, align: 'center' },
  { header: 'รหัสสมาชิก', key: 'member_code', width: 14, align: 'center' },
  { header: 'ชื่อ-สกุล', key: 'full_name', width: 26 },
  { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 13, align: 'center' },
  { header: 'รายการจัดเก็บ', key: 'collection_name', width: 30, wrap: true },
  { header: 'จำนวนเงิน', key: 'amount', width: 14, type: 'money' },
  { header: 'ช่องทาง', key: 'method_label', width: 11, align: 'center' },
  { header: 'วันที่โอน', key: 'transferred_at', width: 17, type: 'date' },
  { header: 'วันที่อนุมัติ', key: 'verified_at', width: 17, type: 'date' },
  { header: 'ผู้ตรวจสอบ', key: 'verified_by_name', width: 20 },
  { header: 'สถานะ', key: 'status_label', width: 14, align: 'center' },
];

router.get('/transactions/export', v.wrap(async (req, res) => {
  const data = transactionReport(req.query);
  const fmt = v.str(req.query.format, 10) || 'xlsx';
  const meta = [
    data.filters.from || data.filters.to
      ? `ช่วงวันที่ ${data.filters.from ? thaiDate(data.filters.from) : 'เริ่มต้น'} ถึง ${data.filters.to ? thaiDate(data.filters.to) : 'ปัจจุบัน'}`
      : 'ทุกช่วงเวลา',
    `จำนวน ${data.count} รายการ • ยอดรวมที่อนุมัติแล้ว ${money(data.total)} บาท`,
    `(${data.baht_text})`,
    `พิมพ์เมื่อ ${now()}`,
  ];
  audit.log(req, 'ออกรายงานการรับชำระ', { detail: `รูปแบบ ${fmt}` });

  const base = `รายงานการรับชำระ-${new Date().toISOString().slice(0, 10)}`;
  if (fmt === 'csv') {
    return exporter.sendFile(
      res,
      Buffer.from(exporter.buildCsv(TX_COLUMNS, data.rows, { title: `รายงานการรับชำระเงิน — ${school()}`, meta }), 'utf8'),
      `${base}.csv`,
      exporter.MIME_CSV
    );
  }
  const buf = await exporter.buildWorkbook({
    title: `รายงานการรับชำระเงิน — ${school()}`,
    subtitle: 'รายการธุรกรรมทั้งหมด',
    meta,
    sheets: [{ name: 'รายการรับชำระ', landscape: true, columns: TX_COLUMNS, rows: data.rows, totals: { __label: 'รวม', amount: data.total } }],
  });
  exporter.sendFile(res, buf, `${base}.xlsx`, exporter.MIME_XLSX);
}));

/* ============================== รายชื่อค้างชำระ ============================== */
router.get('/outstanding', v.wrap((req, res) => {
  const collectionId = v.id(req.query.collection);
  const groupId = v.id(req.query.group);

  const cols = collectionId
    ? db.prepare("SELECT * FROM collections WHERE id = ? AND status <> 'draft'").all(collectionId)
    : db.prepare("SELECT * FROM collections WHERE status = 'open'").all();

  const rows = [];
  for (const c of cols) {
    for (const r of finance.getBoard(c.id, { groupId })) {
      if (['unpaid', 'rejected', 'partial'].includes(r.status)) {
        rows.push({
          member_code: r.member_code, full_name: r.full_name, group_name: r.group_name || '-',
          collection_code: c.code, collection_name: c.name, due_date: c.due_date,
          amount_due: r.net_due, paid_amount: r.paid_amount, outstanding: r.outstanding,
          status_label: r.status_label,
          overdue_days: c.due_date ? Math.max(0, Math.floor((Date.now() - new Date(c.due_date + 'T23:59:59')) / 86400000)) : 0,
        });
      }
    }
  }
  rows.sort((a, b) => b.overdue_days - a.overdue_days || b.outstanding - a.outstanding);
  res.json({ rows, total: rows.reduce((s, r) => s + r.outstanding, 0), count: rows.length });
}));

/* ================================ บันทึกกิจกรรม ================================ */
router.get('/audit', v.wrap((req, res) => {
  const page = Math.max(1, v.num(req.query.page, 1));
  const perPage = Math.min(200, Math.max(10, v.num(req.query.per_page, 50)));
  const q = v.str(req.query.q, 100);
  const where = [];
  const params = [];
  if (q) { where.push('(action LIKE ? OR actor_name LIKE ? OR detail LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) n FROM audit_logs ${sql}`).get(...params).n;
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage);
  res.json({ logs: rows, total, page, per_page: perPage, pages: Math.max(1, Math.ceil(total / perPage)) });
}));

module.exports = router;
