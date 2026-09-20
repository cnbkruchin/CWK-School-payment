/**
 * ===========================================================================
 *  ชั้นแคช — ทำให้ระบบเร็วขึ้นมาก โดยลดจำนวนครั้งที่ต้องอ่าน Google Sheets
 *
 *  หลักการ:
 *   1. ข้อมูลแต่ละตารางถูกแคชไว้ใน CacheService (อยู่ได้สูงสุด 6 ชั่วโมง)
 *   2. คีย์แคชมี "เลขเวอร์ชัน" ของตารางนั้นผสมอยู่
 *   3. เมื่อมีการเขียนข้อมูล ระบบจะเพิ่มเลขเวอร์ชัน → คีย์เดิมถูกทิ้งไปเอง
 *      จึงไม่มีทางอ่านข้อมูลเก่าค้างได้ (ไม่ต้องไล่ลบแคชทีละคีย์)
 *   4. ข้อมูลที่ใหญ่กว่า 100KB จะถูกหั่นเป็นชิ้น ๆ เพราะ CacheService จำกัดขนาด
 * ===========================================================================
 */

/** แคชระดับการทำงานหนึ่งครั้ง (เร็วที่สุด ไม่ต้องเรียก service ใด ๆ) */
var __memo = {};

function memoGet_(key, producer) {
  if (Object.prototype.hasOwnProperty.call(__memo, key)) return __memo[key];
  var v = producer();
  __memo[key] = v;
  return v;
}

function memoClear_(prefix) {
  if (!prefix) { __memo = {}; return; }
  Object.keys(__memo).forEach(function (k) {
    if (k.indexOf(prefix) === 0) delete __memo[k];
  });
}

/* ------------------------------ เวอร์ชันข้อมูล ------------------------------ */

/** อ่านเลขเวอร์ชันของทุกตารางในครั้งเดียว (เรียก PropertiesService เพียงครั้งเดียวต่อการทำงาน) */
function versions_() {
  return memoGet_('__versions', function () {
    var raw = PropertiesService.getScriptProperties().getProperty(PROP.DATA_VERSION);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) { return {}; }
  });
}

function versionOf_(table) {
  var v = versions_();
  return v[table] || 1;
}

/** เพิ่มเลขเวอร์ชันของตาราง → แคชเดิมหมดอายุทันที */
function bumpVersion_(tables) {
  var list = [].concat(tables);
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(PROP.DATA_VERSION);
  var v = {};
  if (raw) { try { v = JSON.parse(raw); } catch (e) { v = {}; } }
  list.forEach(function (t) { v[t] = (v[t] || 1) + 1; });
  props.setProperty(PROP.DATA_VERSION, JSON.stringify(v));
  __memo['__versions'] = v;
  list.forEach(function (t) { memoClear_('tbl:' + t); });
}

/* ------------------------------ แคชแบบหั่นชิ้น ------------------------------ */

function cacheService_() {
  return memoGet_('__cache', function () { return CacheService.getScriptCache(); });
}

/**
 * เก็บข้อความลงแคช โดยหั่นเป็นชิ้นหากยาวเกินขีดจำกัดของ CacheService
 * รูปแบบคีย์:  <key>        → จำนวนชิ้น (เช่น "c:3") หรือข้อมูลทั้งก้อน
 *              <key>#0..n   → ข้อมูลแต่ละชิ้น
 */
function cachePut_(key, text) {
  try {
    var cache = cacheService_();
    var size = APP.CACHE_CHUNK_BYTES;
    if (text.length <= size) {
      cache.put(key, text, APP.CACHE_TTL_SEC);
      return true;
    }
    var chunks = Math.ceil(text.length / size);
    if (chunks > 60) return false;  // ใหญ่เกินไป ไม่คุ้มที่จะแคช

    var map = {};
    for (var i = 0; i < chunks; i++) {
      map[key + '#' + i] = text.substring(i * size, (i + 1) * size);
    }
    cache.putAll(map, APP.CACHE_TTL_SEC);
    cache.put(key, 'c:' + chunks, APP.CACHE_TTL_SEC);
    return true;
  } catch (e) {
    return false;   // แคชล้มเหลวไม่ใช่เรื่องร้ายแรง — อ่านจากชีตแทนได้
  }
}

function cacheGet_(key) {
  try {
    var cache = cacheService_();
    var head = cache.get(key);
    if (head === null || head === undefined) return null;
    if (head.indexOf('c:') !== 0) return head;

    var chunks = parseInt(head.substring(2), 10);
    var keys = [];
    for (var i = 0; i < chunks; i++) keys.push(key + '#' + i);
    var parts = cache.getAll(keys);
    var out = '';
    for (var j = 0; j < chunks; j++) {
      var piece = parts[key + '#' + j];
      if (piece === null || piece === undefined) return null;  // ชิ้นหาย = แคชใช้ไม่ได้
      out += piece;
    }
    return out;
  } catch (e) {
    return null;
  }
}
