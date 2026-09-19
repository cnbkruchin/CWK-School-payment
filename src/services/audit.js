'use strict';
const { db } = require('../db');

let stmt = null;
function getStmt() {
  if (!stmt) {
    stmt = db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (@actor_type, @actor_id, @actor_name, @action, @target_type, @target_id, @detail, @ip)`
    );
  }
  return stmt;
}

/** บันทึกกิจกรรมในระบบ */
function log(req, action, opts = {}) {
  try {
    const admin = req && req.session && req.session.admin;
    getStmt().run({
      actor_type: opts.actorType || (admin ? 'admin' : 'system'),
      actor_id: opts.actorId ?? (admin ? admin.id : null),
      actor_name: opts.actorName || (admin ? admin.full_name || admin.username : 'ระบบ'),
      action,
      target_type: opts.targetType || null,
      target_id: opts.targetId ?? null,
      detail: opts.detail
        ? typeof opts.detail === 'string'
          ? opts.detail
          : JSON.stringify(opts.detail)
        : null,
      ip:
        (req && String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()) ||
        (req && req.ip) ||
        null,
    });
  } catch (e) {
    console.error('[audit] บันทึกกิจกรรมไม่สำเร็จ:', e.message);
  }
}

module.exports = { log };
