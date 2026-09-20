'use strict';
/** ทดสอบการเสิร์ฟหน้าเว็บ (doGet) และความถูกต้องของ HTML ที่สร้างขึ้น */
const { loadProject } = require('./loader');
let pass = 0, fail = 0; const failures = [];
function ok(l, c, e = '') { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; failures.push(l); console.log('  ✗ ' + l + ' ' + e); } }

const P = loadProject();
const S = P.sandbox;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const slip = t => Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(String(t))]).toString('base64');

S.setupSilent_({ adminUsername: 'admin', adminPassword: 'Admin1234', adminEmail: 'a@b.com' });
const T = S.login({ username: 'admin', password: 'Admin1234' }).data.token;
const groups = S.apiGroups({ token: T }).data.groups;
S.apiImportMembers({ token: T, rows: [
  ['รหัสสมาชิก','คำนำหน้า','ชื่อ','นามสกุล','กลุ่ม'],
  ['','เด็กชาย','สมชาย','ใจดี', groups[0].name],
  ['','เด็กหญิง','สมหญิง','รักเรียน', groups[0].name],
]});
const col = S.apiSaveCollection({ token: T, name: 'เงินบำรุงการศึกษา', fiscal_year: '2569', term: '1',
  items: [{ name: 'ค่าบำรุงการศึกษา', amount: 1200 }] }).data;
S.apiAssign({ token: T, collection_id: col.id, mode: 'all' });
S.apiSetCollectionStatus({ token: T, id: col.id, status: 'open' });
S.apiSaveBank({ token: T, bank_name: 'ธนาคารกรุงไทย', account_name: 'โรงเรียนทุนวิทยาคม', account_number: '123-4-56789-0', promptpay_id: '0812345678', is_default: true });

console.log('\n=== doGet: หน้าสาธารณะ ===');
let out = S.doGet({ parameter: {} });
let html = out.getContent();
ok('หน้าแรกเสิร์ฟได้', html.length > 1000, String(html.length) + ' ตัวอักษร');
ok('มี <!DOCTYPE html>', html.indexOf('<!DOCTYPE html>') === 0);
ok('แทรก CSS เข้ามาแล้ว', html.indexOf('--brand-600') > 0);
ok('แทรกตัวช่วย JS เข้ามาแล้ว', html.indexOf('function thaiDate') > 0);
ok('แทรกตัวสร้าง QR เข้ามาแล้ว', html.indexOf('var QR = (function') > 0);
ok('ชื่อหน้าเป็นชื่อโรงเรียน', out.getTitle().indexOf('โรงเรียนทุนวิทยาคม') >= 0, out.getTitle());
ok('ไม่มี <?= ?> ที่ยังไม่ถูกแทนค่า', html.indexOf('<?') < 0);

// ตรวจข้อมูลที่ฝังมากับหน้า (ทำให้โหลดเร็ว)
const bootMatch = html.match(/var BOOT = (\{[\s\S]*?\});\n/);
ok('ฝังข้อมูลตั้งต้นมากับหน้า', !!bootMatch);
let boot = null;
try { boot = JSON.parse(bootMatch[1]); } catch (e) { /* ignore */ }
ok('ข้อมูลตั้งต้นเป็น JSON ที่ถูกต้อง', !!boot);
ok('มีการตั้งค่าโรงเรียนในข้อมูลตั้งต้น', boot && boot.config.school_name === 'โรงเรียนทุนวิทยาคม');
ok('มีรายการจัดเก็บมาพร้อมหน้าแรกแล้ว (ไม่ต้องเรียกซ้ำ)', boot && boot.collections && boot.collections.length === 1, JSON.stringify(boot && boot.collections && boot.collections.length));
ok('ไม่มีข้อมูลลับหลุดมากับหน้า', html.indexOf('pin_hash') < 0 && html.indexOf('password_hash') < 0 && html.indexOf('pin_salt') < 0);

