'use strict';
/**
 * ตัวจำลองบริการของ Google Apps Script สำหรับทดสอบตรรกะระบบบนเครื่อง (Node.js)
 * ไม่ใช่ส่วนหนึ่งของระบบที่นำไปใช้งานจริง — ใช้เพื่อการทดสอบเท่านั้น
 */
const crypto = require('crypto');

/* ------------------------------ สถิติการเรียกใช้ ------------------------------ */
const stats = {
  sheetReads: 0, sheetWrites: 0, cacheGets: 0, cachePuts: 0,
  propGets: 0, propSets: 0, locks: 0,
  reset() { this.sheetReads = 0; this.sheetWrites = 0; this.cacheGets = 0; this.cachePuts = 0; this.propGets = 0; this.propSets = 0; this.locks = 0; },
  snapshot() { return { sheetReads: this.sheetReads, sheetWrites: this.sheetWrites, cacheGets: this.cacheGets, cachePuts: this.cachePuts, propGets: this.propGets, propSets: this.propSets }; },
};

/* --------------------------------- Range --------------------------------- */
class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows; this.numCols = numCols;
  }
  getValues() {
    stats.sheetReads++;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = this.sheet._data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = rowArr[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    stats.sheetWrites++;
    if (values.length !== this.numRows) throw new Error(`setValues: expected ${this.numRows} rows, got ${values.length}`);
    for (let r = 0; r < values.length; r++) {
      if (values[r].length !== this.numCols) {
        throw new Error(`setValues: row ${r} expected ${this.numCols} cols, got ${values[r].length}`);
      }
      const target = this.row - 1 + r;
      while (this.sheet._data.length <= target) this.sheet._data.push([]);
      const rowArr = this.sheet._data[target];
      for (let c = 0; c < values[r].length; c++) rowArr[this.col - 1 + c] = values[r][c];
      for (let c = 0; c < rowArr.length; c++) if (rowArr[c] === undefined) rowArr[c] = '';
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setNumberFormat() { return this; }
  setWrap() { return this; }
  setBorder() { return this; }
  setFontSize() { return this; }
  setFontFamily() { return this; }
  merge() { return this; }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = this.sheet._data[this.row - 1 + r];
      if (!rowArr) continue;
      for (let c = 0; c < this.numCols; c++) rowArr[this.col - 1 + c] = '';
    }
    return this;
  }
}

