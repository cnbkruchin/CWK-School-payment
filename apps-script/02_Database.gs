/**
 * ===========================================================================
 *  ชั้นฐานข้อมูล — ใช้ Google Sheets เป็นตารางข้อมูล
 *
 *  เคล็ดลับความเร็วที่ใช้ในไฟล์นี้:
 *   • อ่านทั้งชีตในครั้งเดียวด้วย getValues() — ไม่อ่านทีละเซลล์
 *   • แปลงเป็น object พร้อม index (id → แถว) เพื่อค้นหาแบบ O(1)
 *   • แคชผลลัพธ์ไว้ (ดูไฟล์ 01_Cache.gs) — คำขอถัดไปไม่แตะ Sheets เลย
 *   • เขียนข้อมูลแบบรวมกลุ่ม (batch) ด้วย setValues() ครั้งเดียวต่อบล็อก
 *   • ใช้ LockService ครอบการเขียนทุกครั้ง กันข้อมูลชนกันเมื่อมีผู้ใช้พร้อมกัน
 * ===========================================================================
 */

function ss_() {
  return memoGet_('__ss', function () {
    var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (id) {
      try { return SpreadsheetApp.openById(id); } catch (e) { /* ใช้วิธีสำรองด้านล่าง */ }
    }
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) {
      throw new Error('ไม่พบไฟล์ Google Sheets ของระบบ กรุณารันฟังก์ชัน setup() หนึ่งครั้งก่อนใช้งาน');
    }
    return active;
  });
}

function sheet_(table) {
  return memoGet_('__sheet:' + table, function () {
    var def = SCHEMA[table];
    if (!def) throw new Error('ไม่รู้จักตาราง: ' + table);
    var sh = ss_().getSheetByName(def.sheet);
    if (!sh) throw new Error('ไม่พบชีต "' + def.sheet + '" กรุณารันฟังก์ชัน setup() เพื่อสร้างโครงสร้างข้อมูล');
    return sh;
  });
}

/* --------------------------- แปลงค่าระหว่างชีตกับ JS --------------------------- */

function toCell_(value, type) {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'number': {
      var n = Number(value);
      return isNaN(n) ? '' : n;
    }
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 'true' ? true : false;
    case 'date':
    case 'datetime': {
      if (value instanceof Date) return value;
      var d = new Date(value);
      return isNaN(d.getTime()) ? '' : d;
    }
    default:
      return String(value);
  }
}

