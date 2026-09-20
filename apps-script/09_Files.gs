/**
 * ===========================================================================
 *  จัดเก็บไฟล์สลิปใน Google Drive
 *
 *  ความปลอดภัย: ไฟล์สลิปเก็บไว้ในโฟลเดอร์ส่วนตัวของผู้ติดตั้ง ไม่เปิดเป็น
 *  สาธารณะ การเรียกดูต้องผ่านฟังก์ชันของระบบที่ตรวจสอบสิทธิ์ก่อนเสมอ
 *  แล้วจึงส่งข้อมูลรูปภาพกลับไปเป็น data URL
 * ===========================================================================
 */

var ALLOWED_SLIP_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf'
};

/** ตรวจสอบชนิดไฟล์จริงจากไบต์แรกของไฟล์ ไม่เชื่อนามสกุลหรือ MIME ที่ส่งมา */
function detectMime_(bytes) {
  function at(i) { var b = bytes[i]; return b === undefined ? -1 : (b < 0 ? b + 256 : b); }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
      at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'image/png';
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return 'application/pdf';

  var s = function (from, len) {
    var t = '';
    for (var i = from; i < from + len; i++) t += String.fromCharCode(at(i));
    return t;
  };
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (s(4, 4) === 'ftyp') {
    var brand = s(8, 4);
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heim'].indexOf(brand) >= 0) return 'image/heic';
  }
  return null;
}

/**
 * บันทึกไฟล์สลิปลง Drive
 * @param {string} base64 ข้อมูลไฟล์
 * @param {string} filename ชื่อไฟล์เดิมจากผู้ใช้
 * @return {{fileId:string, mime:string, size:number, hash:string}}
 */
function saveSlip_(base64, filename, refHint) {
  if (!base64) fail_('กรุณาแนบสลิปการโอนเงิน');

  var bytes;
  try {
    bytes = Utilities.base64Decode(String(base64));
  } catch (e) {
    fail_('ไฟล์ที่แนบมาไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่');
  }

  var maxBytes = Math.min(APP.MAX_SLIP_BYTES, settingNumber('max_upload_mb', 5) * 1024 * 1024);
  if (bytes.length > maxBytes) {
    fail_('ไฟล์มีขนาดใหญ่เกิน ' + Math.round(maxBytes / 1024 / 1024) + ' MB กรุณาย่อขนาดไฟล์ก่อนอัปโหลด');
  }
  // ต้องมีอย่างน้อย 12 ไบต์จึงจะตรวจลายเซ็นไฟล์ได้
  if (bytes.length < 12) fail_('ไฟล์ที่แนบมาเสียหายหรือว่างเปล่า');

  // ตรวจชนิดไฟล์จริงจากลายเซ็นในไฟล์ ซึ่งเชื่อถือได้กว่านามสกุลหรือ MIME ที่ส่งมา
  var mime = detectMime_(bytes);
  if (!mime) fail_('รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, HEIC) หรือ PDF เท่านั้น');

  var hash = sha256HexBytes_(bytes);
  var ext = ALLOWED_SLIP_MIME[mime] || '.bin';
  var stamp = Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd-HHmmss');
  var name = 'slip_' + stamp + '_' + (refHint || randomDigits_(4)) + ext;

  var blob = Utilities.newBlob(bytes, mime, name);
  var file = folder_('slips').createFile(blob);

  return { fileId: file.getId(), mime: mime, size: bytes.length, hash: hash, name: name };
}

/** อ่านไฟล์สลิปกลับมาเป็น data URL (ผู้เรียกต้องตรวจสอบสิทธิ์มาก่อนแล้ว) */
function readSlipDataUrl_(fileId) {
  if (!fileId) return null;
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var mime = blob.getContentType() || 'application/octet-stream';
    return {
      data_url: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()),
      mime: mime,
      name: file.getName(),
      size: blob.getBytes().length
    };
  } catch (e) {
    Logger.log('อ่านไฟล์สลิปไม่สำเร็จ: ' + e.message);
    return null;
  }
}

function deleteSlip_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* ไฟล์อาจถูกลบไปแล้ว */ }
}

/**
 * บันทึกโลโก้โรงเรียนเป็น data URL เก็บในชีต Settings
 *
 * ข้อจำกัดสำคัญ: หนึ่งเซลล์ของ Google Sheets เก็บได้ไม่เกิน 50,000 ตัวอักษร
 * data URL แบบ base64 จะยาวกว่าไฟล์จริงราว 1.37 เท่า จึงจำกัดไฟล์ไว้ที่ 32 KB
 * (เพียงพอสำหรับตราโรงเรียนขนาด 256x256 พิกเซล) และแจ้งเตือนอย่างชัดเจน
 */
var LOGO_MAX_BYTES = 32 * 1024;

function saveLogo_(base64, filename) {
  var bytes;
  try {
    bytes = Utilities.base64Decode(String(base64 || ''));
  } catch (e) {
    fail_('ไฟล์โลโก้ไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่');
  }
  if (!bytes.length) fail_('กรุณาเลือกไฟล์โลโก้');

  var mime = detectMime_(bytes);
  if (!mime || mime.indexOf('image/') !== 0) fail_('โลโก้ต้องเป็นไฟล์รูปภาพ (PNG, JPG หรือ WEBP)');

  if (bytes.length > LOGO_MAX_BYTES) {
    fail_('ไฟล์โลโก้มีขนาด ' + Math.round(bytes.length / 1024) + ' KB ซึ่งใหญ่เกินไป ' +
      'กรุณาย่อรูปให้เหลือไม่เกิน ' + Math.round(LOGO_MAX_BYTES / 1024) + ' KB ' +
      '(แนะนำขนาด 256x256 พิกเซล รูปแบบ PNG)');
  }

  var dataUrl = 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes);
  if (dataUrl.length > 49000) {
    fail_('ไฟล์โลโก้ใหญ่เกินกว่าที่ Google Sheets เก็บได้ กรุณาย่อรูปให้เล็กลง');
  }
  return dataUrl;
}
