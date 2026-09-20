/**
 * ===========================================================================
 *  เมนูในไฟล์ Google Sheets — ให้ผู้ดูแลใช้งานคำสั่งสำคัญได้จากในชีตโดยตรง
 * ===========================================================================
 */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('⚙️ ระบบแจ้งชำระเงิน')
      .addItem('🚀 ติดตั้ง / ตรวจสอบระบบ', 'setup')
      .addSeparator()
      .addItem('🔗 ดูลิงก์เว็บแอป', 'showWebAppLink')
      .addItem('🔑 ตั้งรหัสผ่านผู้ดูแลใหม่', 'resetAdminPasswordDialog')
      .addSeparator()
      .addItem('📞 จัดรูปแบบเบอร์โทร / เติมเลข 0 นำหน้า', 'repairPhoneNumbers')
      .addSeparator()
      .addItem('🧪 สร้างข้อมูลตัวอย่าง', 'seedDemoData')
      .addItem('🧹 ล้างแคชระบบ', 'clearSystemCache')
      .addItem('📊 สรุปสถานะระบบ', 'showSystemStatus')
      .addToUi();
  } catch (e) {
    Logger.log('สร้างเมนูไม่สำเร็จ: ' + e.message);
  }
}

function showWebAppLink() {
  var ui = SpreadsheetApp.getUi();
  var url = webAppUrl_();
  if (!url) {
    ui.alert('ยังไม่ได้เผยแพร่เว็บแอป',
      'กรุณาไปที่เมนู Deploy > New deployment > Web app\n' +
      '  Execute as     : Me\n' +
      '  Who has access : Anyone\n\n' +
      'แล้วกลับมาเลือกเมนูนี้อีกครั้ง', ui.ButtonSet.OK);
    return;
  }
  ui.alert('ลิงก์สำหรับใช้งาน',
    'หน้าสำหรับนักเรียน/ผู้ปกครอง:\n' + url + '\n\n' +
    'หน้าผู้ดูแลระบบ:\n' + url + '?page=admin\n\n' +
    'แนะนำให้คัดลอกลิงก์แรกไปแจ้งผู้ปกครอง และเก็บลิงก์ที่สองไว้ใช้เอง',
    ui.ButtonSet.OK);
}

function resetAdminPasswordDialog() {
  var ui = SpreadsheetApp.getUi();
  var admins = dbAll('Admins');
  if (!admins.length) {
    ui.alert('ยังไม่มีบัญชีผู้ดูแลระบบ กรุณาเลือกเมนู "ติดตั้ง / ตรวจสอบระบบ" ก่อน');
    return;
  }

  var list = admins.map(function (a, i) {
    return (i + 1) + '. ' + a.username + '  (' + a.full_name + ')';
  }).join('\n');

  var res = ui.prompt('ตั้งรหัสผ่านผู้ดูแลใหม่',
    'บัญชีผู้ดูแลในระบบ:\n' + list + '\n\nพิมพ์ชื่อผู้ใช้ที่ต้องการตั้งรหัสผ่านใหม่:',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var username = String(res.getResponseText() || '').trim().toLowerCase();
  var target = null;
  for (var i = 0; i < admins.length; i++) {
    if (String(admins[i].username).toLowerCase() === username) { target = admins[i]; break; }
  }
  if (!target) { ui.alert('ไม่พบชื่อผู้ใช้ "' + username + '"'); return; }

  var newPassword = 'Cwk' + randomDigits_(8);
  var pw = makePasswordHash_(newPassword);
  dbUpdate('Admins', target.id, {
    password_hash: pw.hash, password_salt: pw.salt,
    must_change_pw: true, failed_attempts: 0, locked_until: '', is_active: true
  });
  destroyAllSessions_();
  audit_(null, 'ตั้งรหัสผ่านผู้ดูแลใหม่จากเมนูในชีต', {
    actorType: 'system', actorName: 'ผู้ดูแลไฟล์ Sheets', targetType: 'admin', targetId: target.id, detail: target.username
  });

  ui.alert('ตั้งรหัสผ่านใหม่เรียบร้อย',
    'ชื่อผู้ใช้ : ' + target.username + '\n' +
    'รหัสผ่านใหม่ : ' + newPassword + '\n\n' +
    '⚠ กรุณาบันทึกไว้และเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ\n' +
    '(ผู้ใช้ทุกคนถูกออกจากระบบแล้วเพื่อความปลอดภัย)', ui.ButtonSet.OK);
}

function clearSystemCache() {
  try {
    CacheService.getScriptCache().removeAll([]);
  } catch (e) { /* ไม่สำคัญ */ }
  // เพิ่มเลขเวอร์ชันของทุกตาราง = แคชเดิมถูกทิ้งทั้งหมด
  bumpVersion_(Object.keys(SCHEMA));
  memoClear_();
  try {
    SpreadsheetApp.getUi().alert('ล้างแคชเรียบร้อยแล้ว ระบบจะอ่านข้อมูลใหม่จากชีตในครั้งถัดไป');
  } catch (e) { Logger.log('ล้างแคชเรียบร้อยแล้ว'); }
}

function showSystemStatus() {
  var s = storageStats_();
  var pending = dbWhere('Payments', function (p) { return p.status === 'pending'; }).length;
  var msg = [
    'เวอร์ชันระบบ : ' + APP.VERSION,
    '',
    'สมาชิก           : ' + s.counts.members + ' คน',
    'กลุ่ม/ชั้นเรียน  : ' + s.counts.groups,
    'รายการจัดเก็บ    : ' + s.counts.collections,
    'ผู้ที่ต้องชำระ   : ' + s.counts.assignments + ' รายการ',
    'การแจ้งชำระ      : ' + s.counts.payments + ' รายการ',
    'รอตรวจสอบ        : ' + pending + ' รายการ',
    'บันทึกกิจกรรม    : ' + s.counts.audit_logs + ' รายการ',
    '',
    'ลิงก์เว็บแอป : ' + (webAppUrl_() || 'ยังไม่ได้เผยแพร่')
  ].join('\n');
  try {
    SpreadsheetApp.getUi().alert('สรุปสถานะระบบ', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { Logger.log(msg); }
}
