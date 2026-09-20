/**
 * ===========================================================================
 *  การเข้าสู่ระบบและเซสชันของผู้ดูแล
 *
 *  เว็บแอปของ Apps Script ไม่มีคุกกี้ จึงใช้ "โทเคน" แทน:
 *   • เข้าสู่ระบบสำเร็จ → ได้โทเคนสุ่ม เก็บไว้ที่เบราว์เซอร์ (sessionStorage)
 *   • ทุกคำขอของผู้ดูแลต้องแนบโทเคนมาด้วย
 *   • ฝั่งเซิร์ฟเวอร์ตรวจโทเคนจากแคชก่อน (เร็วมาก) ถ้าไม่เจอจึงดูในชีต
 *   • เก็บเฉพาะค่าที่เข้ารหัสแล้วของโทเคนลงชีต — โทเคนจริงไม่ถูกบันทึกที่ใด
 * ===========================================================================
 */

function sessionCacheKey_(tokenHash) {
  return 'sess:' + tokenHash;
}

/** สร้างเซสชันใหม่ */
function createSession_(adminId) {
  var token = randomToken_(24);
  var tokenHash = sha256Hex_(token);
  var expires = new Date(Date.now() + APP.SESSION_TTL_MS);

  dbInsert('Sessions', { token_hash: tokenHash, admin_id: adminId, expires_at: expires });
  cachePut_(sessionCacheKey_(tokenHash), JSON.stringify({ a: adminId, e: expires.getTime() }));

  // ล้างเซสชันหมดอายุเป็นครั้งคราว (ไม่ทำทุกครั้งเพื่อไม่ให้ช้า)
  if (Math.random() < 0.15) pruneSessions_();
  return { token: token, expires_at: expires.toISOString() };
}

function pruneSessions_() {
  try {
    var now = Date.now();
    var expired = [];
    var rows = dbAll('Sessions');
    for (var i = 0; i < rows.length; i++) {
      var exp = rows[i].expires_at ? new Date(rows[i].expires_at).getTime() : 0;
      if (!exp || exp < now) expired.push(rows[i].id);
    }
    if (expired.length) dbDeleteMany('Sessions', expired);
  } catch (e) {
    Logger.log('ล้างเซสชันหมดอายุไม่สำเร็จ: ' + e.message);
  }
}

/** ตรวจสอบโทเคน คืนค่าเป็นข้อมูลผู้ดูแล หรือ null */
function resolveSession_(token) {
  if (!token) return null;
  var tokenHash = sha256Hex_(String(token));

  var cached = cacheGet_(sessionCacheKey_(tokenHash));
  if (cached) {
    try {
      var obj = JSON.parse(cached);
      if (obj.e > Date.now()) {
        var a = dbGet('Admins', obj.a);
        if (a && a.is_active) return a;
      }
    } catch (e) { /* แคชเสีย ตกไปอ่านจากชีต */ }
    return null;
  }

  // แคชหมดอายุ (เกิน 6 ชม. หรือถูกล้าง) — ตรวจจากชีตแล้วเติมแคชกลับ
  var row = dbFind('Sessions', function (s) { return s.token_hash === tokenHash; });
  if (!row) return null;
  var exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!exp || exp < Date.now()) return null;

  var admin = dbGet('Admins', row.admin_id);
  if (!admin || !admin.is_active) return null;

  cachePut_(sessionCacheKey_(tokenHash), JSON.stringify({ a: admin.id, e: exp }));
  return admin;
}

function destroySession_(token) {
  if (!token) return;
  var tokenHash = sha256Hex_(String(token));
  try { CacheService.getScriptCache().remove(sessionCacheKey_(tokenHash)); } catch (e) { /* ไม่สำคัญ */ }
  var row = dbFind('Sessions', function (s) { return s.token_hash === tokenHash; });
  if (row) dbDelete('Sessions', row.id);
}

/** ยกเลิกเซสชันทั้งหมด (ใช้เมื่อเปลี่ยนรหัสผ่าน) */
function destroyAllSessions_() {
  var rows = dbAll('Sessions');
  var ids = [];
  for (var i = 0; i < rows.length; i++) {
    ids.push(rows[i].id);
    try { CacheService.getScriptCache().remove(sessionCacheKey_(rows[i].token_hash)); } catch (e) { /* ไม่สำคัญ */ }
  }
  if (ids.length) dbDeleteMany('Sessions', ids);
}