/* --------------------------------- Sheet --------------------------------- */
class Sheet {
  constructor(name, parent) { this.name = name; this._data = []; this._parent = parent; this._frozen = 0; this._hidden = false; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() {
    for (let i = this._data.length - 1; i >= 0; i--) {
      const row = this._data[i];
      if (row && row.some((c) => c !== '' && c !== null && c !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this._data) if (row) max = Math.max(max, row.length);
    return max;
  }
  getMaxRows() { return Math.max(1000, this._data.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') throw new Error('A1 notation not supported in shim');
    return new Range(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
  }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(values) {
    stats.sheetWrites++;
    this._data.push(values.slice());
    return this;
  }
  deleteRows(start, num) {
    stats.sheetWrites++;
    this._data.splice(start - 1, num);
    return this;
  }
  deleteRow(r) { return this.deleteRows(r, 1); }
  insertRows() { return this; }
  clear() { this._data = []; return this; }
  setFrozenRows(n) { this._frozen = n; return this; }
  setColumnWidth() { return this; }
  setColumnWidths() { return this; }
  hideSheet() { this._hidden = true; return this; }
  showSheet() { this._hidden = false; return this; }
  isSheetHidden() { return this._hidden; }
  autoResizeColumn() { return this; }
  getFilter() { return null; }
  setTabColor() { return this; }
  protect() { return { setDescription: () => ({ removeEditors: () => ({}), setWarningOnly: () => ({}) }), setWarningOnly: () => ({}) }; }
  getParent() { return this._parent; }
  getSheetId() { return this.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0); }
}

/* ------------------------------ Spreadsheet ------------------------------ */
class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name || 'Test Spreadsheet'; this._sheets = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
  getSheets() { return this._sheets.slice(); }
  getSheetByName(n) { return this._sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n, this); this._sheets.push(s); return s; }
  deleteSheet(s) { this._sheets = this._sheets.filter((x) => x !== s); return this; }
  setActiveSheet(s) { this._active = s; return s; }
  getActiveSheet() { return this._active || this._sheets[0]; }
  moveActiveSheet() { return this; }
  getSpreadsheetTimeZone() { return 'Asia/Bangkok'; }
  toast() { return this; }
  addMenu() { return this; }
}

const _spreadsheets = new Map();
function newSpreadsheet(id = 'TEST_SS_ID', name, withDefaultSheet = false) {
  const ss = new Spreadsheet(id, name);
  // Google Sheets จริงจะสร้างชีตเริ่มต้น "Sheet1" มาให้เสมอเมื่อสร้างไฟล์ใหม่
  if (withDefaultSheet) ss.insertSheet('Sheet1');
  _spreadsheets.set(id, ss);
  return ss;
}

/* --------------------------------- Drive --------------------------------- */
class DriveFile {
  constructor(id, name, mime, bytes, parent) {
    this.id = id; this.name = name; this.mime = mime; this.bytes = bytes; this.parent = parent;
    this.trashed = false; this.sharing = 'PRIVATE';
  }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMimeType() { return this.mime; }
  getSize() { return this.bytes.length; }
  getBlob() { return Utilities.newBlob(this.bytes, this.mime, this.name); }
  getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
  setTrashed(v) { this.trashed = v; return this; }
  setSharing() { return this; }
  getThumbnail() { return Utilities.newBlob(this.bytes.slice(0, 64), this.mime, 'thumb'); }
  moveTo() { return this; }
  getParents() { return { hasNext: () => false, next: () => null }; }
}
class DriveFolder {
  constructor(id, name) { this.id = id; this.name = name; this._files = []; this._folders = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  createFile(blob) {
    const f = new DriveFile('FILE_' + (_driveSeq++), blob.getName(), blob.getContentType(), blob.getBytes(), this);
    this._files.push(f);
    _driveFiles.set(f.id, f);
    return f;
  }
  createFolder(name) {
    const f = new DriveFolder('FOLDER_' + (_driveSeq++), name);
    this._folders.push(f);
    _driveFolders.set(f.id, f);
    return f;
  }
  getFoldersByName(name) {
    const matches = this._folders.filter((f) => f.name === name);
    let i = 0;
    return { hasNext: () => i < matches.length, next: () => matches[i++] };
  }
  getFilesByName(name) {
    const matches = this._files.filter((f) => f.name === name && !f.trashed);
    let i = 0;
    return { hasNext: () => i < matches.length, next: () => matches[i++] };
  }
  setSharing() { return this; }
}
let _driveSeq = 1;
const _driveFiles = new Map();
const _driveFolders = new Map();
const _driveRoot = new DriveFolder('ROOT', 'My Drive');
_driveFolders.set('ROOT', _driveRoot);

const DriveApp = {
  getRootFolder: () => _driveRoot,
  createFolder: (n) => _driveRoot.createFolder(n),
  getFoldersByName: (n) => _driveRoot.getFoldersByName(n),
  getFolderById: (id) => { const f = _driveFolders.get(id); if (!f) throw new Error('Folder not found: ' + id); return f; },
  getFileById: (id) => { const f = _driveFiles.get(id); if (!f) throw new Error('File not found: ' + id); return f; },
  Access: { PRIVATE: 'PRIVATE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { VIEW: 'VIEW', NONE: 'NONE' },
};

/* ------------------------------- Utilities ------------------------------- */
class Blob {
  constructor(data, contentType, name) {
    this._bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : Buffer.from(data));
    this._type = contentType || 'application/octet-stream';
    this._name = name || 'blob';
  }
  getBytes() { return Array.from(this._bytes); }
  getDataAsString(cs) { return this._bytes.toString(cs === 'UTF-8' || !cs ? 'utf8' : cs); }
  getContentType() { return this._type; }
  setContentType(t) { this._type = t; return this; }
  getName() { return this._name; }
  setName(n) { this._name = n; return this; }
  copyBlob() { return new Blob(Buffer.from(this._bytes), this._type, this._name); }
  getAs(t) { return new Blob(this._bytes, t, this._name); }
  _buffer() { return this._bytes; }
}

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA-256', MD5: 'MD5', SHA_1: 'SHA-1' },
  Charset: { UTF_8: 'UTF-8', US_ASCII: 'US-ASCII' },
  MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
  getUuid: () => crypto.randomUUID(),
  computeDigest(alg, value /*, charset */) {
    const h = crypto.createHash(alg === 'SHA-256' ? 'sha256' : alg === 'MD5' ? 'md5' : 'sha1');
    if (typeof value === 'string') h.update(value, 'utf8');
    else h.update(Buffer.from(value.map((b) => (b < 0 ? b + 256 : b))));
    return Array.from(h.digest()).map((b) => (b > 127 ? b - 256 : b));
  },
  computeHmacSha256Signature(value, key) {
    const keyBuf = typeof key === 'string' ? Buffer.from(key, 'utf8') : Buffer.from(key.map((b) => (b < 0 ? b + 256 : b)));
    const valBuf = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map((b) => (b < 0 ? b + 256 : b)));
    const sig = crypto.createHmac('sha256', keyBuf).update(valBuf).digest();
    return Array.from(sig).map((b) => (b > 127 ? b - 256 : b));
  },
  base64Encode(v) {
    const buf = typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => (b < 0 ? b + 256 : b)));
    return buf.toString('base64');
  },
  base64Decode(s) { return Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)); },
  newBlob(data, contentType, name) {
    if (Array.isArray(data)) return new Blob(Buffer.from(data.map((b) => (b < 0 ? b + 256 : b))), contentType, name);
    return new Blob(data, contentType, name);
  },
  formatDate(date, tz, fmt) {
    // จำลองเฉพาะรูปแบบที่ระบบใช้งานจริง (โซนเวลาไทย = UTC+7)
    const d = new Date(date.getTime() + 7 * 3600 * 1000);
    const map = {
      yyyy: d.getUTCFullYear(),
      MM: String(d.getUTCMonth() + 1).padStart(2, '0'),
      M: d.getUTCMonth() + 1,
      dd: String(d.getUTCDate()).padStart(2, '0'),
      d: d.getUTCDate(),
      HH: String(d.getUTCHours()).padStart(2, '0'),
      mm: String(d.getUTCMinutes()).padStart(2, '0'),
      ss: String(d.getUTCSeconds()).padStart(2, '0'),
    };
    return fmt.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, (m) => String(map[m]));
  },
  sleep(ms) { const end = Date.now() + ms; while (Date.now() < end) { /* busy wait */ } },
  parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  },
  zip(blobs, name) { return new Blob(Buffer.from('zip'), 'application/zip', name || 'archive.zip'); },
};