console.log('\n=== doGet: หน้ารายการจัดเก็บ (ฝังข้อมูลมาด้วย) ===');
out = S.doGet({ parameter: { page: 'collection', id: String(col.id) } });
html = out.getContent();
const bm2 = html.match(/var BOOT = (\{[\s\S]*?\});\n/);
const boot2 = bm2 ? JSON.parse(bm2[1]) : null;
ok('ฝังตารางรายชื่อมากับหน้าเลย', boot2 && boot2.collection && boot2.collection.members.length === 2, String(boot2 && boot2.collection && boot2.collection.members.length));
ok('สถานะเริ่มต้นเป็น "ยังไม่ชำระ"', boot2 && boot2.collection.members.every(m => m.status === 'unpaid'));
ok('มีบัญชีรับโอนมาด้วย', boot2 && boot2.collection.banks.length === 1);

console.log('\n=== doGet: หน้าผู้ดูแล ===');
out = S.doGet({ parameter: { page: 'admin' } });
html = out.getContent();
ok('หน้าผู้ดูแลเสิร์ฟได้', html.length > 1000);
ok('มีหน้าจอผู้ดูแลครบ', html.indexOf("route('dashboard'") > 0 && html.indexOf("route('settings'") > 0);
ok('มีฟังก์ชันเข้าสู่ระบบ', html.indexOf('function renderLogin') > 0);
ok('ไม่มี <?= ?> ที่ยังไม่ถูกแทนค่า', html.indexOf('<?') < 0);
ok('ชื่อหน้าระบุว่าเป็นผู้ดูแล', out.getTitle().indexOf('ผู้ดูแล') >= 0, out.getTitle());

console.log('\n=== doGet: หน้าตั้งรหัสผ่านใหม่ ===');
out = S.doGet({ parameter: { page: 'reset', token: 'abc123' } });
html = out.getContent();
const bm3 = html.match(/var BOOT = (\{[\s\S]*?\});\n/);
const boot3 = bm3 ? JSON.parse(bm3[1]) : null;
ok('ส่งโทเคนไปกับหน้า', boot3 && boot3.initial.page === 'reset' && boot3.initial.token === 'abc123');

console.log('\n=== เมนูในชีต ===');
S.onOpen();
ok('สร้างเมนูได้โดยไม่ผิดพลาด', true);
S.showSystemStatus();
ok('แสดงสถานะระบบได้', true);
S.clearSystemCache();
ok('ล้างแคชได้', true);
ok('ข้อมูลยังอยู่ครบหลังล้างแคช', S.dbAll('Members').length === 2, String(S.dbAll('Members').length));

console.log('\n=== ความปลอดภัย: ป้องกันข้อมูลรั่ว ===');
const pubCol = S.apiPublicCollection({ id: col.id });
const json = JSON.stringify(pubCol);
ok('API สาธารณะไม่ส่ง pin_hash', json.indexOf('pin_hash') < 0);
ok('API สาธารณะไม่ส่ง pin_salt', json.indexOf('pin_salt') < 0);
ok('API สาธารณะไม่ส่ง pin_plain', json.indexOf('pin_plain') < 0);

const board = pubCol.data.members;
const sub = S.apiSubmitPayment({ assignment_id: board[0].assignment_id, pin: S.dbAll('Members')[0].pin_plain, slip_base64: slip('x'), slip_name: 's.png' });
ok('แจ้งชำระเงินผ่าน API ได้', sub.ok, sub.error || '');
const payJson = JSON.stringify(S.apiPayments({ token: T }));
ok('API ผู้ดูแลไม่ส่ง file id ของ Drive ในรายการ', payJson.indexOf('slip_file_id') < 0);

console.log('\n=== เรียก API โดยไม่มีสิทธิ์ ===');
['apiMembers','apiCollections','apiPayments','apiSettings','apiUsers','apiDashboard','apiReport','apiExportReport','apiAuditLogs','apiGroups']
  .forEach(function (fn) {
    const r = S[fn]({ });
    if (r.ok) { fail++; failures.push(fn + ' เรียกได้โดยไม่ต้องเข้าสู่ระบบ'); console.log('  ✗ ' + fn + ' เรียกได้โดยไม่ต้องเข้าสู่ระบบ'); }
  });
ok('API ผู้ดูแลทุกตัวต้องเข้าสู่ระบบก่อน', true);

console.log('\n══════════════════════════════════════════');
console.log(`  ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
if (failures.length) failures.forEach(f => console.log('   - ' + f));
console.log('══════════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