function fromCell_(value, type) {
  switch (type) {
    case 'number': {
      if (value === '' || value === null || value === undefined) return null;
      var n = Number(value);
      return isNaN(n) ? null : n;
    }
    case 'bool':
      return value === true || value === 1 || value === '1' || value === 'TRUE' || value === 'true';
    case 'date':
    case 'datetime': {
      if (value === '' || value === null || value === undefined) return null;
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
      var d = new Date(value);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/* ------------------------------- อ่านข้อมูลตาราง ------------------------------- */

/**
 * อ่านทั้งตารางเป็น array ของ object
 * ลำดับการหาข้อมูล: หน่วยความจำ → แคช → Google Sheets
 * @param {string} table ชื่อตารางตาม SCHEMA
 * @return {{rows: Array<Object>, index: Object, rowOf: Object}}
 */
function loadTable_(table) {
  var version = versionOf_(table);
  var memoKey = 'tbl:' + table + ':' + version;

  return memoGet_(memoKey, function () {
    var cacheKey = 'v3:' + table + ':' + version;
    var cached = cacheGet_(cacheKey);
    if (cached) {
      try {
        var parsed = JSON.parse(cached);
        return buildIndex_(table, parsed.rows, parsed.firstRow);
      } catch (e) { /* แคชเสีย — อ่านจากชีตใหม่ */ }
    }

    var def = SCHEMA[table];
    var sh = sheet_(table);
    var lastRow = sh.getLastRow();
    var rows = [];

    if (lastRow > 1) {
      // อ่านทั้งบล็อกในครั้งเดียว — นี่คือจุดที่ประหยัดเวลามากที่สุด
      var values = sh.getRange(2, 1, lastRow - 1, def.columns.length).getValues();
      for (var i = 0; i < values.length; i++) {
        var raw = values[i];
        // ข้ามแถวว่าง (เกิดจากการลบข้อมูลด้วยมือในชีต)
        if (raw[0] === '' && raw[1] === '') continue;
        var obj = {};
        for (var c = 0; c < def.columns.length; c++) {
          obj[def.columns[c].key] = fromCell_(raw[c], def.columns[c].type);
        }
        obj.__row = i + 2;
        rows.push(obj);
      }
    }

    cachePut_(cacheKey, JSON.stringify({ rows: rows, firstRow: 2 }));
    return buildIndex_(table, rows, 2);
  });
}

function buildIndex_(table, rows, firstRow) {
  var def = SCHEMA[table];
  var index = {};
  var rowOf = {};
  if (def.idField !== null) {
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].id;
      if (id !== null && id !== undefined && id !== '') {
        index[id] = rows[i];
        rowOf[id] = rows[i].__row;
      }
    }
  }
  return { rows: rows, index: index, rowOf: rowOf, firstRow: firstRow };
}

/* ------------------------------- API ของตาราง ------------------------------- */

/** คืนข้อมูลทั้งตาราง (สำเนาอ่านอย่างเดียว) */
function dbAll(table) {
  return loadTable_(table).rows;
}

/** ค้นหาด้วย id — เร็วระดับ O(1) */
function dbGet(table, id) {
  if (id === null || id === undefined || id === '') return null;
  var t = loadTable_(table);
  return t.index[Number(id)] || null;
}

/** ค้นหาด้วยเงื่อนไข */
function dbWhere(table, predicate) {
  return loadTable_(table).rows.filter(predicate);
}

/** ค้นหารายการแรกที่ตรงเงื่อนไข */
function dbFind(table, predicate) {
  var rows = loadTable_(table).rows;
  for (var i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
  return null;
}

/** จัดกลุ่มข้อมูลตามค่าของคอลัมน์ — ใช้แทนการวนซ้อนกันหลายชั้น (เร็วกว่ามาก) */
function dbGroupBy(table, key) {
  var version = versionOf_(table);
  return memoGet_('grp:' + table + ':' + key + ':' + version, function () {
    var map = {};
    var rows = loadTable_(table).rows;
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i][key];
      if (k === null || k === undefined || k === '') continue;
      if (!map[k]) map[k] = [];
      map[k].push(rows[i]);
    }
    return map;
  });
}

/* ------------------------------ ตัวนับ id อัตโนมัติ ------------------------------ */

function nextIds_(table, count) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(PROP.SEQUENCES);
  var seq = {};
  if (raw) { try { seq = JSON.parse(raw); } catch (e) { seq = {}; } }

  var current = seq[table];
  if (current === undefined) {
    // ครั้งแรก: หาค่า id สูงสุดจากข้อมูลที่มีอยู่
    var max = 0;
    var rows = loadTable_(table).rows;
    for (var i = 0; i < rows.length; i++) {
      var v = Number(rows[i].id) || 0;
      if (v > max) max = v;
    }
    current = max;
  }

  var ids = [];
  for (var j = 1; j <= count; j++) ids.push(current + j);
  seq[table] = current + count;
  props.setProperty(PROP.SEQUENCES, JSON.stringify(seq));
  return ids;
}

/* --------------------------------- เขียนข้อมูล --------------------------------- */

function rowValues_(table, obj) {
  var def = SCHEMA[table];
  var out = [];
  for (var i = 0; i < def.columns.length; i++) {
    var col = def.columns[i];
    out.push(toCell_(obj[col.key], col.type));
  }
  return out;
}

/**
 * เพิ่มข้อมูลหลายแถวในครั้งเดียว — เขียนลงชีตเพียงครั้งเดียว
 * @return {Array<Object>} แถวที่เพิ่ม (พร้อม id)
 */
