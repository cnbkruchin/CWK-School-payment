'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');

const { db, getSetting } = require('../db');
const audit = require('../services/audit');
const mailer = require('../services/mailer');
const { secureToken, sha256 } = require('../utils/codes');
const { requireAdmin } = require('../middleware/auth');
const { ensureCsrfToken, csrfProtect } = require('../middleware/security');
const v = require('../utils/validate');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;

/** นโยบายรหัสผ่าน */
function checkPasswordStrength(pw) {
  if (!pw || pw.length < 8) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'รหัสผ่านต้องประกอบด้วยตัวอักษรและตัวเลข';
  return null;
}

module.exports = function adminAuthRoutes({ loginLimiter }) {
  const router = express.Router();

  /* ------------------------------ เข้าสู่ระบบ ------------------------------ */
  router.post('/login', loginLimiter, v.wrap((req, res) => {
    const username = v.str(req.body.username, 80).toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !password) v.fail(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

    const admin = db
      .prepare('SELECT * FROM admins WHERE lower(username) = ? OR lower(email) = ?')
      .get(username, username);

    const genericError = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    if (!admin) {
      audit.log(req, 'เข้าสู่ระบบไม่สำเร็จ', { actorName: username, detail: 'ไม่พบบัญชีผู้ใช้' });
      v.fail(401, genericError);
    }
    if (!admin.is_active) v.fail(403, 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบสูงสุด');

    if (admin.locked_until && new Date(admin.locked_until + 'Z') > new Date()) {
      const mins = Math.ceil((new Date(admin.locked_until + 'Z') - new Date()) / 60000);
      v.fail(429, `บัญชีถูกล็อกชั่วคราวจากการกรอกรหัสผ่านผิดหลายครั้ง กรุณารออีก ${mins} นาที`);
    }

    if (!bcrypt.compareSync(password, admin.password_hash)) {
      const failed = (admin.failed_attempts || 0) + 1;
      const lock = failed >= MAX_FAILED
        ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString().slice(0, 19).replace('T', ' ')
        : null;
      db.prepare('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(failed, lock, admin.id);
      audit.log(req, 'เข้าสู่ระบบไม่สำเร็จ', {
        actorType: 'admin', actorId: admin.id, actorName: admin.username,
        detail: `รหัสผ่านไม่ถูกต้อง (ครั้งที่ ${failed})`,
      });
      if (lock) v.fail(429, `กรอกรหัสผ่านผิดครบ ${MAX_FAILED} ครั้ง บัญชีถูกล็อก ${LOCK_MINUTES} นาที`);
      v.fail(401, `${genericError} (เหลือโอกาสอีก ${MAX_FAILED - failed} ครั้ง)`);
    }

    db.prepare(
      "UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?"
    ).run(admin.id);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'ไม่สามารถสร้างเซสชันได้ กรุณาลองใหม่' });
      req.session.admin = { id: admin.id, username: admin.username, full_name: admin.full_name, role: admin.role };
      const csrf = ensureCsrfToken(req);
      req.session.save(() => {
        audit.log(req, 'เข้าสู่ระบบสำเร็จ', { actorType: 'admin', actorId: admin.id, actorName: admin.username });
        res.json({
          ok: true,
          admin: {
            id: admin.id, username: admin.username, full_name: admin.full_name,
            email: admin.email, role: admin.role, must_change_pw: !!admin.must_change_pw,
          },
          csrfToken: csrf,
        });
      });
    });
  }));

  /* ------------------------------ ออกจากระบบ ------------------------------ */
  router.post('/logout', v.wrap((req, res) => {
    if (req.admin) audit.log(req, 'ออกจากระบบ', { actorType: 'admin', actorId: req.admin.id, actorName: req.admin.username });
    req.session.destroy(() => {
      res.clearCookie('cwk.sid');
      res.json({ ok: true });
    });
  }));

  /* --------------------------- ข้อมูลผู้ใช้ปัจจุบัน --------------------------- */
  router.get('/me', v.wrap((req, res) => {
    if (!req.admin) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ', code: 'UNAUTHENTICATED' });
    const row = db.prepare('SELECT id, username, email, full_name, role, phone, must_change_pw, last_login_at FROM admins WHERE id = ?').get(req.admin.id);
    res.json({ admin: row, csrfToken: ensureCsrfToken(req), school_name: getSetting('school_name') });
  }));

  /* ---------------------------- เปลี่ยนรหัสผ่านตนเอง ---------------------------- */
  router.post('/change-password', requireAdmin, csrfProtect, v.wrap((req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');

    const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.admin.id);
    if (!bcrypt.compareSync(current, row.password_hash)) v.fail(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    if (next !== confirm) v.fail(400, 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
    const weak = checkPasswordStrength(next);
    if (weak) v.fail(400, weak);
    if (bcrypt.compareSync(next, row.password_hash)) v.fail(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');

    db.prepare("UPDATE admins SET password_hash = ?, must_change_pw = 0, updated_at = datetime('now') WHERE id = ?")
      .run(bcrypt.hashSync(next, 12), req.admin.id);
    audit.log(req, 'เปลี่ยนรหัสผ่านของตนเอง', { targetType: 'admin', targetId: req.admin.id });
    res.json({ ok: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
  }));

  /* ------------------- ลืมรหัสผ่าน (ต้องระบุอีเมลของผู้ดูแลที่ลงทะเบียนไว้) ------------------- */
  router.post('/forgot-password', loginLimiter, v.wrap(async (req, res) => {
    const username = v.str(req.body.username, 80).toLowerCase();
    const email = v.str(req.body.email, 160).toLowerCase();
    if (!username || !email) v.fail(400, 'กรุณากรอกชื่อผู้ใช้และอีเมลของผู้ดูแลระบบ');
    if (!v.isEmail(email)) v.fail(400, 'รูปแบบอีเมลไม่ถูกต้อง');

    const admin = db
      .prepare('SELECT * FROM admins WHERE (lower(username) = ? OR lower(email) = ?) AND lower(email) = ? AND is_active = 1')
      .get(username, username, email);

    // ตอบข้อความเดียวกันเสมอ เพื่อไม่ให้เดาได้ว่ามีบัญชีนี้หรือไม่
    const okResponse = {
      ok: true,
      message: 'หากข้อมูลถูกต้อง ระบบได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลที่ลงทะเบียนไว้แล้ว (ลิงก์มีอายุ 30 นาที)',
    };

    if (!admin) {
      audit.log(req, 'ขอรีเซ็ตรหัสผ่านไม่สำเร็จ', { actorName: username, detail: `อีเมลไม่ตรงกับที่ลงทะเบียน: ${email}` });
      return res.json(okResponse);
    }

    const token = secureToken(32);
    const expires = new Date(Date.now() + RESET_TTL_MIN * 60000).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE password_resets SET used_at = datetime(\'now\') WHERE admin_id = ? AND used_at IS NULL').run(admin.id);
    db.prepare(
      'INSERT INTO password_resets (admin_id, email, token_hash, expires_at, request_ip) VALUES (?, ?, ?, ?, ?)'
    ).run(admin.id, admin.email, sha256(token), expires, req.ip || null);

    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/admin/#/reset-password?token=${token}`;
    const school = getSetting('school_name');

    await mailer.send({
      to: admin.email,
      subject: `[${school}] ตั้งรหัสผ่านผู้ดูแลระบบใหม่`,
      text:
        `เรียน ${admin.full_name}\n\n` +
        `มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีผู้ดูแลระบบ "${admin.username}" ของ${school}\n\n` +
        `กรุณาคลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ ${RESET_TTL_MIN} นาที)\n${link}\n\n` +
        `หากท่านไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ รหัสผ่านเดิมจะยังใช้งานได้ตามปกติ\n`,
    });

    audit.log(req, 'ขอรีเซ็ตรหัสผ่าน', { actorType: 'admin', actorId: admin.id, actorName: admin.username, detail: `ส่งไปยัง ${admin.email}` });
    res.json(okResponse);
  }));

  /* --------------------------- ตั้งรหัสผ่านใหม่ด้วยโทเคน --------------------------- */
  router.post('/reset-password', loginLimiter, v.wrap((req, res) => {
    const token = v.str(req.body.token, 200);
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm_password || '');
    if (!token) v.fail(400, 'ลิงก์ไม่ถูกต้อง');
    if (password !== confirm) v.fail(400, 'รหัสผ่านและการยืนยันไม่ตรงกัน');
    const weak = checkPasswordStrength(password);
    if (weak) v.fail(400, weak);

    const row = db
      .prepare(
        `SELECT pr.*, a.username FROM password_resets pr
           JOIN admins a ON a.id = pr.admin_id
          WHERE pr.token_hash = ? AND pr.used_at IS NULL`
      )
      .get(sha256(token));

    if (!row) v.fail(400, 'ลิงก์ไม่ถูกต้องหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่');
    if (new Date(row.expires_at + 'Z') < new Date()) v.fail(400, 'ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่');

    db.transaction(() => {
      db.prepare(
        "UPDATE admins SET password_hash = ?, must_change_pw = 0, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(bcrypt.hashSync(password, 12), row.admin_id);
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
      db.prepare('DELETE FROM sessions').run(); // บังคับออกจากระบบทุกเครื่องเพื่อความปลอดภัย
    })();

    audit.log(req, 'ตั้งรหัสผ่านใหม่สำเร็จ', { actorType: 'admin', actorId: row.admin_id, actorName: row.username });
    res.json({ ok: true, message: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' });
  }));

  /** ตรวจสอบว่าโทเคนยังใช้ได้ (สำหรับหน้าเว็บ) */
  router.get('/reset-password/check', v.wrap((req, res) => {
    const token = v.str(req.query.token, 200);
    const row = db.prepare('SELECT expires_at, used_at FROM password_resets WHERE token_hash = ?').get(sha256(token));
    const valid = !!row && !row.used_at && new Date(row.expires_at + 'Z') > new Date();
    res.json({ valid });
  }));

  return router;
};

module.exports.checkPasswordStrength = checkPasswordStrength;
