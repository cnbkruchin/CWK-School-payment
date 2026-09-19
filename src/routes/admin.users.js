'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');

const { db } = require('../db');
const audit = require('../services/audit');
const { requireAdmin, requireSuper } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/security');
const { checkPasswordStrength } = require('./admin.auth');
const { randomDigits } = require('../utils/codes');
const v = require('../utils/validate');

const router = express.Router();
router.use(requireAdmin, csrfProtect);

const ROLES = ['viewer', 'admin', 'superadmin'];
const ROLE_LABEL = { viewer: 'ผู้ดูรายงาน', admin: 'ผู้ดูแลระบบ', superadmin: 'ผู้ดูแลระบบสูงสุด' };

const shape = (a) => ({
  id: a.id, username: a.username, email: a.email, full_name: a.full_name,
  role: a.role, role_label: ROLE_LABEL[a.role] || a.role, phone: a.phone,
  is_active: a.is_active, must_change_pw: a.must_change_pw,
  last_login_at: a.last_login_at, created_at: a.created_at,
  locked: !!(a.locked_until && new Date(a.locked_until + 'Z') > new Date()),
});

router.get('/', v.wrap((req, res) => {
  res.json({
    users: db.prepare('SELECT * FROM admins ORDER BY CASE role WHEN \'superadmin\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END, username').all().map(shape),
    roles: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    me: req.admin.id,
  });
}));

router.post('/', requireSuper, v.wrap((req, res) => {
  const username = v.str(req.body.username, 80).toLowerCase();
  const email = v.str(req.body.email, 160).toLowerCase();
  const fullName = v.str(req.body.full_name, 160);
  const role = ROLES.includes(v.str(req.body.role, 20)) ? v.str(req.body.role, 20) : 'admin';

  if (!/^[a-z0-9._-]{3,80}$/.test(username)) v.fail(400, 'ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง ความยาว 3-80 ตัว');
  if (!v.isEmail(email)) v.fail(400, 'กรุณากรอกอีเมลให้ถูกต้อง (ใช้สำหรับรีเซ็ตรหัสผ่านกรณีลืม)');
  if (!fullName) v.fail(400, 'กรุณากรอกชื่อ-สกุลของผู้ดูแล');
  if (db.prepare('SELECT 1 FROM admins WHERE lower(username) = ?').get(username)) v.fail(409, `ชื่อผู้ใช้ "${username}" ถูกใช้ไปแล้ว`);
  if (db.prepare('SELECT 1 FROM admins WHERE lower(email) = ?').get(email)) v.fail(409, `อีเมล "${email}" ถูกใช้ไปแล้ว`);

  const password = String(req.body.password || '') || `Cwk${randomDigits(6)}`;
  const weak = checkPasswordStrength(password);
  if (weak) v.fail(400, weak);

  const info = db
    .prepare(
      `INSERT INTO admins (username, email, full_name, password_hash, role, phone, must_change_pw)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(username, email, fullName, bcrypt.hashSync(password, 12), role,
         v.str(req.body.phone, 40) || null, v.bool(req.body.must_change_pw) ? 1 : 0);

  audit.log(req, 'เพิ่มผู้ดูแลระบบ', { targetType: 'admin', targetId: info.lastInsertRowid, detail: `${username} (${ROLE_LABEL[role]})` });
  res.status(201).json({ ok: true, id: info.lastInsertRowid, username, password: req.body.password ? undefined : password });
}));

router.put('/:id(\\d+)', requireSuper, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!a) v.fail(404, 'ไม่พบผู้ดูแลรายนี้');

  const email = req.body.email !== undefined ? v.str(req.body.email, 160).toLowerCase() : a.email;
  if (!v.isEmail(email)) v.fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  if (email !== a.email && db.prepare('SELECT 1 FROM admins WHERE lower(email) = ? AND id <> ?').get(email, id)) {
    v.fail(409, `อีเมล "${email}" ถูกใช้ไปแล้ว`);
  }

  const role = ROLES.includes(v.str(req.body.role, 20)) ? v.str(req.body.role, 20) : a.role;
  const isActive = req.body.is_active !== undefined ? (v.bool(req.body.is_active) ? 1 : 0) : a.is_active;

  // ต้องเหลือผู้ดูแลสูงสุดที่ใช้งานได้อย่างน้อย 1 คนเสมอ
  if (a.role === 'superadmin' && (role !== 'superadmin' || !isActive)) {
    const others = db.prepare("SELECT COUNT(*) n FROM admins WHERE role='superadmin' AND is_active=1 AND id <> ?").get(id).n;
    if (others === 0) v.fail(400, 'ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 บัญชี');
  }

  db.prepare(
    `UPDATE admins SET email=?, full_name=?, role=?, phone=?, is_active=?, updated_at=datetime('now') WHERE id=?`
  ).run(email, v.str(req.body.full_name, 160) || a.full_name, role,
        req.body.phone !== undefined ? v.str(req.body.phone, 40) || null : a.phone, isActive, id);

  audit.log(req, 'แก้ไขผู้ดูแลระบบ', { targetType: 'admin', targetId: id, detail: a.username });
  res.json({ ok: true });
}));

/** ตั้งรหัสผ่านใหม่ให้ผู้ดูแลคนอื่น */
router.post('/:id(\\d+)/reset-password', requireSuper, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!a) v.fail(404, 'ไม่พบผู้ดูแลรายนี้');

  const password = String(req.body.password || '') || `Cwk${randomDigits(6)}`;
  const weak = checkPasswordStrength(password);
  if (weak) v.fail(400, weak);

  db.prepare(
    `UPDATE admins SET password_hash=?, must_change_pw=1, failed_attempts=0, locked_until=NULL, updated_at=datetime('now') WHERE id=?`
  ).run(bcrypt.hashSync(password, 12), id);

  audit.log(req, 'ตั้งรหัสผ่านใหม่ให้ผู้ดูแล', { targetType: 'admin', targetId: id, detail: a.username });
  res.json({ ok: true, username: a.username, password: req.body.password ? undefined : password });
}));

/** ปลดล็อกบัญชีที่ถูกล็อกจากการกรอกรหัสผิด */
router.post('/:id(\\d+)/unlock', requireSuper, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!a) v.fail(404, 'ไม่พบผู้ดูแลรายนี้');
  db.prepare('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id);
  audit.log(req, 'ปลดล็อกบัญชีผู้ดูแล', { targetType: 'admin', targetId: id, detail: a.username });
  res.json({ ok: true });
}));

router.delete('/:id(\\d+)', requireSuper, v.wrap((req, res) => {
  const id = v.id(req.params.id);
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!a) v.fail(404, 'ไม่พบผู้ดูแลรายนี้');
  if (id === req.admin.id) v.fail(400, 'ไม่สามารถลบบัญชีของตนเองได้');
  if (a.role === 'superadmin') {
    const others = db.prepare("SELECT COUNT(*) n FROM admins WHERE role='superadmin' AND is_active=1 AND id <> ?").get(id).n;
    if (others === 0) v.fail(400, 'ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 บัญชี');
  }
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  audit.log(req, 'ลบผู้ดูแลระบบ', { targetType: 'admin', targetId: id, detail: a.username });
  res.json({ ok: true });
}));

module.exports = router;
