'use strict';
const express = require('express');

const { db } = require('../db');
const audit = require('../services/audit');
const finance = require('../services/finance');
const { requireAdmin, requireWrite } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const { generateCollectionCode } = require('../utils/codes');
const v = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

const VALID_STATUS = ['draft', 'open', 'closed'];

/** ยอดรวมของกิจกรรมย่อยที่ไม่ใช่รายการเลือกเพิ่ม */
function baseAmount(collectionId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount),0) s FROM collection_items WHERE collection_id = ? AND is_optional = 0')
    .get(collectionId);
  return Math.round((row.s || 0) * 100) / 100;
}

/** คำนวณยอดที่ต้องชำระของสมาชิกจากกิจกรรมย่อยที่เลือกไว้ */
function recalcAssignment(assignmentId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM assignment_items WHERE assignment_id = ?')
    .get(assignmentId);
  if (row.n > 0) {
    db.prepare("UPDATE assignments SET amount_due = ?, updated_at = datetime('now') WHERE id = ?")
      .run(Math.round(row.s * 100) / 100, assignmentId);
  }
}

/* ----------------------------- รายการจัดเก็บทั้งหมด ----------------------------- */
router.get('/', v.wrap((req, res) => {
  const status = v.str(req.query.status, 20);
  const q = v.str(req.query.q, 100);
  const where = [];
  const params = [];
  if (status && VALID_STATUS.includes(status)) { where.push('c.status = ?'); params.push(status); }
  if (q) { where.push('(c.name LIKE ? OR c.code LIKE ? OR c.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db
    .prepare(
      `SELECT c.*, a.full_name AS created_by_name,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count,
              (SELECT COUNT(*) FROM assignments asg WHERE asg.collection_id = c.id) AS member_count
         FROM collections c LEFT JOIN admins a ON a.id = c.created_by
         ${sql}
     ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(...params);

  res.json({
    collections: rows.map((c) => ({ ...c, summary: finance.summarize(finance.getBoard(c.id)) })),
  });
}));

/* ------------------------------ รายละเอียดรายการ ------------------------------ */
router.get('/:id(\\d+)', v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');

  const items = db.prepare('SELECT * FROM collection_items WHERE collection_id = ? ORDER BY sort_order, id').all(id);
  const board = finance.getBoard(id, {
    search: v.str(req.query.q, 100),
    groupId: v.id(req.query.group),
    status: v.str(req.query.status, 20) || null,
  });

  res.json({
    collection: { ...c, base_amount: baseAmount(id) },
    items,
    members: board,
    summary: finance.summarize(finance.getBoard(id)),
    groups: db.prepare('SELECT id, name FROM groups ORDER BY sort_order, name').all(),
  });
}));

/* ------------------------------ สร้างรายการจัดเก็บ ------------------------------ */
router.post('/', requireWrite, v.wrap((req, res) => {
  const name = v.str(req.body.name, 200);
  if (!name) v.fail(400, 'กรุณาระบุชื่อ/วัตถุประสงค์ของการจัดเก็บ');

  let code = v.str(req.body.code, 40);
  if (code && db.prepare('SELECT 1 FROM collections WHERE code = ?').get(code)) v.fail(409, `รหัสรายการ "${code}" ถูกใช้ไปแล้ว`);
  if (!code) code = generateCollectionCode(db);

  const status = VALID_STATUS.includes(v.str(req.body.status, 20)) ? v.str(req.body.status, 20) : 'draft';
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  const out = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO collections (code, name, description, fiscal_year, term, default_amount,
                                  due_date, allow_partial, status, is_public, created_by)
         VALUES (@code,@name,@desc,@fy,@term,@amount,@due,@partial,@status,@pub,@by)`
      )
      .run({
        code, name,
        desc: v.str(req.body.description, 1000) || null,
        fy: v.str(req.body.fiscal_year, 20) || null,
        term: v.str(req.body.term, 20) || null,
        amount: v.money(req.body.default_amount, 0),
        due: v.dateOnly(req.body.due_date),
        partial: v.bool(req.body.allow_partial) ? 1 : 0,
        status,
        pub: req.body.is_public === undefined ? 1 : v.bool(req.body.is_public) ? 1 : 0,
        by: req.admin.id,
      });
    const cid = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO collection_items (collection_id, name, description, amount, is_optional, sort_order) VALUES (?,?,?,?,?,?)');
    items.forEach((it, i) => {
      const n = v.str(it.name, 200);
      if (!n) return;
      ins.run(cid, n, v.str(it.description, 500) || null, v.money(it.amount, 0), v.bool(it.is_optional) ? 1 : 0, v.num(it.sort_order, i));
    });
    return cid;
  })();

  audit.log(req, 'สร้างรายการจัดเก็บ', { targetType: 'collection', targetId: out, detail: `${code} — ${name}` });
  res.status(201).json({ ok: true, id: out, code });
}));

