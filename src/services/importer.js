'use strict';
const Papa = require('papaparse');
const ExcelJS = require('exceljs');

/** ชื่อคอลัมน์ที่ระบบรู้จัก (ไทย/อังกฤษ) */
const COLUMN_MAP = {
  member_code: ['รหัสสมาชิก', 'รหัส', 'เลขประจำตัว', 'เลขประจำตัวนักเรียน', 'member_code', 'code', 'id', 'studentid', 'student_id'],
  prefix: ['คำนำหน้า', 'คํานําหน้า', 'prefix', 'title'],
  first_name: ['ชื่อ', 'ชื่อจริง', 'first_name', 'firstname', 'fname', 'given_name'],
  last_name: ['นามสกุล', 'สกุล', 'last_name', 'lastname', 'lname', 'surname', 'family_name'],
  full_name: ['ชื่อ-สกุล', 'ชื่อ-นามสกุล', 'ชื่อสกุล', 'ชื่อ นามสกุล', 'ชื่อ - สกุล', 'full_name', 'fullname', 'name'],
  group_name: ['กลุ่ม', 'ชั้น', 'ชั้นเรียน', 'ห้อง', 'ระดับชั้น', 'กลุ่ม/ชั้น', 'group', 'class', 'room', 'level'],
  phone: ['เบอร์โทร', 'โทรศัพท์', 'เบอร์โทรศัพท์', 'เบอร์', 'phone', 'tel', 'mobile'],
  email: ['อีเมล', 'email', 'e-mail', 'mail'],
  guardian: ['ผู้ปกครอง', 'ชื่อผู้ปกครอง', 'guardian', 'parent'],
  note: ['หมายเหตุ', 'note', 'remark', 'comment'],
  amount: ['จำนวนเงิน', 'ยอด', 'ยอดชำระ', 'ยอดที่ต้องชำระ', 'amount', 'due', 'total'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[._-]/g, '');
}

function buildHeaderIndex(headers) {
  const idx = {};
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (!n) return;
    for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
      if (aliases.some((a) => normalizeHeader(a) === n)) {
        if (idx[field] === undefined) idx[field] = i;
        return;
      }
    }
  });
  return idx;
}

/** ถอดรหัสไฟล์ CSV ให้รองรับทั้ง UTF-8 (มี/ไม่มี BOM) และ TIS-620/Windows-874 */
function decodeCsv(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);

  const utf8 = buffer.toString('utf8');
  // ถ้ามีอักขระเสีย (U+FFFD) แปลว่าน่าจะเป็น TIS-620
  if (utf8.includes('�')) {
    try { return new TextDecoder('windows-874').decode(buffer); } catch { /* ignore */ }
  }
  return utf8;
}

/** อ่านไฟล์เป็นตาราง (array ของ array) */
async function readTable(buffer, filename = '') {
  const ext = String(filename).toLowerCase().split('.').pop();

  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('ไม่พบข้อมูลในไฟล์ Excel');
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const arr = [];
      const n = Math.max(row.cellCount, row.actualCellCount);
      for (let i = 1; i <= n; i++) {
        const cell = row.getCell(i);
        let val = cell.value;
        if (val && typeof val === 'object') {
          if (val.richText) val = val.richText.map((t) => t.text).join('');
          else if (val.text !== undefined) val = val.text;
          else if (val.result !== undefined) val = val.result;
          else if (val instanceof Date) val = val.toISOString().slice(0, 10);
          else val = String(val);
        }
        arr.push(val === null || val === undefined ? '' : String(val).trim());
      }
      rows.push(arr);
    });
    return rows;
  }

  // CSV / TSV / TXT
  const text = decodeCsv(buffer);
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy', delimiter: '' });
  if (parsed.errors && parsed.errors.length && !parsed.data.length) {
    throw new Error('ไม่สามารถอ่านไฟล์ CSV ได้: ' + parsed.errors[0].message);
  }
  return parsed.data.map((r) => r.map((c) => String(c ?? '').trim()));
}

/** แยกชื่อ-นามสกุลจากข้อความเดียว */
const PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นางสาว', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.', 'น.ส.', 'ดช.', 'ดญ.'];
function splitFullName(full) {
  let s = String(full || '').trim().replace(/\s+/g, ' ');
  let prefix = '';
  for (const p of PREFIXES) {
    if (s.startsWith(p)) { prefix = p; s = s.slice(p.length).trim(); break; }
  }
  const parts = s.split(' ');
  const first = parts.shift() || '';
  const last = parts.join(' ');
  return { prefix, first_name: first, last_name: last };
}

/**
 * แปลงไฟล์เป็นรายการสมาชิก
 * @returns {{rows: Array, headers: Array, skipped: number}}
 */
async function parseMembers(buffer, filename) {
  const table = await readTable(buffer, filename);
  if (!table.length) throw new Error('ไฟล์ว่างเปล่า ไม่มีข้อมูลให้นำเข้า');

  // หาแถวหัวตาราง (ภายใน 10 แถวแรก)
  let headerRow = -1;
  let idx = {};
  for (let i = 0; i < Math.min(10, table.length); i++) {
    const cand = buildHeaderIndex(table[i]);
    const score = ['first_name', 'last_name', 'full_name', 'member_code'].filter((k) => cand[k] !== undefined).length;
    if (score >= 1) { headerRow = i; idx = cand; break; }
  }
  if (headerRow === -1) {
    throw new Error(
      'ไม่พบหัวตารางที่ระบบรู้จัก กรุณาใช้หัวคอลัมน์ เช่น "รหัสสมาชิก, คำนำหน้า, ชื่อ, นามสกุล, กลุ่ม, เบอร์โทร" หรือดาวน์โหลดไฟล์ต้นแบบจากระบบ'
    );
  }

  const get = (row, field) => (idx[field] !== undefined ? String(row[idx[field]] ?? '').trim() : '');
  const rows = [];
  let skipped = 0;

  for (let i = headerRow + 1; i < table.length; i++) {
    const row = table[i];
    if (!row || row.every((c) => !String(c || '').trim())) { continue; }

    let prefix = get(row, 'prefix');
    let first = get(row, 'first_name');
    let last = get(row, 'last_name');
    const full = get(row, 'full_name');

    if ((!first || !last) && full) {
      const sp = splitFullName(full);
      prefix = prefix || sp.prefix;
      first = first || sp.first_name;
      last = last || sp.last_name;
    }
    if (!first && !last) { skipped++; continue; }

    const amountRaw = get(row, 'amount').replace(/[^\d.-]/g, '');
    rows.push({
      line: i + 1,
      member_code: get(row, 'member_code'),
      prefix,
      first_name: first,
      last_name: last,
      group_name: get(row, 'group_name'),
      phone: get(row, 'phone').replace(/[^\d+\-() ]/g, ''),
      email: get(row, 'email'),
      guardian: get(row, 'guardian'),
      note: get(row, 'note'),
      amount: amountRaw ? Number(amountRaw) : null,
    });
  }

  return { rows, headers: Object.keys(idx), skipped, headerRow: headerRow + 1 };
}

module.exports = { parseMembers, readTable, splitFullName, decodeCsv, COLUMN_MAP };
