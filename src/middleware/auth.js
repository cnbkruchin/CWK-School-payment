'use strict';
const { db } = require('../db');

const ROLE_RANK = { viewer: 1, admin: 2, superadmin: 3 };

/** โหลดข้อมูลผู้ดูแลจากเซสชันในทุกคำขอ */
function loadAdmin(req, res, next) {
  req.admin = null;
  if (req.session && req.session.admin && req.session.admin.id) {
    const row = db
      .prepare('SELECT id, username, email, full_name, role, is_active, must_change_pw FROM admins WHERE id = ?')
      .get(req.session.admin.id);
    if (row && row.is_active) {
      req.admin = row;
      req.session.admin = { id: row.id, username: row.username, full_name: row.full_name, role: row.role };
    } else {
      req.session.admin = null;
    }
  }
  next();
}

/** ต้องเข้าสู่ระบบก่อน */
function requireAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', code: 'UNAUTHENTICATED' });
  next();
}

/** ต้องมีสิทธิ์ขั้นต่ำตามที่กำหนด */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', code: 'UNAUTHENTICATED' });
    const have = ROLE_RANK[req.admin.role] || 0;
    const need = ROLE_RANK[minRole] || 0;
    if (have < need) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้' });
    next();
  };
}

/** ผู้ใช้ระดับ viewer แก้ไขข้อมูลไม่ได้ */
const requireWrite = requireRole('admin');
const requireSuper = requireRole('superadmin');

module.exports = { loadAdmin, requireAdmin, requireRole, requireWrite, requireSuper, ROLE_RANK };
