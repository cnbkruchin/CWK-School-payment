/**
 * ===========================================================================
 *  API ผู้ดูแล: ตั้งค่าระบบ บัญชีรับโอน และบัญชีผู้ดูแล
 * ===========================================================================
 */

var EDITABLE_SETTINGS = [
  'school_name', 'school_short', 'school_address', 'school_phone', 'system_title',
  'contact_note', 'require_member_pin', 'show_pin_to_admin', 'allow_public_member_list',
  'mask_member_name', 'detect_duplicate_slip', 'max_upload_mb', 'receipt_prefix',
  'auto_approve', 'theme_color'
];

function apiSettings(payload) {
  return apiCall_('settings', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var banks = dbAll('BankAccounts').slice();
    banks.sort(function (a, b) {
      if (!!a.is_default !== !!b.is_default) return a.is_default ? -1 : 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    return {
      settings: settingsAll(),
      banks: banks.map(function (b) {
        return {
          id: b.id, bank_name: b.bank_name, account_name: b.account_name,
          account_number: b.account_number, branch: b.branch, promptpay_id: b.promptpay_id,
          note: b.note, is_default: !!b.is_default, is_active: !!b.is_active, sort_order: b.sort_order
        };
      }),
      storage: storageStats_(),
      web_app_url: webAppUrl_(),
      spreadsheet_url: ss_().getUrl(),
      app_version: APP.VERSION
    };
  });
}

function storageStats_() {
  return {
    counts: {
      members: dbAll('Members').length,
      groups: dbAll('Groups').length,
      collections: dbAll('Collections').length,
      assignments: dbAll('Assignments').length,
      payments: dbAll('Payments').length,
      audit_logs: dbAll('AuditLogs').length
    }
  };
}

function apiSaveSettings(payload) {
  return apiCall_('saveSettings', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var patch = {};
    var touched = [];

    for (var i = 0; i < EDITABLE_SETTINGS.length; i++) {
      var key = EDITABLE_SETTINGS[i];
      if (payload[key] === undefined) continue;
      var val = payload[key];
      patch[key] = typeof val === 'boolean' ? (val ? '1' : '0') : String(val).substring(0, 2000);
      touched.push(key);
    }
    if (!touched.length) fail_('ไม่มีข้อมูลที่ต้องบันทึก');

    if (patch.max_upload_mb !== undefined) {
      var mb = Number(patch.max_upload_mb);
      var maxAllowed = APP.MAX_SLIP_BYTES / 1024 / 1024;
      if (!isFinite(mb) || mb < 1 || mb > maxAllowed) {
        fail_('ขนาดไฟล์สูงสุดต้องอยู่ระหว่าง 1-' + maxAllowed + ' MB');
      }
    }

    return withLock_(function () {
      settingsSet(patch);
      audit_(admin, 'แก้ไขการตั้งค่าระบบ', { detail: touched.join(', ') });
      return { settings: settingsAll() };
    });
  });
}

function apiSaveLogo(payload) {
  return apiCall_('saveLogo', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);

    return withLock_(function () {
      if (payload.remove) {
        settingsSet({ school_logo: '' });
        audit_(admin, 'ลบโลโก้โรงเรียน');
        return { logo: '' };
      }
      var dataUrl = saveLogo_(payload.base64, payload.name);
      settingsSet({ school_logo: dataUrl });
      audit_(admin, 'เปลี่ยนโลโก้โรงเรียน');
      return { logo: dataUrl };
    });
  });
}

