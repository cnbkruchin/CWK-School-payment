'use strict';
/** ตัวช่วยจัดรูปแบบข้อมูลภาษาไทย */

const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  // SQLite เก็บเป็น 'YYYY-MM-DD HH:MM:SS' (UTC)
  const s = String(v).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00');
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) d = new Date(s.replace(' ', 'T') + 'Z');
  else d = new Date(s);
  return isNaN(d) ? null : d;
}

/** วันที่ไทย เช่น 19 กันยายน 2569 */
function thaiDate(v, { short = false, withTime = false } = {}) {
  const d = toDate(v);
  if (!d) return '-';
  const months = short ? TH_MONTHS_SHORT : TH_MONTHS;
  const base = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  if (!withTime) return base;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${base} ${hh}:${mm} น.`;
}

/** จำนวนเงินรูปแบบ 1,234.00 */
function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** แปลงจำนวนเงินเป็นตัวอักษรไทย (บาทถ้วน) */
const NUM_TH = ['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
const POS_TH = ['','สิบ','ร้อย','พัน','หมื่น','แสน','ล้าน'];

function readInteger(numStr) {
  numStr = String(numStr).replace(/^0+(?=\d)/, '');
  if (numStr === '' || numStr === '0') return 'ศูนย์';
  if (numStr.length > 7) {
    const head = numStr.slice(0, numStr.length - 6);
    const tail = numStr.slice(numStr.length - 6);
    const tailTxt = /^0+$/.test(tail) ? '' : readInteger(tail);
    return readInteger(head) + 'ล้าน' + tailTxt;
  }
  let out = '';
  const len = numStr.length;
  for (let i = 0; i < len; i++) {
    const digit = Number(numStr[i]);
    const pos = len - i - 1;
    if (digit === 0) continue;
    if (pos === 1) out += digit === 1 ? 'สิบ' : digit === 2 ? 'ยี่สิบ' : NUM_TH[digit] + 'สิบ';
    else if (pos === 0 && digit === 1 && len > 1) out += 'เอ็ด';
    else out += NUM_TH[digit] + POS_TH[pos];
  }
  return out;
}

function bahtText(amount) {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const neg = n < 0;
  const abs = Math.abs(n);
  const baht = Math.floor(abs);
  const satang = Math.round((abs - baht) * 100);
  let txt = readInteger(String(baht)) + 'บาท';
  txt += satang === 0 ? 'ถ้วน' : readInteger(String(satang)) + 'สตางค์';
  return (neg ? 'ลบ' : '') + txt;
}

/** ปิดบังนามสกุลบางส่วน เช่น สมชาย ใจดี -> สมชาย ใ**ี */
function maskName(name) {
  const s = String(name || '').trim();
  if (s.length <= 2) return s;
  return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
}

/** ปีการศึกษาไทยปัจจุบัน (เปลี่ยนปีเมื่อถึงเดือนพฤษภาคม) */
function currentAcademicYear(d = new Date()) {
  const y = d.getFullYear() + 543;
  return d.getMonth() + 1 >= 5 ? y : y - 1;
}

module.exports = { thaiDate, money, bahtText, maskName, toDate, currentAcademicYear, TH_MONTHS, TH_MONTHS_SHORT };
