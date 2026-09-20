/**
 * ===========================================================================
 *  ติดตั้งระบบ — สร้างชีตทั้งหมด โฟลเดอร์ Drive และบัญชีผู้ดูแลคนแรก
 *
 *  วิธีใช้: เปิดเมนู "ระบบแจ้งชำระเงิน" ในไฟล์ Google Sheets แล้วเลือก "ติดตั้งระบบ"
 *           หรือรันฟังก์ชัน setup() จากหน้าต่างแก้ไขสคริปต์
 * ===========================================================================
 */

/** ฟังก์ชันหลักสำหรับติดตั้งระบบ (ปลอดภัยแม้รันซ้ำ) */
function setup() {
  var result = setupSilent_();
  var lines = [
    '✅ ติดตั้งระบบเรียบร้อยแล้ว',
    '',
    'ชีตที่สร้าง/ตรวจสอบแล้ว: ' + result.sheetsCreated + ' ชีต',
    'โฟลเดอร์เก็บไฟล์: ' + result.folderName,
    ''
  ];
  if (result.adminCreated) {
    lines.push('สร้างบัญชีผู้ดูแลระบบแรกแล้ว');
    lines.push('  ชื่อผู้ใช้ : ' + result.adminUsername);
    lines.push('  อีเมล     : ' + result.adminEmail);
    lines.push('  รหัสผ่าน  : ' + result.adminPassword);
    lines.push('');
    lines.push('⚠ กรุณาบันทึกรหัสผ่านนี้ไว้ และเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก');
  } else {
    lines.push('มีบัญชีผู้ดูแลระบบอยู่แล้ว ' + result.adminCount + ' บัญชี');
  }
  lines.push('');
  lines.push('ขั้นตอนถัดไป: Deploy > New deployment > Web app');
  lines.push('  Execute as      : Me');
  lines.push('  Who has access  : Anyone');

  var message = lines.join('\n');
  try {
    SpreadsheetApp.getUi().alert('ติดตั้งระบบ', message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(message);   // เมื่อรันจากหน้าต่างสคริปต์จะไม่มี UI
  }
  return result;
}

/** ติดตั้งโดยไม่แสดงกล่องข้อความ (ใช้ในการทดสอบและการเรียกจากโค้ด) */
function setupSilent_(opts) {
  opts = opts || {};
  var ss = ss_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  var created = 0;
  for (var i = 0; i < SHEET_ORDER.length; i++) {
    if (ensureSheet_(ss, SHEET_ORDER[i])) created++;
  }

  // ลบชีตเริ่มต้นที่ว่างเปล่าของ Google Sheets ออก
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var name = sheets[s].getName();
    if ((name === 'Sheet1' || name === 'แผ่น1') && sheets.length > 1 && sheets[s].getLastRow() === 0) {
      try { ss.deleteSheet(sheets[s]); } catch (e) { /* ลบไม่ได้ก็ไม่เป็นไร */ }
      break;
    }
  }

  memoClear_();
  seedDefaultSettings_();
  var folders = ensureFolders_();
  pepper_();   // สร้างกุญแจลับเสริมครั้งแรก

  // สร้างกลุ่มตัวอย่างหากยังไม่มีกลุ่มใด ๆ
  if (dbAll('Groups').length === 0 && opts.seedGroups !== false) {
    var names = ['ม.1/1', 'ม.2/1', 'ม.3/1', 'ม.4/1', 'ม.5/1', 'ม.6/1', 'คณะครูและบุคลากร'];
    var rows = [];
    for (var g = 0; g < names.length; g++) {
      rows.push({ name: names[g], description: '', sort_order: g, is_active: true });
    }
    dbInsertMany('Groups', rows);
  }

  // สร้างบัญชีผู้ดูแลคนแรก
  var admins = dbAll('Admins');
  var out = {
    sheetsCreated: created,
    folderName: folders.rootName,
    adminCreated: false,
    adminCount: admins.length,
    spreadsheetUrl: ss.getUrl()
  };

  if (admins.length === 0) {
    var email = opts.adminEmail || safeUserEmail_();
    var username = opts.adminUsername || 'admin';
    var password = opts.adminPassword || ('Cwk' + randomDigits_(8));
    var pw = makePasswordHash_(password);

    dbInsert('Admins', {
      username: username,
      email: email,
      full_name: opts.adminName || 'ผู้ดูแลระบบ',
      password_hash: pw.hash,
      password_salt: pw.salt,
      role: 'superadmin',
      phone: '',
      is_active: true,
      must_change_pw: true,
      failed_attempts: 0
    });

    out.adminCreated = true;
    out.adminUsername = username;
    out.adminEmail = email;
    out.adminPassword = password;
    out.adminCount = 1;

    audit_(null, 'ติดตั้งระบบและสร้างบัญชีผู้ดูแลคนแรก', { actorType: 'system', actorName: 'ระบบ', detail: username });
  }

  PropertiesService.getScriptProperties().setProperty(PROP.INSTALLED_AT, new Date().toISOString());
  return out;
}