/** ตั้งเลขรันใบเสร็จ (เฉพาะผู้ดูแลสูงสุด) */
function apiSetReceiptRunning(payload) {
  return apiCall_('setReceiptRunning', function () {
    payload = payload || {};
    var admin = requireSuper_(payload.token);
    var n = num_(payload.value, -1);
    if (n < 0 || Math.floor(n) !== n) fail_('เลขรันใบเสร็จต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
    return withLock_(function () {
      settingsSet({ receipt_running: String(n) });
      audit_(admin, 'ตั้งค่าเลขรันใบเสร็จ', { detail: 'เป็น ' + n });
      return { ok: true };
    });
  });
}

/* ================================ บัญชีรับโอน ================================ */

function apiSaveBank(payload) {
  return apiCall_('saveBank', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);

    var bankName = str_(payload.bank_name, 120);
    var accountName = str_(payload.account_name, 160);
    var accountNumber = str_(payload.account_number, 40);
    if (!bankName) fail_('กรุณาระบุชื่อธนาคาร');
    if (!accountName) fail_('กรุณาระบุชื่อบัญชี');
    if (!accountNumber) fail_('กรุณาระบุเลขที่บัญชี');

    var promptpay = str_(payload.promptpay_id, 40).replace(/\D/g, '');
    if (promptpay && !normalizePromptPay_(promptpay)) {
      fail_('เลขพร้อมเพย์ไม่ถูกต้อง (ต้องเป็นเบอร์โทร 10 หลัก, เลขประจำตัวประชาชน/นิติบุคคล 13 หลัก หรือ e-Wallet 15 หลัก)');
    }

    return withLock_(function () {
      var bid = id_(payload.id);
      var isDefault = bid && payload.is_default === undefined
        ? undefined
        : bool_(payload.is_default);

      // ให้มีบัญชีหลักได้เพียงบัญชีเดียว
      if (isDefault) {
        var others = dbWhere('BankAccounts', function (b) { return b.is_default && b.id !== bid; });
        if (others.length) {
          dbUpdateMany('BankAccounts', others.map(function (b) { return { id: b.id, patch: { is_default: false } }; }));
        }
      }

      if (bid) {
        var existing = dbGet('BankAccounts', bid);
        if (!existing) fail_('ไม่พบบัญชีนี้');
        dbUpdate('BankAccounts', bid, {
          bank_name: bankName, account_name: accountName, account_number: accountNumber,
          branch: str_(payload.branch, 120), promptpay_id: promptpay,
          note: str_(payload.note, 255),
          is_default: isDefault === undefined ? existing.is_default : isDefault,
          is_active: payload.is_active === undefined ? existing.is_active : bool_(payload.is_active),
          sort_order: num_(payload.sort_order, existing.sort_order)
        });
        audit_(admin, 'แก้ไขบัญชีรับโอน', { targetType: 'bank', targetId: bid, detail: bankName + ' ' + accountNumber });
        return { id: bid };
      }

      var created = dbInsert('BankAccounts', {
        bank_name: bankName, account_name: accountName, account_number: accountNumber,
        branch: str_(payload.branch, 120), promptpay_id: promptpay,
        note: str_(payload.note, 255),
        is_default: isDefault === undefined ? true : isDefault,
        is_active: true, sort_order: num_(payload.sort_order, 0)
      });
      audit_(admin, 'เพิ่มบัญชีรับโอน', { targetType: 'bank', targetId: created.id, detail: bankName + ' ' + accountNumber });
      return { id: created.id };
    });
  });
}

function apiDeleteBank(payload) {
  return apiCall_('deleteBank', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var bid = id_(payload.id);
    return withLock_(function () {
      var b = dbGet('BankAccounts', bid);
      if (!b) fail_('ไม่พบบัญชีนี้');
      dbDelete('BankAccounts', bid);
      audit_(admin, 'ลบบัญชีรับโอน', { targetType: 'bank', targetId: bid, detail: b.bank_name + ' ' + b.account_number });
      return { ok: true };
    });
  });
}

function apiBankQr(payload) {
  return apiCall_('bankQr', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var b = dbGet('BankAccounts', id_(payload.id));
    if (!b || !b.promptpay_id) fail_('บัญชีนี้ยังไม่ได้ตั้งค่าพร้อมเพย์');
    var qr = promptPayQr_(b.promptpay_id, money_(payload.amount, 0));
    if (!qr) fail_('เลขพร้อมเพย์ไม่ถูกต้อง');
    return { payload: qr.payload, amount: money_(payload.amount, 0) };
  });
}

/* ============================== ผู้ดูแลระบบ ============================== */

var VALID_ROLES = ['viewer', 'admin', 'superadmin'];

