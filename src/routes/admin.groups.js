'use strict';
const express = require('express');
const { db } = require('../db');
const audit = require('../services/audit');
const { requireAdmin, requireWrite } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const v = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

/** รายการกลุ่มทั้งหมด พร้อมจำนวนสมาชิก */
router.get('/', v.wrap((req, res) => {
  const rows = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM members m WHERE m.group_id = g.id AND m.is_active = 1) AS member_count
         FROM groups g ORDER BY g.sort_order, g.name`
    )
    .all();
  res.json({ groups: rows });
}));

router.post('/', requireWrite, v.wrap((req, res) => {
  const name = v.str(req.body.name, 120);
  if (!name) v.fail(400, 'กรุณาระบุชื่อกลุ่ม');
  if (db.prepare('SELECT 1 FROM groups WHERE name = ?').get(name)) v.fail(409, `มีกลุ่มชื่อ "${name}" อยู่แล้ว`);

  const info = db
    .prepare('INSERT INTO groups (name, description, sort_order) VALUES (?, ?, ?)')
    .run(name, v.str(req.body.description, 255) || null, v.num(req.body.sort_order, 0));
  audit.log(req, 'เพิ่มกลุ่ม', { targetType: 'group', targetId: info.lastInsertRowid, detail: name });
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
}));

router.put('/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!g) v.fail(404, 'ไม่พบกลุ่มนี้');

  const name = v.str(req.body.name, 120) || g.name;
  const dup = db.prepare('SELECT 1 FROM groups WHERE name = ? AND id <> ?').get(name, id);
  if (dup) v.fail(409, `มีกลุ่มชื่อ "${name}" อยู่แล้ว`);

  db.prepare('UPDATE groups SET name = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?').run(
    name,
    v.str(req.body.description, 255) || null,
    v.num(req.body.sort_order, g.sort_order),
    req.body.is_active === undefined ? g.is_active : v.bool(req.body.is_active) ? 1 : 0,
    id
  );
  audit.log(req, 'แก้ไขกลุ่ม', { targetType: 'group', targetId: id, detail: name });
  res.json({ ok: true });
}));

router.delete('/:id(\\d+)', requireWrite, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!g) v.fail(404, 'ไม่พบกลุ่มนี้');
  const n = db.prepare('SELECT COUNT(*) n FROM members WHERE group_id = ?').get(id).n;
  db.prepare('DELETE FROM groups WHERE id = ?').run(id); // สมาชิกจะถูกตั้งเป็นไม่มีกลุ่ม
  audit.log(req, 'ลบกลุ่ม', { targetType: 'group', targetId: id, detail: `${g.name} (สมาชิก ${n} คนถูกย้ายออกจากกลุ่ม)` });
  res.json({ ok: true, moved_members: n });
}));

module.exports = router;