/* ------------------------------ แก้ไขรายการจัดเก็บ ------------------------------ */
router.put('/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');

  const code = v.str(req.body.code, 40) || c.code;
  if (code !== c.code && db.prepare('SELECT 1 FROM collections WHERE code = ?').get(code)) v.fail(409, `รหัสรายการ "${code}" ถูกใช้ไปแล้ว`);
  const status = VALID_STATUS.includes(v.str(req.body.status, 20)) ? v.str(req.body.status, 20) : c.status;

  db.prepare(
    `UPDATE collections SET code=@code, name=@name, description=@desc, fiscal_year=@fy, term=@term,
            default_amount=@amount, due_date=@due, allow_partial=@partial, status=@status,
            is_public=@pub, updated_at=datetime('now')
      WHERE id=@id`
  ).run({
    id, code,
    name: v.str(req.body.name, 200) || c.name,
    desc: req.body.description !== undefined ? v.str(req.body.description, 1000) || null : c.description,
    fy: req.body.fiscal_year !== undefined ? v.str(req.body.fiscal_year, 20) || null : c.fiscal_year,
    term: req.body.term !== undefined ? v.str(req.body.term, 20) || null : c.term,
    amount: req.body.default_amount !== undefined ? v.money(req.body.default_amount, 0) : c.default_amount,
    due: req.body.due_date !== undefined ? v.dateOnly(req.body.due_date) : c.due_date,
    partial: req.body.allow_partial !== undefined ? (v.bool(req.body.allow_partial) ? 1 : 0) : c.allow_partial,
    status,
    pub: req.body.is_public !== undefined ? (v.bool(req.body.is_public) ? 1 : 0) : c.is_public,
  });

  audit.log(req, 'แก้ไขรายการจัดเก็บ', { targetType: 'collection', targetId: id, detail: `${code} — ${v.str(req.body.name, 200) || c.name}` });
  res.json({ ok: true });
}));

/* ------------------------------ ลบรายการจัดเก็บ ------------------------------ */
router.delete('/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');

  const paid = db
    .prepare(
      `SELECT COUNT(*) n FROM payments p JOIN assignments a ON a.id = p.assignment_id
        WHERE a.collection_id = ? AND p.status = 'approved'`
    )
    .get(id).n;
  if (paid > 0 && !v.bool(req.query.force)) {
    v.fail(409, `รายการนี้มีการชำระเงินที่อนุมัติแล้ว ${paid} รายการ หากต้องการลบจริงกรุณายืนยันอีกครั้ง (ข้อมูลการเงินจะหายทั้งหมด)`);
  }

  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  audit.log(req, 'ลบรายการจัดเก็บ', { targetType: 'collection', targetId: id, detail: `${c.code} — ${c.name}` });
  res.json({ ok: true });
}));

/* ------------------------- เปลี่ยนสถานะเปิด/ปิดรับชำระ ------------------------- */
router.post('/:id(\\d+)/status', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const status = v.str(req.body.status, 20);
  if (!VALID_STATUS.includes(status)) v.fail(400, 'สถานะไม่ถูกต้อง');
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');
  if (status === 'open') {
    const n = db.prepare('SELECT COUNT(*) n FROM assignments WHERE collection_id = ?').get(id).n;
    if (n === 0) v.fail(400, 'ยังไม่ได้กำหนดผู้ที่ต้องชำระ กรุณาเพิ่มสมาชิกเข้ารายการนี้ก่อนเปิดรับชำระ');
  }
  db.prepare("UPDATE collections SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  const label = { draft: 'ฉบับร่าง', open: 'เปิดรับชำระ', closed: 'ปิดรับชำระ' }[status];
  audit.log(req, 'เปลี่ยนสถานะรายการจัดเก็บ', { targetType: 'collection', targetId: id, detail: `${c.code} → ${label}` });
  res.json({ ok: true, status });
}));