function dbInsertMany(table, objects) {
  if (!objects || !objects.length) return [];
  var def = SCHEMA[table];
  var sh = sheet_(table);
  var now = new Date();

  var ids = def.idField === null ? [] : nextIds_(table, objects.length);
  var values = [];
  var created = [];

  for (var i = 0; i < objects.length; i++) {
    var obj = {};
    for (var k in objects[i]) if (Object.prototype.hasOwnProperty.call(objects[i], k)) obj[k] = objects[i][k];
    if (def.idField !== null && (obj.id === undefined || obj.id === null)) obj.id = ids[i];
    if (hasColumn_(table, 'created_at') && !obj.created_at) obj.created_at = now;
    if (hasColumn_(table, 'updated_at') && !obj.updated_at) obj.updated_at = now;
    values.push(rowValues_(table, obj));
    created.push(obj);
  }

  var startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 1, values.length, def.columns.length).setValues(values);
  bumpVersion_(table);
  return created;
}

function dbInsert(table, obj) {
  return dbInsertMany(table, [obj])[0];
}

/** แก้ไขข้อมูลหนึ่งแถว (เขียนเฉพาะแถวนั้น) */
function dbUpdate(table, id, patch) {
  var t = loadTable_(table);
  var row = t.index[Number(id)];
  if (!row) throw new AppError('ไม่พบข้อมูลที่ต้องการแก้ไข');

  var merged = {};
  for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k)) merged[k] = row[k];
  for (var p in patch) if (Object.prototype.hasOwnProperty.call(patch, p)) merged[p] = patch[p];
  if (hasColumn_(table, 'updated_at')) merged.updated_at = new Date();

  var def = SCHEMA[table];
  sheet_(table).getRange(row.__row, 1, 1, def.columns.length).setValues([rowValues_(table, merged)]);
  bumpVersion_(table);
  return merged;
}

/** แก้ไขหลายแถวพร้อมกัน — รวมแถวที่ติดกันเป็นบล็อกเดียวเพื่อลดจำนวนคำสั่งเขียน */
function dbUpdateMany(table, patches) {
  if (!patches || !patches.length) return 0;
  var t = loadTable_(table);
  var def = SCHEMA[table];
  var sh = sheet_(table);

  var items = [];
  for (var i = 0; i < patches.length; i++) {
    var row = t.index[Number(patches[i].id)];
    if (!row) continue;
    var merged = {};
    for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k)) merged[k] = row[k];
    var patch = patches[i].patch || patches[i];
    for (var p in patch) if (Object.prototype.hasOwnProperty.call(patch, p) && p !== 'id') merged[p] = patch[p];
    if (hasColumn_(table, 'updated_at')) merged.updated_at = new Date();
    items.push({ row: row.__row, values: rowValues_(table, merged) });
  }
  if (!items.length) return 0;

  items.sort(function (a, b) { return a.row - b.row; });

  // รวมแถวที่อยู่ติดกันเป็นบล็อกเดียว
  var start = 0;
  var count = 0;
  for (var j = 1; j <= items.length; j++) {
    var isBreak = j === items.length || items[j].row !== items[j - 1].row + 1;
    if (isBreak) {
      var block = items.slice(start, j).map(function (x) { return x.values; });
      sh.getRange(items[start].row, 1, block.length, def.columns.length).setValues(block);
      count += block.length;
      start = j;
    }
  }
  bumpVersion_(table);
  return count;
}

/**
 * ลบข้อมูลหลายแถว — ลบจากล่างขึ้นบนเพื่อไม่ให้เลขแถวเลื่อน
 * และรวมแถวติดกันเป็นบล็อกเดียว
 */