/* ------------------------------ ตรวจสอบสิทธิ์ ------------------------------ */

/** ต้องเข้าสู่ระบบแล้ว — คืนข้อมูลผู้ดูแล หรือโยนข้อผิดพลาด */
function requireAdmin_(token) {
  var admin = resolveSession_(token);
  if (!admin) fail_('กรุณาเข้าสู่ระบบก่อนใช้งาน', 'UNAUTHENTICATED');
  return admin;
}

/** ต้องมีสิทธิ์แก้ไขข้อมูล (ไม่ใช่ผู้ดูรายงาน) */
function requireWrite_(token) {
  var admin = requireAdmin_(token);
  if ((ROLE_RANK[admin.role] || 0) < ROLE_RANK.admin) {
    fail_('บัญชีของท่านเป็น "ผู้ดูรายงาน" จึงไม่สามารถแก้ไขข้อมูลได้', 'FORBIDDEN');
  }
  return admin;
}

/** ต้องเป็นผู้ดูแลระบบสูงสุด */
function requireSuper_(token) {
  var admin = requireAdmin_(token);
  if (admin.role !== 'superadmin') {
    fail_('เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่ใช้งานส่วนนี้ได้', 'FORBIDDEN');
  }
  return admin;
}

function publicAdmin_(a) {
  if (!a) return null;
  return {
    id: a.id,
    username: a.username,
    email: a.email,
    full_name: a.full_name,
    role: a.role,
    role_label: ROLE_LABEL[a.role] || a.role,
    phone: a.phone,
    must_change_pw: !!a.must_change_pw,
    last_login_at: iso_(a.last_login_at)
  };
}

/* -------------------------------- เข้าสู่ระบบ -------------------------------- */

function checkPasswordStrength_(pw) {
  if (!pw || pw.length < 8) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'รหัสผ่านต้องประกอบด้วยตัวอักษรและตัวเลข';
  return null;
}

/** จำกัดจำนวนครั้งการเรียกต่อช่วงเวลา (กันการเดาสุ่ม) */
function rateLimit_(bucket, limit, windowSec) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'rl:' + bucket;
    var raw = cache.get(key);
    var count = raw ? parseInt(raw, 10) : 0;
    if (count >= limit) return false;
    cache.put(key, String(count + 1), windowSec);
    return true;
  } catch (e) {
    return true;   // ถ้าแคชใช้ไม่ได้ ไม่ควรปิดกั้นผู้ใช้
  }
}

function login(payload) {
  return apiCall_('login', function () {
    payload = payload || {};
    var username = str_(payload.username, 80).toLowerCase();
    var password = String(payload.password || '');
    if (!username || !password) fail_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

    if (!rateLimit_('login:' + username, 20, 900)) {
      fail_('พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
    }

    return withLock_(function () {
      var admin = dbFind('Admins', function (a) {
        return String(a.username || '').toLowerCase() === username ||
               String(a.email || '').toLowerCase() === username;
      });

      if (!admin) {
        audit_(null, 'เข้าสู่ระบบไม่สำเร็จ', { actorName: username, detail: 'ไม่พบบัญชีผู้ใช้' });
        fail_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
      if (!admin.is_active) fail_('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบสูงสุด');

      if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
        var mins = Math.ceil((new Date(admin.locked_until).getTime() - Date.now()) / 60000);
        fail_('บัญชีถูกล็อกชั่วคราวจากการกรอกรหัสผ่านผิดหลายครั้ง กรุณารออีก ' + mins + ' นาที');
      }

      if (!verifyPassword_(password, admin.password_salt, admin.password_hash)) {
        var failed = (Number(admin.failed_attempts) || 0) + 1;
        var lock = failed >= APP.MAX_FAILED_LOGIN ? new Date(Date.now() + APP.LOCK_MINUTES * 60000) : '';
        dbUpdate('Admins', admin.id, { failed_attempts: failed, locked_until: lock });
        audit_(null, 'เข้าสู่ระบบไม่สำเร็จ', {
          actorType: 'admin', actorId: admin.id, actorName: admin.username,
          detail: 'รหัสผ่านไม่ถูกต้อง (ครั้งที่ ' + failed + ')'
        });
        if (lock) fail_('กรอกรหัสผ่านผิดครบ ' + APP.MAX_FAILED_LOGIN + ' ครั้ง บัญชีถูกล็อก ' + APP.LOCK_MINUTES + ' นาที');
        fail_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลือโอกาสอีก ' + (APP.MAX_FAILED_LOGIN - failed) + ' ครั้ง)');
      }

      dbUpdate('Admins', admin.id, { failed_attempts: 0, locked_until: '', last_login_at: new Date() });
      var session = createSession_(admin.id);
      audit_(admin, 'เข้าสู่ระบบสำเร็จ');

      return {
        token: session.token,
        expires_at: session.expires_at,
        admin: publicAdmin_(dbGet('Admins', admin.id))
      };
    });
  });
}

