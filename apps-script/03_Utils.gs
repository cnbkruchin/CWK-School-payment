/**
 * ===========================================================================
 *  ฟังก์ชันช่วยเหลือทั่วไป: ข้อผิดพลาด, ตรวจสอบข้อมูล, วันที่ไทย, จำนวนเงิน
 * ===========================================================================
 */

/** ข้อผิดพลาดที่ปลอดภัยจะแสดงให้ผู้ใช้เห็น */
function AppError(message, code) {
  this.name = 'AppError';
  this.message = message;
  this.code = code || 'ERROR';
  this.isAppError = true;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function fail_(message, code) {
  throw new AppError(message, code);
}

/* ------------------------------ ตรวจสอบข้อมูล ------------------------------ */

function str_(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  return max ? s.substring(0, max) : s;
}

function num_(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback === undefined ? 0 : fallback;
  var n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function money_(v, fallback) {
  var n = num_(v, fallback === undefined ? 0 : fallback);
  return Math.round(Math.max(0, n) * 100) / 100;
}

function bool_(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v === null || v === undefined ? '' : v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function id_(v) {
  var n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : null;
}

function isEmail_(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

function padStart_(s, len, ch) {
  s = String(s);
  while (s.length < len) s = ch + s;
  return s;
}

/** แปลงเป็นสตริง ISO ที่ปลอดภัยสำหรับส่งกลับไปหน้าเว็บ */
function iso_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** วันที่รูปแบบ YYYY-MM-DD เท่านั้น */
function dateOnly_(v) {
  var s = str_(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** วัน-เวลา รับได้ทั้ง "YYYY-MM-DDTHH:MM" และ "YYYY-MM-DD HH:MM(:SS)" */
function dateTime_(v) {
  var s = str_(v, 25).replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += ' 00:00:00';
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return null;
  var d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* ------------------------------- วันที่ภาษาไทย ------------------------------- */

var TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function thaiDate_(v, opts) {
  opts = opts || {};
  if (!v) return '-';
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '-';

  // แปลงเป็นเวลาประเทศไทยก่อนแสดงผล
  var parts = Utilities.formatDate(d, APP.TZ, 'd|M|yyyy|HH|mm').split('|');
  var day = parts[0];
  var month = parseInt(parts[1], 10) - 1;
  var year = parseInt(parts[2], 10) + 543;
  var months = opts.short ? TH_MONTHS_SHORT : TH_MONTHS;
  var out = day + ' ' + months[month] + ' ' + year;
  if (opts.withTime) out += ' ' + parts[3] + ':' + parts[4] + ' น.';
  return out;
}

function moneyStr_(n) {
  var v = Number(n) || 0;
  var neg = v < 0;
  var fixed = Math.abs(v).toFixed(2);
  var pieces = fixed.split('.');
  pieces[0] = pieces[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + pieces.join('.');
}

/* --------------------- จำนวนเงินเป็นตัวอักษรไทย (บาทถ้วน) --------------------- */

var NUM_TH = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
var POS_TH = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

function readInteger_(numStr) {
  numStr = String(numStr).replace(/^0+(?=\d)/, '');
  if (numStr === '' || numStr === '0') return 'ศูนย์';
  if (numStr.length > 7) {
    var head = numStr.slice(0, numStr.length - 6);
    var tail = numStr.slice(numStr.length - 6);
    return readInteger_(head) + 'ล้าน' + (/^0+$/.test(tail) ? '' : readInteger_(tail));
  }
  var out = '';
  var len = numStr.length;
  for (var i = 0; i < len; i++) {
    var digit = Number(numStr.charAt(i));
    var pos = len - i - 1;
    if (digit === 0) continue;
    if (pos === 1) out += digit === 1 ? 'สิบ' : digit === 2 ? 'ยี่สิบ' : NUM_TH[digit] + 'สิบ';
    else if (pos === 0 && digit === 1 && len > 1) out += 'เอ็ด';
    else out += NUM_TH[digit] + POS_TH[pos];
  }
  return out;
}

function bahtText_(amount) {
  var n = Math.round((Number(amount) || 0) * 100) / 100;
  var neg = n < 0;
  var abs = Math.abs(n);
  var baht = Math.floor(abs);
  var satang = Math.round((abs - baht) * 100);
  var txt = readInteger_(String(baht)) + 'บาท';
  txt += satang === 0 ? 'ถ้วน' : readInteger_(String(satang)) + 'สตางค์';
  return (neg ? 'ลบ' : '') + txt;
}

/** ปิดบังนามสกุล เช่น ใจดี → ใ**ี */
function maskName_(name) {
  var s = String(name || '').trim();
  if (s.length <= 2) return s;
  var stars = '';
  for (var i = 0; i < s.length - 2; i++) stars += '*';
  return s.charAt(0) + stars + s.charAt(s.length - 1);
}

/* ------------------------------ สุ่มและเข้ารหัส ------------------------------ */

function randomDigits_(n) {
  var out = '';
  while (out.length < n) {
    var bytes = Utilities.getUuid().replace(/\D/g, '');
    out += bytes;
  }
  return out.substring(0, n);
}

function randomToken_(bytes) {
  var s = '';
  while (s.length < bytes * 2) s += Utilities.getUuid().replace(/-/g, '');
  return s.substring(0, bytes * 2);
}

function toHex_(byteArray) {
  var out = '';
  for (var i = 0; i < byteArray.length; i++) {
    var b = byteArray[i];
    if (b < 0) b += 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function sha256Hex_(text) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function sha256HexBytes_(bytes) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

/** กุญแจลับเสริมของระบบ (สร้างอัตโนมัติครั้งแรก) */
function pepper_() {
  return memoGet_('__pepper', function () {
    var props = PropertiesService.getScriptProperties();
    var p = props.getProperty(PROP.PEPPER);
    if (!p) {
      p = randomToken_(32);
      props.setProperty(PROP.PEPPER, p);
    }
    return p;
  });
}

/**
 * เข้ารหัสรหัสผ่านแบบ PBKDF2-HMAC-SHA256 (ทำซ้ำหลายรอบเพื่อให้เดาได้ยาก)
 * Apps Script ไม่มี bcrypt จึงใช้วิธีมาตรฐานนี้แทน
 */
function hashSecret_(plain, salt, iterations) {
  // PBKDF2-HMAC-SHA256 ความยาว 32 ไบต์ (1 บล็อก) ตาม RFC 2898
  //   U1 = HMAC(รหัสผ่าน, เกลือ || INT32BE(1))
  //   Ui = HMAC(รหัสผ่าน, U(i-1))
  //   ผลลัพธ์ = U1 xor U2 xor ... xor Uc
  // หมายเหตุ: Utilities.computeHmacSha256Signature รับเฉพาะ (String,String)
  // หรือ (Byte[],Byte[]) เท่านั้น ผสมชนิดกันไม่ได้ จึงใช้เป็นไบต์ทั้งคู่ทุกรอบ
  var pwBytes = utf8Bytes_(String(plain));
  var block = utf8Bytes_(salt + '|' + pepper_()).concat([0, 0, 0, 1]);

  var u = Utilities.computeHmacSha256Signature(block, pwBytes);
  var out = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, pwBytes);
    for (var j = 0; j < out.length; j++) out[j] ^= u[j];
  }
  return toHex_(out);
}

/** แปลงข้อความเป็นอาร์เรย์ไบต์แบบ UTF-8 */
function utf8Bytes_(text) {
  return Utilities.newBlob(String(text)).getBytes();
}

function makePasswordHash_(plain) {
  var salt = randomToken_(16);
  return { salt: salt, hash: hashSecret_(plain, salt, APP.PBKDF2_ITERATIONS) };
}

function verifyPassword_(plain, salt, hash) {
  if (!salt || !hash) return false;
  return timingSafeEqual_(hashSecret_(plain, salt, APP.PBKDF2_ITERATIONS), hash);
}

function makePinHash_(plain) {
  var salt = randomToken_(16);
  return { salt: salt, hash: hashSecret_(plain, salt, APP.PBKDF2_ITERATIONS_PIN) };
}

function verifyPin_(plain, salt, hash) {
  if (!salt || !hash) return false;
  return timingSafeEqual_(hashSecret_(plain, salt, APP.PBKDF2_ITERATIONS_PIN), hash);
}

/** เปรียบเทียบสตริงโดยใช้เวลาคงที่ กันการเดาจากระยะเวลาตอบสนอง */
function timingSafeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------- สร้างรหัสต่าง ๆ ------------------------------- */

/**
 * สร้างเลขอ้างอิง 4 หลักที่ไม่ซ้ำกับรายการที่ยังไม่ถูกยกเลิก
 * หากเลข 4 หลักเต็ม ระบบจะขยายเป็น 5 และ 6 หลักโดยอัตโนมัติ
 * ต้องเรียกภายใน withLock_ เท่านั้น
 */
function generateRefCode_() {
  var used = {};
  var payments = dbAll('Payments');
  for (var i = 0; i < payments.length; i++) {
    if (payments[i].status !== 'cancelled') used[payments[i].ref_code] = true;
  }
  var lengths = [4, 5, 6];
  for (var L = 0; L < lengths.length; L++) {
    var len = lengths[L];
    for (var t = 0; t < 400; t++) {
      var code = randomDigits_(len);
      if (!used[code]) return code;
    }
  }
  return String(Date.now()).slice(-6) + randomDigits_(2);
}

function generatePin_(len) {
  return randomDigits_(len || 6);
}

function generateMemberCode_(prefix, taken) {
  prefix = prefix || 'M';
  var max = 0;
  var members = dbAll('Members');
  for (var i = 0; i < members.length; i++) {
    var code = String(members[i].member_code || '');
    if (code.indexOf(prefix) === 0) {
      var n = parseInt(code.substring(prefix.length), 10);
      if (isFinite(n) && n > max) max = n;
    }
  }
  var next = max + 1;
  var candidate = prefix + padStart_(String(next), 4, '0');
  while (taken && taken[candidate]) {
    next++;
    candidate = prefix + padStart_(String(next), 4, '0');
  }
  return candidate;
}

function generateCollectionCode_() {
  var yy = padStart_(String((new Date().getFullYear() + 543) % 100), 2, '0');
  var prefix = 'CWK' + yy + '-';
  var max = 0;
  var cols = dbAll('Collections');
  for (var i = 0; i < cols.length; i++) {
    var code = String(cols[i].code || '');
    if (code.indexOf(prefix) === 0) {
      var n = parseInt(code.substring(prefix.length), 10);
      if (isFinite(n) && n > max) max = n;
    }
  }
  return prefix + padStart_(String(max + 1), 3, '0');
}