/** อีเมลของผู้ติดตั้ง (บาง account อาจไม่อนุญาตให้อ่าน) */
function safeUserEmail_() {
  try {
    var e = Session.getEffectiveUser().getEmail();
    if (e) return e;
  } catch (err) { /* ไม่มีสิทธิ์อ่านอีเมล */ }
  return 'admin@example.com';
}

/** สร้างชีตพร้อมหัวตารางและการจัดรูปแบบ (คืนค่า true หากเพิ่งสร้างใหม่) */
function ensureSheet_(ss, table) {
  var def = SCHEMA[table];
  var sh = ss.getSheetByName(def.sheet);
  var isNew = false;

  if (!sh) {
    sh = ss.insertSheet(def.sheet);
    isNew = true;
  }

  // เขียนหัวตารางเสมอ เพื่อซ่อมแซมกรณีมีคนแก้ไขด้วยมือ
  var headers = [];
  for (var i = 0; i < def.columns.length; i++) headers.push(def.columns[i].header);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  var head = sh.getRange(1, 1, 1, headers.length);
  head.setFontWeight('bold');
  head.setBackground('#4f46e5');
  head.setFontColor('#ffffff');
  head.setVerticalAlignment('middle');
  head.setWrap(true);
  sh.setFrozenRows(1);

  for (var c = 0; c < def.columns.length; c++) {
    if (def.columns[c].width) sh.setColumnWidth(c + 1, def.columns[c].width);
  }

  applyTextFormat_(sh, def);

  // ซ่อนชีตที่เก็บข้อมูลอ่อนไหวหรือข้อมูลระบบ
  if (table === 'Sessions' || table === 'PasswordResets') {
    try { sh.hideSheet(); } catch (e) { /* ซ่อนไม่ได้ก็ไม่เป็นไร */ }
  }

  return isNew;
}

/**
 * ตั้งรูปแบบคอลัมน์ข้อความเป็น "ข้อความธรรมดา" (@)
 *
 * จำเป็นมาก: ถ้าปล่อยเป็นรูปแบบอัตโนมัติ Google Sheets จะแปลงข้อความที่เป็น
 * ตัวเลขล้วนให้เป็นตัวเลข ทำให้เลข 0 นำหน้าหายไป เช่น
 *   เบอร์โทร   0812345678 -> 812345678   (เหลือ 9 หลัก)
 *   รหัส PIN   012345     -> 12345
 *   เลขอ้างอิง 0123       -> 123
 *   พร้อมเพย์  0812345678 -> 812345678   (QR ผิด)
 */