function apiUsers(payload) {
  return apiCall_('users', function () {
    payload = payload || {};
    var me2 = requireSuper_(payload.token);
    var rows = dbAll('Admins').slice();
    rows.sort(function (a, b) {
      var ra = ROLE_RANK[b.role] || 0;
      var rb = ROLE_RANK[a.role] || 0;
      if (ra !== rb) return ra - rb;
      return String(a.username) < String(b.username) ? -1 : 1;
    });

    return {
      users: rows.map(function (a) {
        return {
          id: a.id, username: a.username, email: a.email, full_name: a.full_name,
          role: a.role, role_label: ROLE_LABEL[a.role] || a.role, phone: a.phone,
          is_active: !!a.is_active, must_change_pw: !!a.must_change_pw,
          last_login_at: iso_(a.last_login_at), created_at: iso_(a.created_at),
          locked: !!(a.locked_until && new Date(a.locked_until).getTime() > Date.now())
        };
      }),
      roles: VALID_ROLES.map(function (r) { return { value: r, label: ROLE_LABEL[r] }; }),
      me: me2.id
    };
  });
}

function apiSaveUser(payload) {
  return apiCall_('saveUser', function () {
    payload = payload || {};
    var admin = requireSuper_(payload.token);

    var email = str_(payload.email, 160).toLowerCase();
    var fullName = str_(payload.full_name, 160);
    var role = VALID_ROLES.indexOf(str_(payload.role, 20)) >= 0 ? str_(payload.role, 20) : 'admin';
    if (!isEmail_(email)) fail_('กรุณากรอกอีเมลให้ถูกต้อง (ใช้สำหรับรีเซ็ตรหัสผ่านกรณีลืม)');
    if (!fullName) fail_('กรุณากรอกชื่อ-สกุลของผู้ดูแล');

    return withLock_(function () {
      var uid = id_(payload.id);

      if (uid) {
        var existing = dbGet('Admins', uid);
        if (!existing) fail_('ไม่พบผู้ดูแลรายนี้');

        var dupEmail = dbFind('Admins', function (a) {
          return String(a.email).toLowerCase() === email && a.id !== uid;
        });
        if (dupEmail) fail_('อีเมล "' + email + '" ถูกใช้ไปแล้ว');

        var isActive = payload.is_active === undefined ? existing.is_active : bool_(payload.is_active);
        // ต้องเหลือผู้ดูแลสูงสุดที่ใช้งานได้อย่างน้อย 1 คน
        if (existing.role === 'superadmin' && (role !== 'superadmin' || !isActive)) {
          var others = dbWhere('Admins', function (a) {
            return a.role === 'superadmin' && a.is_active && a.id !== uid;
          });
          if (!others.length) fail_('ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 บัญชี');
        }

        dbUpdate('Admins', uid, {
          email: email, full_name: fullName, role: role,
          phone: str_(payload.phone, 40), is_active: isActive
        });
        audit_(admin, 'แก้ไขผู้ดูแลระบบ', { targetType: 'admin', targetId: uid, detail: existing.username });
        return { id: uid };
      }

      var username = str_(payload.username, 80).toLowerCase();
      if (!/^[a-z0-9._-]{3,80}$/.test(username)) {
        fail_('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง ความยาว 3-80 ตัว');
      }
      if (dbFind('Admins', function (a) { return String(a.username).toLowerCase() === username; })) {
        fail_('ชื่อผู้ใช้ "' + username + '" ถูกใช้ไปแล้ว');
      }
      if (dbFind('Admins', function (a) { return String(a.email).toLowerCase() === email; })) {
        fail_('อีเมล "' + email + '" ถูกใช้ไปแล้ว');
      }

      var generated = !payload.password;
      var password = String(payload.password || '') || ('Cwk' + randomDigits_(6));
      var weak = checkPasswordStrength_(password);
      if (weak) fail_(weak);

      var pw = makePasswordHash_(password);
      var created = dbInsert('Admins', {
        username: username, email: email, full_name: fullName,
        password_hash: pw.hash, password_salt: pw.salt, role: role,
        phone: str_(payload.phone, 40), is_active: true,
        must_change_pw: payload.must_change_pw === undefined ? true : bool_(payload.must_change_pw),
        failed_attempts: 0
      });

      audit_(admin, 'เพิ่มผู้ดูแลระบบ', {
        targetType: 'admin', targetId: created.id, detail: username + ' (' + ROLE_LABEL[role] + ')'
      });
      return { id: created.id, username: username, password: generated ? password : null };
    });
  });
}

