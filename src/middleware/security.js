'use strict';
const crypto = require('crypto');

/**
 * ป้องกัน CSRF ด้วยการตรวจ Origin/Referer สำหรับทุกคำขอที่เปลี่ยนแปลงข้อมูล
 * ใช้ร่วมกับคุกกี้ SameSite=Lax
 */
function originGuard(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const origin = req.get('origin');
  const referer = req.get('referer');
  const source = origin || referer;
  if (!source) return next(); // เช่น curl / สคริปต์ภายใน — ป้องกันชั้นถัดไปด้วยโทเคน

  let host;
  try { host = new URL(source).host; } catch { return res.status(403).json({ error: 'แหล่งที่มาของคำขอไม่ถูกต้อง' }); }

  const allowed = new Set([req.get('host')]);
  for (const extra of String(process.env.ALLOWED_ORIGINS || '').split(',')) {
    const v = extra.trim();
    if (!v) continue;
    try { allowed.add(new URL(v).host); } catch { allowed.add(v); }
  }
  if (!allowed.has(host)) {
    return res.status(403).json({ error: 'แหล่งที่มาของคำขอไม่ถูกต้อง (CSRF)' });
  }
  next();
}

/** สร้าง/ตรวจสอบโทเคน CSRF ในเซสชันผู้ดูแล */
function ensureCsrfToken(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function csrfProtect(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const expected = req.session && req.session.csrfToken;
  const got = req.get('x-csrf-token') || (req.body && req.body._csrf);
  const deny = () =>
    res.status(403).json({ error: 'โทเคนความปลอดภัยไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่' });

  if (!expected || !got) return deny();
  const a = Buffer.from(String(got), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // เทียบความยาวก่อน เพราะ timingSafeEqual จะโยนข้อผิดพลาดหากความยาวไม่เท่ากัน
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return deny();
  next();
}

module.exports = { originGuard, csrfProtect, ensureCsrfToken };