function applyTextFormat_(sh, def) {
  var maxRows = sh.getMaxRows();
  if (maxRows < 2) return;

  // รวมคอลัมน์ข้อความที่อยู่ติดกันเป็นบล็อกเดียว เพื่อลดจำนวนครั้งที่เรียก Sheets
  var start = -1;
  for (var c = 0; c <= def.columns.length; c++) {
    var isText = c < def.columns.length && def.columns[c].type === 'string';
    if (isText && start < 0) start = c;
    if (!isText && start >= 0) {
      sh.getRange(2, start + 1, maxRows - 1, c - start).setNumberFormat('@');
      start = -1;
    }
  }
}

function seedDefaultSettings_() {
  var existing = {};
  var rows = dbAll('Settings');
  for (var i = 0; i < rows.length; i++) existing[rows[i].key] = true;

  var toAdd = {};
  var any = false;
  for (var k in DEFAULT_SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) continue;
    if (!existing[k]) { toAdd[k] = DEFAULT_SETTINGS[k]; any = true; }
  }
  if (any) settingsSet(toAdd);
}

/* ------------------------------ โฟลเดอร์ Drive ------------------------------ */

function folderIds_() {
  return memoGet_('__folders', function () {
    var raw = PropertiesService.getScriptProperties().getProperty(PROP.FOLDER_IDS);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) { return {}; }
  });
}

function ensureFolders_() {
  var ids = folderIds_();
  var changed = false;

  function getOrCreateChild(parent, name) {
    var it = parent.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return parent.createFolder(name);
  }

  var root;
  if (ids.root) {
    try { root = DriveApp.getFolderById(ids.root); } catch (e) { root = null; }
  }
  if (!root) {
    var it = DriveApp.getFoldersByName(APP.FOLDER_ROOT);
    root = it.hasNext() ? it.next() : DriveApp.createFolder(APP.FOLDER_ROOT);
    ids.root = root.getId();
    changed = true;
  }

  var map = { slips: APP.FOLDER_SLIPS, reports: APP.FOLDER_REPORTS, branding: APP.FOLDER_BRANDING };
  for (var key in map) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
    var ok = false;
    if (ids[key]) {
      try { DriveApp.getFolderById(ids[key]); ok = true; } catch (e) { ok = false; }
    }
    if (!ok) {
      ids[key] = getOrCreateChild(root, map[key]).getId();
      changed = true;
    }
  }

  if (changed) {
    PropertiesService.getScriptProperties().setProperty(PROP.FOLDER_IDS, JSON.stringify(ids));
    memoClear_('__folders');
  }
  return { ids: ids, rootName: APP.FOLDER_ROOT };
}

function folder_(key) {
  var ids = folderIds_();
  if (!ids[key]) ids = ensureFolders_().ids;
  return DriveApp.getFolderById(ids[key]);
}

/* ------------------------------ บันทึกกิจกรรม ------------------------------ */

/**
 * บันทึกกิจกรรมลงชีต AuditLogs
 * เขียนแบบ appendRow เพื่อความเร็ว และไม่ทำให้การทำงานหลักล้มเหลวหากบันทึกไม่ได้
 */
function audit_(admin, action, opts) {
  opts = opts || {};
  try {
    var def = SCHEMA.AuditLogs;
    var obj = {
      id: nextIds_('AuditLogs', 1)[0],
      created_at: new Date(),
      actor_type: opts.actorType || (admin ? 'admin' : 'system'),
      actor_id: opts.actorId !== undefined ? opts.actorId : (admin ? admin.id : null),
      actor_name: opts.actorName || (admin ? (admin.full_name || admin.username) : 'ระบบ'),
      action: action,
      target_type: opts.targetType || '',
      target_id: opts.targetId !== undefined ? opts.targetId : null,
      detail: opts.detail === undefined || opts.detail === null ? ''
        : (typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail))
    };
    var values = [];
    for (var i = 0; i < def.columns.length; i++) {
      values.push(toCell_(obj[def.columns[i].key], def.columns[i].type));
    }
    sheet_('AuditLogs').appendRow(values);
    bumpVersion_('AuditLogs');
  } catch (e) {
    Logger.log('บันทึกกิจกรรมไม่สำเร็จ: ' + e.message);
  }
}