function apiResetUserPassword(payload) {
  return apiCall_('resetUserPassword', function () {
    payload = payload || {};
    var admin = requireSuper_(payload.token);
    var uid = id_(payload.id);

    var generated = !payload.password;
    var password = String(payload.password || '') || ('Cwk' + randomDigits_(6));
    var weak = checkPasswordStrength_(password);
    if (weak) fail_(weak);

    return withLock_(function () {
      var a = dbGet('Admins', uid);
      if (!a) fail_('ไม่พบผู้ดูแลรายนี้');
      var pw = makePasswordHash_(password);
      dbUpdate('Admins', uid, {
        password_hash: pw.hash, password_salt: pw.salt,
        must_change_pw: true, failed_attempts: 0, locked_until: ''
      });
      audit_(admin, 'ตั้งรหัสผ่านใหม่ให้ผู้ดูแล', { targetType: 'admin', targetId: uid, detail: a.username });
      return { username: a.username, password: generated ? password : null };
    });
  });
}

function apiUnlockUser(payload) {
  return apiCall_('unlockUser', function () {
    payload = payload || {};
    var admin = requireSuper_(payload.token);
    var uid = id_(payload.id);
    return withLock_(function () {
      var a = dbGet('Admins', uid);
      if (!a) fail_('ไม่พบผู้ดูแลรายนี้');
      dbUpdate('Admins', uid, { failed_attempts: 0, locked_until: '' });
      audit_(admin, 'ปลดล็อกบัญชีผู้ดูแล', { targetType: 'admin', targetId: uid, detail: a.username });
      return { ok: true };
    });
  });
}

function apiDeleteUser(payload) {
  return apiCall_('deleteUser', function () {
    payload = payload || {};
    var admin = requireSuper_(payload.token);
    var uid = id_(payload.id);
    if (uid === admin.id) fail_('ไม่สามารถลบบัญชีของตนเองได้');

    return withLock_(function () {
      var a = dbGet('Admins', uid);
      if (!a) fail_('ไม่พบผู้ดูแลรายนี้');
      if (a.role === 'superadmin') {
        var others = dbWhere('Admins', function (x) {
          return x.role === 'superadmin' && x.is_active && x.id !== uid;
        });
        if (!others.length) fail_('ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 บัญชี');
      }
      // ลบเซสชันของผู้ใช้รายนี้
      var sessions = dbWhere('Sessions', function (s) { return Number(s.admin_id) === uid; });
      if (sessions.length) dbDeleteMany('Sessions', sessions.map(function (s) { return s.id; }));

      dbDelete('Admins', uid);
      audit_(admin, 'ลบผู้ดูแลระบบ', { targetType: 'admin', targetId: uid, detail: a.username });
      return { ok: true };
    });
  });
}

/* ------------------------------ ล้างข้อมูลเก่า ------------------------------ */

function apiPruneLogs(payload) {
  return apiCall_('pruneLogs', function () {
    payload = payload || {};
    var admin = requireSuper_(payload.token);
    var days = Math.max(30, num_(payload.days, 365));
    var cutoff = new Date(Date.now() - days * 86400000).toISOString();

    return withLock_(function () {
      var old = dbWhere('AuditLogs', function (l) {
        return l.created_at && l.created_at < cutoff;
      });
      var n = old.length ? dbDeleteMany('AuditLogs', old.map(function (l) { return l.id; })) : 0;
      audit_(admin, 'ลบบันทึกกิจกรรมเก่า', { detail: 'เก่ากว่า ' + days + ' วัน จำนวน ' + n + ' รายการ' });
      return { deleted: n };
    });
  });
}