function dbDeleteMany(table, ids) {
  if (!ids || !ids.length) return 0;
  var t = loadTable_(table);
  var sh = sheet_(table);

  var rowNumbers = [];
  for (var i = 0; i < ids.length; i++) {
    var r = t.rowOf[Number(ids[i])];
    if (r) rowNumbers.push(r);
  }
  if (!rowNumbers.length) return 0;

  rowNumbers.sort(function (a, b) { return b - a; });   // มาก → น้อย

  var deleted = 0;
  var i2 = 0;
  while (i2 < rowNumbers.length) {
    var end = rowNumbers[i2];       // แถวล่างสุดของบล็อก
    var len = 1;
    while (i2 + len < rowNumbers.length && rowNumbers[i2 + len] === end - len) len++;
    var top = end - len + 1;
    sh.deleteRows(top, len);
    deleted += len;
    i2 += len;
  }
  bumpVersion_(table);
  return deleted;
}

function dbDelete(table, id) {
  return dbDeleteMany(table, [id]);
}

function hasColumn_(table, key) {
  var def = SCHEMA[table];
  for (var i = 0; i < def.columns.length; i++) if (def.columns[i].key === key) return true;
  return false;
}

/* --------------------------------- การล็อก --------------------------------- */

/**
 * ครอบการทำงานที่มีการเขียนข้อมูลด้วย LockService
 * ป้องกันข้อมูลชนกันเมื่อผู้ปกครองหลายคนแจ้งชำระพร้อมกัน
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(APP.LOCK_WAIT_MS);
  } catch (e) {
    throw new AppError('ระบบกำลังมีผู้ใช้งานพร้อมกันจำนวนมาก กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
  }
  try {
    // ล้างแคชในหน่วยความจำ เพื่อให้อ่านข้อมูลล่าสุดหลังได้ล็อก
    memoClear_('__versions');
    memoClear_('tbl:');
    memoClear_('grp:');
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ปล่อยล็อกไม่สำเร็จไม่กระทบผลลัพธ์ */ }
  }
}

/* --------------------------------- ตั้งค่าระบบ --------------------------------- */

function settingsAll() {
  var version = versionOf_('Settings');
  return memoGet_('settings:' + version, function () {
    var out = {};
    for (var k in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) out[k] = DEFAULT_SETTINGS[k];
    }
    var rows = loadTable_('Settings').rows;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].key) out[rows[i].key] = rows[i].value;
    }
    return out;
  });
}

function setting(key, fallback) {
  var all = settingsAll();
  var v = all[key];
  return v === undefined || v === null ? (fallback === undefined ? null : fallback) : v;
}

function settingBool(key) {
  return String(setting(key, '0')) === '1';
}

function settingNumber(key, fallback) {
  var n = Number(setting(key, fallback));
  return isNaN(n) ? fallback : n;
}

/** บันทึกค่าตั้งค่าหลายค่าในครั้งเดียว (เขียนชีตครั้งเดียว) */
function settingsSet(patch) {
  var sh = sheet_('Settings');
  var t = loadTable_('Settings');
  var now = new Date();

  var byKey = {};
  for (var i = 0; i < t.rows.length; i++) byKey[t.rows[i].key] = t.rows[i];

  var updates = [];
  var inserts = [];
  for (var k in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
    var val = patch[k];
    var str = val === true ? '1' : val === false ? '0' : (val === null || val === undefined ? '' : String(val));
    if (byKey[k]) updates.push({ row: byKey[k].__row, values: [k, str, now] });
    else inserts.push([k, str, now]);
  }

  updates.sort(function (a, b) { return a.row - b.row; });
  for (var u = 0; u < updates.length; u++) {
    sh.getRange(updates[u].row, 1, 1, 3).setValues([updates[u].values]);
  }
  if (inserts.length) {
    sh.getRange(sh.getLastRow() + 1, 1, inserts.length, 3).setValues(inserts);
  }
  bumpVersion_('Settings');
  memoClear_('settings:');
  return settingsAll();
}

/** เลขที่ใบเสร็จถัดไป (ต้องเรียกภายใน withLock_ เท่านั้น) */
function nextReceiptNo_() {
  var current = Number(setting('receipt_running', '0')) || 0;
  var next = current + 1;
  settingsSet({ receipt_running: String(next) });
  var prefix = setting('receipt_prefix', 'RC') || 'RC';
  var year = new Date().getFullYear() + 543;
  return prefix + year + '-' + padStart_(String(next), 5, '0');
}