/* ------------------------------- ทำสำเนารายการ ------------------------------- */
router.post('/:id(\\d+)/duplicate', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');
  const withMembers = v.bool(req.body.with_members);

  const newId = db.transaction(() => {
    const code = generateCollectionCode(db);
    const info = db
      .prepare(
        `INSERT INTO collections (code, name, description, fiscal_year, term, default_amount,
                                  due_date, allow_partial, status, is_public, created_by)
         VALUES (?,?,?,?,?,?,?,?, 'draft', ?, ?)`
      )
      .run(code, `${c.name} (สำเนา)`, c.description, c.fiscal_year, c.term, c.default_amount,
           c.due_date, c.allow_partial, c.is_public, req.admin.id);
    const cid = info.lastInsertRowid;

    const items = db.prepare('SELECT * FROM collection_items WHERE collection_id = ? ORDER BY sort_order, id').all(id);
    const insItem = db.prepare('INSERT INTO collection_items (collection_id, name, description, amount, is_optional, sort_order) VALUES (?,?,?,?,?,?)');
    for (const it of items) insItem.run(cid, it.name, it.description, it.amount, it.is_optional, it.sort_order);

    if (withMembers) {
      const asg = db.prepare('SELECT member_id, amount_due, discount, waived, note FROM assignments WHERE collection_id = ?').all(id);
      const insA = db.prepare('INSERT INTO assignments (collection_id, member_id, amount_due, discount, waived, note, created_by) VALUES (?,?,?,?,?,?,?)');
      for (const a of asg) insA.run(cid, a.member_id, a.amount_due, a.discount, a.waived, a.note, req.admin.id);
    }
    return cid;
  })();

  audit.log(req, 'ทำสำเนารายการจัดเก็บ', { targetType: 'collection', targetId: newId, detail: `จาก ${c.code}` });
  res.status(201).json({ ok: true, id: newId });
}));

/* ============================ กิจกรรมย่อย (ไม่จำกัดจำนวน) ============================ */
router.post('/:id(\\d+)/items', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');
  const name = v.str(req.body.name, 200);
  if (!name) v.fail(400, 'กรุณาระบุชื่อกิจกรรมย่อย');

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM collection_items WHERE collection_id = ?').get(id).m;
  const info = db
    .prepare('INSERT INTO collection_items (collection_id, name, description, amount, is_optional, sort_order) VALUES (?,?,?,?,?,?)')
    .run(id, name, v.str(req.body.description, 500) || null, v.money(req.body.amount, 0),
         v.bool(req.body.is_optional) ? 1 : 0, v.num(req.body.sort_order, maxOrder + 1));

  audit.log(req, 'เพิ่มกิจกรรมย่อย', { targetType: 'collection', targetId: id, detail: `${name} (${v.money(req.body.amount, 0)} บาท)` });
  res.status(201).json({ ok: true, id: info.lastInsertRowid, base_amount: baseAmount(id) });
}));

router.put('/:id(\\d+)/items/:itemId(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const itemId = v.id(req.params.itemId);
  const it = db.prepare('SELECT * FROM collection_items WHERE id = ? AND collection_id = ?').get(itemId, id);
  if (!it) v.fail(404, 'ไม่พบกิจกรรมย่อยนี้');

  db.prepare('UPDATE collection_items SET name=?, description=?, amount=?, is_optional=?, sort_order=? WHERE id=?')
    .run(
      v.str(req.body.name, 200) || it.name,
      req.body.description !== undefined ? v.str(req.body.description, 500) || null : it.description,
      req.body.amount !== undefined ? v.money(req.body.amount, 0) : it.amount,
      req.body.is_optional !== undefined ? (v.bool(req.body.is_optional) ? 1 : 0) : it.is_optional,
      v.num(req.body.sort_order, it.sort_order),
      itemId
    );

  // ปรับยอดของสมาชิกที่ผูกกับกิจกรรมย่อยนี้ไว้
  if (req.body.amount !== undefined) {
    const amt = v.money(req.body.amount, 0);
    db.prepare('UPDATE assignment_items SET amount = ? WHERE collection_item_id = ?').run(amt, itemId);
    for (const r of db.prepare('SELECT DISTINCT assignment_id FROM assignment_items WHERE collection_item_id = ?').all(itemId)) {
      recalcAssignment(r.assignment_id);
    }
  }
  audit.log(req, 'แก้ไขกิจกรรมย่อย', { targetType: 'collection', targetId: id, detail: v.str(req.body.name, 200) || it.name });
  res.json({ ok: true, base_amount: baseAmount(id) });
}));

router.delete('/:id(\\d+)/items/:itemId(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const itemId = v.id(req.params.itemId);
  const it = db.prepare('SELECT * FROM collection_items WHERE id = ? AND collection_id = ?').get(itemId, id);
  if (!it) v.fail(404, 'ไม่พบกิจกรรมย่อยนี้');

  const affected = db.prepare('SELECT DISTINCT assignment_id FROM assignment_items WHERE collection_item_id = ?').all(itemId);
  db.prepare('DELETE FROM collection_items WHERE id = ?').run(itemId);
  for (const r of affected) recalcAssignment(r.assignment_id);

  audit.log(req, 'ลบกิจกรรมย่อย', { targetType: 'collection', targetId: id, detail: it.name });
  res.json({ ok: true, base_amount: baseAmount(id) });
}));

