'use strict';
/** โหลดไฟล์ .gs ทั้งหมดเข้าสู่ sandbox ที่มีบริการของ Apps Script จำลองไว้ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const shim = require('./gas-shim');

const ROOT = path.join(__dirname, '..');

function loadProject(opts = {}) {
  const sandbox = Object.assign({
    console,
    JSON, Math, Date, Number, String, Boolean, Array, Object, RegExp, Error,
    TypeError, RangeError, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, setTimeout, clearTimeout, Map, Set, Promise, Buffer,
  }, shim);
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);

  // ลงทะเบียนไฟล์ HTML เพื่อให้ HtmlService จำลองหาไฟล์เจอ
  for (const f of fs.readdirSync(ROOT)) {
    if (f.endsWith('.html')) {
      shim.HtmlService._register(f.replace(/\.html$/, ''), fs.readFileSync(path.join(ROOT, f), 'utf8'));
    }
  }

  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.gs')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: f });
    } catch (e) {
      throw new Error(`โหลดไฟล์ ${f} ไม่สำเร็จ: ${e.message}\n${e.stack}`);
    }
  }

  // ต่อสะพานให้ HtmlService ประเมินนิพจน์ในเทมเพลตด้วยบริบทของสคริปต์จริง
  shim.HtmlService._evalInScript = function (expr, tpl) {
    ctx.__tpl = tpl;
    try {
      return vm.runInContext(
        '(function(){ var t = __tpl; for (var k in t) { if (Object.prototype.hasOwnProperty.call(t,k) && k.charAt(0) !== "_") { this[k] = t[k]; } } return (' + expr + '); }).call(globalThis)',
        ctx,
        { filename: 'template-expr' }
      );
    } finally {
      delete ctx.__tpl;
    }
  };

  // เตรียมไฟล์ Google Sheets จำลอง
  const ss = shim.newSpreadsheet(opts.ssId || 'TEST_SS_ID', 'ระบบแจ้งชำระเงิน (ทดสอบ)');
  shim.SpreadsheetApp.setActiveSpreadsheet(ss);
  shim.PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  return { ctx, sandbox, ss, files, shim };
}

module.exports = { loadProject, shim, ROOT };
