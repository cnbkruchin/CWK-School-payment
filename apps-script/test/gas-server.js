'use strict';
/**
 * เซิร์ฟเวอร์จำลอง Apps Script สำหรับทดสอบหน้าเว็บในเบราว์เซอร์จริง
 * - GET  /            -> เรียก doGet() แล้วแทรกตัวจำลอง google.script.run
 * - POST /_gas        -> เรียกฟังก์ชันฝั่งเซิร์ฟเวอร์ตามชื่อ
 * ไม่ใช่ส่วนหนึ่งของระบบที่นำไปใช้งานจริง
 */
const http = require('http');
const { loadProject } = require('./loader');

const P = loadProject();
const S = P.sandbox;

// เตรียมข้อมูลตัวอย่าง
S.setupSilent_({ adminUsername: 'admin', adminPassword: 'Admin1234', adminEmail: 'admin@example.com' });
const demo = S.seedDemoSilent_({ perGroup: 6 });
// ผู้ดูแลตัวอย่างถือว่าเปลี่ยนรหัสผ่านแล้ว เพื่อให้ทดสอบหน้าแดชบอร์ดได้ทันที
S.dbUpdate('Admins', 1, { must_change_pw: false });
console.log('ข้อมูลตัวอย่างพร้อม:', JSON.stringify(demo));

/** สคริปต์ที่แทรกเข้าไปแทน google.script.run ของจริง */
const RUNNER = `
<script>
(function () {
  function makeRunner(handlers) {
    var api = {};
    var FNS = ${JSON.stringify(null)};
    function build(success, failure) {
      return new Proxy({}, {
        get: function (t, name) {
          if (name === 'withSuccessHandler') return function (fn) { return build(fn, failure); };
          if (name === 'withFailureHandler') return function (fn) { return build(success, fn); };
          if (typeof name !== 'string') return undefined;
          return function () {
            var args = Array.prototype.slice.call(arguments);
            fetch('/_gas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fn: name, args: args })
            }).then(function (r) { return r.json(); })
              .then(function (res) {
                if (res.__error) { if (failure) failure(new Error(res.__error)); return; }
                if (success) success(res.value);
              })
              .catch(function (e) { if (failure) failure(e); });
          };
        }
      });
    }
    return build(null, null);
  }
  window.google = { script: { run: makeRunner(), host: { close: function(){}, editor: {} }, url: { getLocation: function(cb){ cb({ parameter: {} }); } } } };
})();
</script>`;

const server = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/_gas') {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      let out;
      try {
        const { fn, args } = JSON.parse(body);
        if (typeof S[fn] !== 'function') throw new Error('ไม่รู้จักฟังก์ชัน: ' + fn);
        out = { value: S[fn].apply(null, args) };
      } catch (e) {
        out = { __error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const parameter = {};
    url.searchParams.forEach(function (v, k) { parameter[k] = v; });
    const out = S.doGet({ parameter: parameter });
    let html = out.getContent();
    html = html.replace('</head>', RUNNER + '</head>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ERROR: ' + e.message + '\n' + e.stack);
  }
});

const PORT = Number(process.env.PORT) || 3222;
server.listen(PORT, '127.0.0.1', function () {
  console.log('GAS emulator: http://127.0.0.1:' + PORT);
  console.log('DEMO=' + JSON.stringify(demo));
});