function logout(payload) {
  return apiCall_('logout', function () {
    payload = payload || {};
    var admin = resolveSession_(payload.token);
    if (admin) audit_(admin, 'ออกจากระบบ');
    destroySession_(payload.token);
    return { ok: true };
  });
}

/** ตรวจสอบว่าโทเคนยังใช้ได้ และคืนข้อมูลผู้ใช้ปัจจุบัน */
function me(payload) {
  return apiCall_('me', function () {
    payload = payload || {};
    var admin = resolveSession_(payload.token);
    if (!admin) fail_('ยังไม่ได้เข้าสู่ระบบ', 'UNAUTHENTICATED');
    return { admin: publicAdmin_(admin), school_name: setting('school_name') };
  });
}

function changePassword(payload) {
  return apiCall_('changePassword', function () {
    payload = payload || {};
    var admin = requireAdmin_(payload.token);
    var current = String(payload.current_password || '');
    var next = String(payload.new_password || '');
    var confirm = String(payload.confirm_password || '');

    if (!verifyPassword_(current, admin.password_salt, admin.password_hash)) {
      fail_('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
    if (next !== confirm) fail_('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
    var weak = checkPasswordStrength_(next);
    if (weak) fail_(weak);
    if (verifyPassword_(next, admin.password_salt, admin.password_hash)) {
      fail_('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }

    return withLock_(function () {
      var pw = makePasswordHash_(next);
      dbUpdate('Admins', admin.id, { password_hash: pw.hash, password_salt: pw.salt, must_change_pw: false });
      audit_(admin, 'เปลี่ยนรหัสผ่านของตนเอง', { targetType: 'admin', targetId: admin.id });
      return { ok: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' };
    });
  });
}

/* ------------------- ลืมรหัสผ่าน (ต้องระบุอีเมลที่ลงทะเบียนไว้) ------------------- */

function forgotPassword(payload) {
  return apiCall_('forgotPassword', function () {
    payload = payload || {};
    var username = str_(payload.username, 80).toLowerCase();
    var email = str_(payload.email, 160).toLowerCase();
    if (!username || !email) fail_('กรุณากรอกชื่อผู้ใช้และอีเมลของผู้ดูแลระบบ');
    if (!isEmail_(email)) fail_('รูปแบบอีเมลไม่ถูกต้อง');
    if (!rateLimit_('forgot:' + username, 10, 900)) {
      fail_('ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    }

    // ตอบข้อความเดียวกันเสมอ เพื่อไม่ให้เดาได้ว่ามีบัญชีนี้อยู่หรือไม่
    var okResponse = {
      ok: true,
      message: 'หากข้อมูลถูกต้อง ระบบได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลที่ลงทะเบียนไว้แล้ว (ลิงก์มีอายุ ' + APP.RESET_TTL_MIN + ' นาที)'
    };

    var admin = dbFind('Admins', function (a) {
      return String(a.email || '').toLowerCase() === email && a.is_active &&
        (String(a.username || '').toLowerCase() === username || String(a.email || '').toLowerCase() === username);
    });

    if (!admin) {
      audit_(null, 'ขอรีเซ็ตรหัสผ่านไม่สำเร็จ', { actorName: username, detail: 'อีเมลไม่ตรงกับที่ลงทะเบียน: ' + email });
      return okResponse;
    }

    return withLock_(function () {
      // ยกเลิกลิงก์เก่าที่ยังไม่ถูกใช้
      var old = dbWhere('PasswordResets', function (r) { return r.admin_id === admin.id && !r.used_at; });
      if (old.length) {
        dbUpdateMany('PasswordResets', old.map(function (r) { return { id: r.id, patch: { used_at: new Date() } }; }));
      }

      var token = randomToken_(24);
      dbInsert('PasswordResets', {
        admin_id: admin.id,
        email: admin.email,
        token_hash: sha256Hex_(token),
        expires_at: new Date(Date.now() + APP.RESET_TTL_MIN * 60000),
        used_at: ''
      });

      var link = webAppUrl_() + '?page=reset&token=' + encodeURIComponent(token);
      var school = setting('school_name');
      try {
        MailApp.sendEmail({
          to: admin.email,
          subject: '[' + school + '] ตั้งรหัสผ่านผู้ดูแลระบบใหม่',
          body: 'เรียน ' + admin.full_name + '\n\n' +
            'มีการขอตั้งรหัสผ่านใหม่สำหรับบัญชีผู้ดูแลระบบ "' + admin.username + '" ของ' + school + '\n\n' +
            'กรุณาคลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ ' + APP.RESET_TTL_MIN + ' นาที และใช้ได้ครั้งเดียว)\n' +
            link + '\n\n' +
            'หากท่านไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ รหัสผ่านเดิมจะยังใช้งานได้ตามปกติ\n'
        });
      } catch (e) {
        Logger.log('ส่งอีเมลไม่สำเร็จ: ' + e.message + ' | ลิงก์: ' + link);
      }

      audit_(admin, 'ขอรีเซ็ตรหัสผ่าน', { detail: 'ส่งไปยัง ' + admin.email });
      return okResponse;
    });
  });
}

function checkResetToken(payload) {
  return apiCall_('checkResetToken', function () {
    payload = payload || {};
    var token = str_(payload.token, 200);
    if (!token) return { valid: false };
    var row = dbFind('PasswordResets', function (r) { return r.token_hash === sha256Hex_(token); });
    var valid = !!row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();
    return { valid: valid };
  });
}

function resetPassword(payload) {
  return apiCall_('resetPassword', function () {
    payload = payload || {};
    var token = str_(payload.token, 200);
    var password = String(payload.password || '');
    var confirm = String(payload.confirm_password || '');
    if (!token) fail_('ลิงก์ไม่ถูกต้อง');
    if (password !== confirm) fail_('รหัสผ่านและการยืนยันไม่ตรงกัน');
    var weak = checkPasswordStrength_(password);
    if (weak) fail_(weak);

    return withLock_(function () {
      var row = dbFind('PasswordResets', function (r) { return r.token_hash === sha256Hex_(token); });
      if (!row || row.used_at) fail_('ลิงก์ไม่ถูกต้องหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่');
      if (new Date(row.expires_at).getTime() < Date.now()) fail_('ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่');

      var admin = dbGet('Admins', row.admin_id);
      if (!admin) fail_('ไม่พบบัญชีผู้ดูแลนี้');

      var pw = makePasswordHash_(password);
      dbUpdate('Admins', admin.id, {
        password_hash: pw.hash, password_salt: pw.salt,
        must_change_pw: false, failed_attempts: 0, locked_until: ''
      });
      dbUpdate('PasswordResets', row.id, { used_at: new Date() });
      destroyAllSessions_();   // บังคับออกจากระบบทุกเครื่องเพื่อความปลอดภัย

      audit_(admin, 'ตั้งรหัสผ่านใหม่สำเร็จ', { targetType: 'admin', targetId: admin.id });
      return { ok: true, message: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' };
    });
  });
}

function webAppUrl_() {
  return memoGet_('__webAppUrl', function () {
    try {
      var u = ScriptApp.getService().getUrl();
      if (u) return u;
    } catch (e) { /* ยังไม่ได้ deploy */ }
    return setting('web_app_url', '') || '';
  });
}
