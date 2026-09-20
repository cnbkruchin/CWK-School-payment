/**
 * ===========================================================================
 *  ซ่อมแซมข้อมูล — จัดรูปแบบคอลัมน์ข้อความและเติมเลข 0 นำหน้าที่หายไป
 *
 *  ที่มาของปัญหา: ถ้าคอลัมน์ในชีตเป็นรูปแบบ "อัตโนมัติ" Google Sheets จะแปลง
 *  ข้อความที่เป็นตัวเลขล้วนให้กลายเป็นตัวเลข เลข 0 นำหน้าจึงหายไป เช่น
 *  เบอร์โทร 0812345678 เหลือ 812345678
 *
 *  ระบบรุ่นใหม่ตั้งรูปแบบคอลัมน์ข้อความเป็น "ข้อความธรรมดา" ไว้แล้ว
 *  ไฟล์นี้ใช้ซ่อมข้อมูลเดิมที่เสียไปก่อนหน้านั้น
 * ===========================================================================
 */

/** คอลัมน์ที่ต้องซ่อม และวิธีซ่อมของแต่ละคอลัมน์ */
var REPAIR_TARGETS = [
  { table: 'Members',      column: 'phone',        mode: 'phone', label: 'เบอร์โทรสมาชิก' },
  { table: 'Admins',       column: 'phone',        mode: 'phone', label: 'เบอร์โทรผู้ดูแลระบบ' },
  { table: 'BankAccounts', column: 'promptpay_id', mode: 'phone', label: 'เลขพร้อมเพย์' },
  { table: 'Members',      column: 'pin_plain',    mode: 'pad6',  label: 'รหัส PIN สมาชิก' },
  { table: 'Payments',     column: 'ref_code',     mode: 'pad4',  label: 'เลขอ้างอิงการแจ้งชำระ' }
];

/** ซ่อมค่าหนึ่งช่องตามวิธีที่กำหนด */
function repairValue_(value, mode) {
  if (mode === 'phone') return normalizePhone_(value);
  if (mode === 'pad6') return padCode_(value, 6);
  if (mode === 'pad4') return padCode_(value, 4);
  return String(value === null || value === undefined ? '' : value);
}

/**
 * ดำเนินการซ่อมทั้งระบบ
 * @param {boolean} dryRun true = ดูผลลัพธ์อย่างเดียว ยังไม่บันทึก
 * @return {Object} สรุปผลรายคอลัมน์ พร้อมตัวอย่างการเปลี่ยนแปลง
 */
function repairTextColumns_(dryRun) {
  return withLock_(function () {
    var ss = ss_();
    var report = { formatted: 0, fixed: 0, scanned: 0, details: [], samples: [] };

    // 1) ตั้งรูปแบบคอลัมน์ข้อความทุกตารางเป็น "ข้อความธรรมดา" เพื่อไม่ให้เสียซ้ำอีก
    if (!dryRun) {
      for (var t = 0; t < SHEET_ORDER.length; t++) {
        var name = SHEET_ORDER[t];
        var sh = ss.getSheetByName(SCHEMA[name].sheet);
        if (!sh) continue;
        applyTextFormat_(sh, SCHEMA[name]);
        report.formatted++;
      }
    }

    // 2) ซ่อมค่าที่เสียไปแล้ว
    for (var i = 0; i < REPAIR_TARGETS.length; i++) {
      var target = REPAIR_TARGETS[i];
      var rows = dbAll(target.table);
      var patches = [];

      for (var r = 0; r < rows.length; r++) {
        var before = rows[r][target.column];
        if (before === null || before === undefined || before === '') continue;
        report.scanned++;

        var after = repairValue_(before, target.mode);
        if (String(after) === String(before)) continue;

        var patch = {};
        patch[target.column] = after;
        patches.push({ id: rows[r].id, patch: patch });

        if (report.samples.length < 12) {
          report.samples.push({
            table: target.label,
            key: rows[r].member_code || rows[r].ref_code || rows[r].username || String(rows[r].id),
            before: String(before),
            after: String(after)
          });
        }
      }

      if (patches.length && !dryRun) dbUpdateMany(target.table, patches);
      report.fixed += patches.length;
      report.details.push({ label: target.label, count: patches.length });
    }

    // 3) ค่าในตารางตั้งค่า (เบอร์โทรโรงเรียน) เก็บเป็น key/value จึงซ่อมแยก
    var phoneSetting = dbFind('Settings', function (x) { return x.key === 'school_phone'; });
    if (phoneSetting && phoneSetting.value) {
      report.scanned++;
      var fixedPhone = normalizePhone_(phoneSetting.value);
      if (fixedPhone !== String(phoneSetting.value)) {
        if (!dryRun) settingsSet({ school_phone: fixedPhone });
        report.fixed++;
        report.details.push({ label: 'เบอร์โทรโรงเรียน', count: 1 });
        if (report.samples.length < 12) {
          report.samples.push({
            table: 'เบอร์โทรโรงเรียน', key: 'school_phone',
            before: String(phoneSetting.value), after: fixedPhone
          });
        }
      }
    }

    return report;
  });
}

/** API สำหรับปุ่ม "ดำเนินการ" ในหน้าตั้งค่าระบบ */
function apiRepairPhones(payload) {
  return apiCall_('repairPhones', function () {
    payload = payload || {};
    var session = requireSuper_(payload.token);
    var dryRun = !!payload.dry_run;
    var report = repairTextColumns_(dryRun);

    if (!dryRun) {
      audit_(session, 'จัดรูปแบบเบอร์โทรและเติมเลข 0 นำหน้า', {
        detail: 'ตั้งรูปแบบ ' + report.formatted + ' ชีต แก้ไข ' + report.fixed + ' รายการ'
      });
    }
    return report;
  });
}

/** เมนูในไฟล์ Google Sheets */
function repairPhoneNumbers() {
  var ui = SpreadsheetApp.getUi();
  var preview = repairTextColumns_(true);

  if (!preview.fixed) {
    ui.alert('ไม่พบข้อมูลที่ต้องแก้ไข',
      'ตรวจแล้ว ' + preview.scanned + ' รายการ ทุกรายการอยู่ในรูปแบบที่ถูกต้องแล้ว\n\n' +
      'จะตั้งรูปแบบคอลัมน์เป็นข้อความธรรมดาให้ เพื่อไม่ให้เลข 0 นำหน้าหายอีก',
      ui.ButtonSet.OK);
    repairTextColumns_(false);
    return;
  }

  var lines = preview.samples.map(function (s) {
    return '  ' + s.table + ' ' + s.key + ' : ' + s.before + '  →  ' + s.after;
  }).join('\n');

  var res = ui.alert('จัดรูปแบบเบอร์โทรและเติมเลข 0 นำหน้า',
    'พบข้อมูลที่ต้องแก้ไข ' + preview.fixed + ' รายการ จากทั้งหมด ' + preview.scanned + ' รายการ\n\n' +
    'ตัวอย่าง:\n' + lines + '\n\nต้องการดำเนินการหรือไม่?',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  var done = repairTextColumns_(false);
  ui.alert('ดำเนินการเรียบร้อย',
    'ตั้งรูปแบบคอลัมน์เป็นข้อความธรรมดา ' + done.formatted + ' ชีต\n' +
    'แก้ไขข้อมูล ' + done.fixed + ' รายการ', ui.ButtonSet.OK);
}