/* ==================== กำหนดผู้ที่ต้องชำระ (รายกลุ่ม / รายบุคคล) ==================== */
router.post('/:id(\\d+)/assign', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const c = db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  if (!c) v.fail(404, 'ไม่พบรายการจัดเก็บนี้');

  const mode = v.str(req.body.mode, 20) || 'members';   // members | group | all
  const memberIds = Array.isArray(req.body.member_ids) ? req.body.member_ids.map(v.id).filter(Boolean) : [];
  const groupIds = Array.isArray(req.body.group_ids) ? req.body.group_ids.map(v.id).filter(Boolean) : [];
  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(v.id).filter(Boolean) : [];
  const overwrite = v.bool(req.body.overwrite);

  let targets = [];
  if (mode === 'all') {
    targets = db.prepare('SELECT id FROM members WHERE is_active = 1').all().map((r) => r.id);
  } else if (mode === 'group') {
    if (!groupIds.length) v.fail(400, 'กรุณาเลือกกลุ่มอย่างน้อย 1 กลุ่ม');
    targets = db
      .prepare(`SELECT id FROM members WHERE is_active = 1 AND group_id IN (${groupIds.map(() => '?').join(',')})`)
      .all(...groupIds).map((r) => r.id);
  } else {
    if (!memberIds.length) v.fail(400, 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
    targets = memberIds;
  }
  if (!targets.length) v.fail(400, 'ไม่พบสมาชิกที่ตรงกับเงื่อนไขที่เลือก');

  // กำหนดยอด: จากกิจกรรมย่อยที่เลือก > ยอดที่ระบุ > ยอดรวมกิจกรรมย่อยบังคับ > ยอดตั้งต้น
  let amount;
  let chosenItems = [];
  if (itemIds.length) {
    chosenItems = db
      .prepare(`SELECT * FROM collection_items WHERE collection_id = ? AND id IN (${itemIds.map(() => '?').join(',')})`)
      .all(id, ...itemIds);
    amount = Math.round(chosenItems.reduce((s, it) => s + Number(it.amount), 0) * 100) / 100;
  } else if (req.body.amount !== undefined && req.body.amount !== '') {
    amount = v.money(req.body.amount, 0);
  } else {
    const base = baseAmount(id);
    amount = base > 0 ? base : Number(c.default_amount) || 0;
  }

  const discount = v.money(req.body.discount, 0);
  const note = v.str(req.body.note, 500) || null;
  const waived = v.bool(req.body.waived) ? 1 : 0;

  const stats = { created: 0, updated: 0, skipped: 0 };
  const existing = db.prepare('SELECT id FROM assignments WHERE collection_id = ? AND member_id = ?');
  const insA = db.prepare(
    'INSERT INTO assignments (collection_id, member_id, amount_due, discount, waived, note, created_by) VALUES (?,?,?,?,?,?,?)'
  );
  const updA = db.prepare("UPDATE assignments SET amount_due=?, discount=?, waived=?, note=?, updated_at=datetime('now') WHERE id=?");
  const delItems = db.prepare('DELETE FROM assignment_items WHERE assignment_id = ?');
  const insItem = db.prepare('INSERT INTO assignment_items (assignment_id, collection_item_id, amount) VALUES (?,?,?)');
  const hasPayments = db.prepare("SELECT COUNT(*) n FROM payments WHERE assignment_id = ? AND status <> 'cancelled'");

  db.transaction(() => {
    for (const mid of targets) {
      const ex = existing.get(id, mid);
      let aid;
      if (ex) {
        if (!overwrite) { stats.skipped++; continue; }
        if (hasPayments.get(ex.id).n > 0) { stats.skipped++; continue; } // ไม่แก้ไขรายการที่มีการแจ้งชำระแล้ว
        updA.run(amount, discount, waived, note, ex.id);
        aid = ex.id;
        stats.updated++;
      } else {
        aid = insA.run(id, mid, amount, discount, waived, note, req.admin.id).lastInsertRowid;
        stats.created++;
      }
      delItems.run(aid);
      for (const it of chosenItems) insItem.run(aid, it.id, it.amount);
    }
  })();

  audit.log(req, 'กำหนดผู้ที่ต้องชำระ', {
    targetType: 'collection', targetId: id,
    detail: `${c.code}: เพิ่ม ${stats.created}, แก้ไข ${stats.updated}, ข้าม ${stats.skipped} (ยอด ${amount} บาท)`,
  });
  res.json({ ok: true, ...stats, amount });
}));