/* ------------------------------ Properties ------------------------------- */
function makeProps() {
  const store = new Map();
  return {
    _store: store,
    getProperty(k) { stats.propGets++; return store.has(k) ? store.get(k) : null; },
    setProperty(k, v) { stats.propSets++; store.set(k, String(v)); return this; },
    setProperties(obj) { stats.propSets++; Object.entries(obj).forEach(([k, v]) => store.set(k, String(v))); return this; },
    getProperties() { stats.propGets++; return Object.fromEntries(store); },
    deleteProperty(k) { store.delete(k); return this; },
    deleteAllProperties() { store.clear(); return this; },
    getKeys() { return Array.from(store.keys()); },
  };
}
const _scriptProps = makeProps();
const _userProps = makeProps();
const PropertiesService = {
  getScriptProperties: () => _scriptProps,
  getUserProperties: () => _userProps,
  getDocumentProperties: () => _scriptProps,
};

/* --------------------------------- Cache --------------------------------- */
function makeCache() {
  const store = new Map();
  return {
    _store: store,
    get(k) {
      stats.cacheGets++;
      const e = store.get(k);
      if (!e) return null;
      if (e.exp < Date.now()) { store.delete(k); return null; }
      return e.v;
    },
    getAll(keys) {
      stats.cacheGets++;
      const out = {};
      for (const k of keys) {
        const e = store.get(k);
        if (e && e.exp >= Date.now()) out[k] = e.v;
      }
      return out;
    },
    put(k, v, ttl) {
      stats.cachePuts++;
      if (String(v).length > 100 * 1024) throw new Error('CacheService: value too large (>100KB)');
      store.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 });
    },
    putAll(obj, ttl) {
      stats.cachePuts++;
      Object.entries(obj).forEach(([k, v]) => {
        if (String(v).length > 100 * 1024) throw new Error('CacheService: value too large (>100KB)');
        store.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 });
      });
    },
    remove(k) { store.delete(k); },
    removeAll(keys) { keys.forEach((k) => store.delete(k)); },
    _clear() { store.clear(); },
  };
}
const _scriptCache = makeCache();
const CacheService = {
  getScriptCache: () => _scriptCache,
  getUserCache: () => _scriptCache,
  getDocumentCache: () => _scriptCache,
};

/* ---------------------------------- Lock --------------------------------- */
let _lockHeld = false;
const LockService = {
  getScriptLock: () => ({
    waitLock(ms) {
      stats.locks++;
      if (_lockHeld) throw new Error('Could not obtain lock');
      _lockHeld = true;
    },
    tryLock() { if (_lockHeld) return false; _lockHeld = true; return true; },
    releaseLock() { _lockHeld = false; },
    hasLock() { return _lockHeld; },
  }),
  getUserLock() { return this.getScriptLock(); },
  getDocumentLock() { return this.getScriptLock(); },
};

/* -------------------------------- Others -------------------------------- */
const Logger = { log: (...a) => { if (process.env.GAS_LOG) console.log('[Logger]', ...a); } };