/** แก้ไขยอดของสมาชิกรายคนในรายการนี้ */
router.put('/:id(\\d+)/assignments/:assignmentId(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const aid = v.id(req.params.assignmentId);
  const a = db.prepare('SELECT * FROM assignments WHERE id = ? AND collection_id = ?').get(aid, id);
  if (!a) v.fail(404, 'ไม่พบรายการของสมาชิกรายนี้');

  const amount = req.body.amount_due !== undefined ? v.money(req.body.amount_due, 0) : a.amount_due;
  const discount = req.body.discount !== undefined ? v.money(req.body.discount, 0) : a.discount;
  const waived = req.body.waived !== undefined ? (v.bool(req.body.waived) ? 1 : 0) : a.waived;

  const approved = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE assignment_id = ? AND status='approved'").get(aid).s;
  if (amount - discount + 0.005 < approved) {
    v.fail(400, `ยอดใหม่ (${(amount - discount).toFixed(2)} บาท) น้อยกว่ายอดที่ชำระและอนุมัติแล้ว (${approved.toFixed(2)} บาท)`);
  }

  db.prepare("UPDATE assignments SET amount_due=?, discount=?, waived=?, note=?, updated_at=datetime('now') WHERE id=?")
    .run(amount, discount, waived, req.body.note !== undefined ? v.str(req.body.note, 500) || null : a.note, aid);

  audit.log(req, 'แก้ไขยอดที่ต้องชำระ', { targetType: 'assignment', targetId: aid, detail: `ยอด ${amount} ส่วนลด ${discount}` });
  res.json({ ok: true });
}));

/** นำสมาชิกออกจากรายการจัดเก็บ */
router.delete('/:id(\\d+)/assignments/:assignmentId(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const aid = v.id(req.params.assignmentId);
  const a = db.prepare('SELECT * FROM assignments WHERE id = ? AND collection_id = ?').get(aid, id);
  if (!a) v.fail(404, 'ไม่พบรายการของสมาชิกรายนี้');

  const n = db.prepare("SELECT COUNT(*) n FROM payments WHERE assignment_id = ? AND status <> 'cancelled'").get(aid).n;
  if (n > 0 && !v.bool(req.query.force)) {
    v.fail(409, `สมาชิกรายนี้มีการแจ้งชำระแล้ว ${n} รายการ หากนำออกข้อมูลการชำระจะถูกลบด้วย`);
  }
  db.prepare('DELETE FROM assignments WHERE id = ?').run(aid);
  audit.log(req, 'นำสมาชิกออกจากรายการจัดเก็บ', { targetType: 'collection', targetId: id, detail: `assignment #${aid}` });
  res.json({ ok: true });
}));

/** นำสมาชิกออกหลายคน */
router.post('/:id(\\d+)/assignments/bulk-delete', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const ids = Array.isArray(req.body.assignment_ids) ? req.body.assignment_ids.map(v.id).filter(Boolean) : [];
  if (!ids.length) v.fail(400, 'กรุณาเลือกอย่างน้อย 1 รายการ');
  const ph = ids.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM assignments WHERE collection_id = ? AND id IN (${ph})`).run(id, ...ids);
  audit.log(req, 'นำสมาชิกออกจากรายการจัดเก็บ (หลายคน)', { targetType: 'collection', targetId: id, detail: `จำนวน ${info.changes}` });
  res.json({ ok: true, count: info.changes });
}));

/** รายชื่อสมาชิกที่ยังไม่ได้อยู่ในรายการนี้ (สำหรับหน้าจอเลือกเพิ่ม) */
router.get('/:id(\\d+)/available-members', v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const q = v.str(req.query.q, 100);
  const groupId = v.id(req.query.group);
  const params = [id];
  let where = 'm.is_active = 1 AND m.id NOT IN (SELECT member_id FROM assignments WHERE collection_id = ?)';
  if (groupId) { where += ' AND m.group_id = ?'; params.push(groupId); }
  if (q) {
    where += " AND (m.member_code LIKE ? OR (m.first_name || ' ' || m.last_name) LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  const rows = db
    .prepare(
      `SELECT m.id, m.member_code, m.prefix, m.first_name, m.last_name, g.name AS group_name
         FROM members m LEFT JOIN groups g ON g.id = m.group_id
        WHERE ${where} ORDER BY g.sort_order, g.name, m.member_code LIMIT 1000`
    )
    .all(...params);
  res.json({ members: rows.map((m) => ({ ...m, full_name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim() })) });
}));

module.exports = router;