const Session = {
  getActiveUser: () => ({ getEmail: () => process.env.TEST_USER_EMAIL || '' }),
  getEffectiveUser: () => ({ getEmail: () => process.env.TEST_USER_EMAIL || 'owner@example.com' }),
  getScriptTimeZone: () => 'Asia/Bangkok',
  getTemporaryActiveUserKey: () => 'tmpkey',
};

const _sentMail = [];
const MailApp = {
  sendEmail(opts) { _sentMail.push(opts); },
  getRemainingDailyQuota: () => 100,
};
const GmailApp = { sendEmail: (to, subject, body) => _sentMail.push({ to, subject, body }) };

class HtmlOutput {
  constructor(content) { this._c = content; this._title = ''; this._meta = []; }
  getContent() { return this._c; }
  setContent(c) { this._c = c; return this; }
  setTitle(t) { this._title = t; return this; }
  getTitle() { return this._title; }
  addMetaTag(n, c) { this._meta.push([n, c]); return this; }
  setXFrameOptionsMode() { return this; }
  setFaviconUrl() { return this; }
  setSandboxMode() { return this; }
  append(s) { this._c += s; return this; }
}
class HtmlTemplate {
  constructor(content) { this._raw = content; }
  getRawContent() { return this._raw; }
  evaluate() {
    // ประเมิน <?= x ?> และ <?!= x ?> โดยใช้บริบทจริงของสคริปต์
    // (จำเป็นเพื่อให้ include() ซึ่งเป็นฟังก์ชันระดับบนสุดทำงานได้เหมือน Apps Script จริง)
    const self = this;
    const out = this._raw.replace(/<\?!?=\s*([\s\S]*?)\s*\?>/g, (m, expr) => {
      try {
        if (HtmlService._evalInScript) return String(HtmlService._evalInScript(expr, self));
        return '';
      } catch (e) {
        throw new Error('ประเมินเทมเพลตล้มเหลว: ' + expr + ' -> ' + e.message);
      }
    });
    return new HtmlOutput(out);
  }
}
const _htmlFiles = new Map();
const HtmlService = {
  _register(name, content) { _htmlFiles.set(name, content); },
  _evalInScript: null,
  createHtmlOutput: (c) => new HtmlOutput(typeof c === 'string' ? c : String(c)),
  createTemplateFromFile(name) {
    const c = _htmlFiles.get(name);
    if (c === undefined) throw new Error('HTML file not found: ' + name);
    return new HtmlTemplate(c);
  },
  createHtmlOutputFromFile(name) {
    const c = _htmlFiles.get(name);
    if (c === undefined) throw new Error('HTML file not found: ' + name);
    return new HtmlOutput(c);
  },
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
  SandboxMode: { IFRAME: 'IFRAME' },
};

const ScriptApp = {
  getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
  newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => ({}) }) }) }),
  getProjectTriggers: () => [],
  deleteTrigger: () => {},
};

const ContentService = {
  createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return t; } }),
  MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
};

const SpreadsheetApp = {
  _active: null,
  openById(id) {
    const ss = _spreadsheets.get(id);
    if (!ss) throw new Error('Spreadsheet not found: ' + id);
    return ss;
  },
  getActiveSpreadsheet() { return SpreadsheetApp._active; },
  setActiveSpreadsheet(ss) { SpreadsheetApp._active = ss; return ss; },
  create(name) { return newSpreadsheet('SS_' + (_driveSeq++), name, true); },
  flush() {},
  getUi() {
    return {
      createMenu: () => ({ addItem: function () { return this; }, addSeparator: function () { return this; }, addSubMenu: function () { return this; }, addToUi: () => {} }),
      alert: () => 'OK',
      prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' }),
      showModalDialog: () => {},
      showSidebar: () => {},
      ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
      Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    };
  },
  BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' },
  WrapStrategy: { WRAP: 'WRAP', CLIP: 'CLIP' },
  DataValidation: {},
  newDataValidation: () => ({
    requireValueInList: function () { return this; },
    setAllowInvalid: function () { return this; },
    setHelpText: function () { return this; },
    build: () => ({}),
  }),
};

const MimeType = {
  GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
  MICROSOFT_EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
  PDF: 'application/pdf',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  PLAIN_TEXT: 'text/plain',
};

const UrlFetchApp = {
  fetch: () => ({ getContentText: () => '', getBlob: () => new Blob(Buffer.from(''), 'text/plain', 'x'), getResponseCode: () => 200 }),
};

module.exports = {
  SpreadsheetApp, Spreadsheet, Sheet, Range, newSpreadsheet,
  DriveApp, Utilities, PropertiesService, CacheService, LockService,
  Logger, Session, MailApp, GmailApp, HtmlService, ScriptApp,
  ContentService, MimeType, UrlFetchApp, Blob,
  stats, _sentMail, _driveFiles, _scriptCache, _scriptProps,
};
