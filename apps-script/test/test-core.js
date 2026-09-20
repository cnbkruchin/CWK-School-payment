'use strict';
/** ทดสอบตรรกะหลักของระบบ (ฐานข้อมูล, สิทธิ์, การชำระเงิน) */
const { loadProject, shim } = require('./loader');

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label + ' ' + extra); console.log('  ✗ ' + label + ' ' + extra); }
}
function unwrap(r, label) {
  if (!r.ok) { fail++; failures.push(label); console.log('  ✗ ' + label + ' -> ' + r.error); return null; }
  return r.data;
}

const P = loadProject();
const S = P.sandbox;

// รูปภาพ PNG 1x1 จริง สำหรับใช้เป็นสลิปทดสอบ
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function slip(tag) {
  const buf = Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.from(String(tag))]);
  return buf.toString('base64');
}

console.log('\n=== 1. ติดตั้งระบบ ===');
const inst = S.setupSilent_({ adminUsername: 'admin', adminPassword: 'Admin1234', adminEmail: 'admin@example.com' });
ok('ติดตั้งสำเร็จ สร้าง 13 ชีต', inst.sheetsCreated === 13, String(inst.sheetsCreated));
ok('สร้างบัญชีผู้ดูแลคนแรก', inst.adminCreated === true);
ok('มีกลุ่มตั้งต้น 7 กลุ่ม', S.dbAll('Groups').length === 7, String(S.dbAll('Groups').length));
ok('รันซ้ำได้โดยไม่เสียหาย', (() => { const r2 = S.setupSilent_({}); return r2.sheetsCreated === 0 && r2.adminCount === 1; })());

console.log('\n=== 2. เข้าสู่ระบบ ===');
let r = S.login({ username: 'admin', password: 'wrong' });
ok('รหัสผ่านผิดถูกปฏิเสธ', !r.ok && /ไม่ถูกต้อง/.test(r.error), r.error);
r = S.login({ username: 'admin', password: 'Admin1234' });
const auth = unwrap(r, 'เข้าสู่ระบบ');
ok('เข้าสู่ระบบสำเร็จ', !!auth && !!auth.token);
ok('บทบาทเป็นผู้ดูแลสูงสุด', auth && auth.admin.role === 'superadmin');
const TOKEN = auth.token;
ok('ตรวจสอบโทเคนได้', S.me({ token: TOKEN }).ok);
ok('โทเคนปลอมใช้ไม่ได้', !S.me({ token: 'fake-token' }).ok);
ok('ไม่ส่งรหัสผ่านกลับไปหน้าเว็บ', auth && auth.admin.password_hash === undefined);

console.log('\n=== 3. กลุ่มและสมาชิก ===');
const groups = unwrap(S.apiGroups({ token: TOKEN }), 'ดึงกลุ่ม');
ok('ดึงรายชื่อกลุ่มได้', groups && groups.groups.length === 7);
const gA = groups.groups[0], gB = groups.groups[1];

r = S.apiSaveGroup({ token: TOKEN, name: 'กลุ่มทดสอบ' });
const newGroup = unwrap(r, 'เพิ่มกลุ่ม');
ok('เพิ่มกลุ่มได้', !!newGroup);
ok('กันชื่อกลุ่มซ้ำ', !S.apiSaveGroup({ token: TOKEN, name: 'กลุ่มทดสอบ' }).ok);
ok('ลบกลุ่มได้', S.apiDeleteGroup({ token: TOKEN, id: newGroup.id }).ok);

const m1 = unwrap(S.apiSaveMember({ token: TOKEN, prefix: 'เด็กชาย', first_name: 'สมชาย', last_name: 'ใจดี', group_id: gA.id, phone: '0812345678' }), 'เพิ่มสมาชิก');
ok('เพิ่มสมาชิกได้', !!m1 && !!m1.member_code);
ok('สร้างรหัส PIN 6 หลักอัตโนมัติ', m1 && /^\d{6}$/.test(m1.pin), m1 && m1.pin);

// นำเข้าหลายคน
const importRows = [
  ['รหัสสมาชิก', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'กลุ่ม', 'เบอร์โทร'],
  ['', 'เด็กหญิง', 'สมหญิง', 'รักเรียน', gA.name, '0898888888'],
  ['', 'เด็กชาย', 'อนุชา', 'ตั้งใจ', gB.name, ''],
  ['X999', 'นางสาว', 'มานี', 'มีนา', 'กลุ่มนำเข้าใหม่', ''],
];
const dry = unwrap(S.apiImportMembers({ token: TOKEN, rows: importRows, dry_run: true }), 'ทดลองนำเข้า');
ok('ทดลองนำเข้า (dry-run) ได้ 3 คน', dry && dry.created === 3, JSON.stringify(dry && {c:dry.created,s:dry.skipped}));
ok('dry-run ไม่บันทึกข้อมูลจริง', S.dbAll('Members').length === 1, String(S.dbAll('Members').length));

const imp = unwrap(S.apiImportMembers({ token: TOKEN, rows: importRows }), 'นำเข้าจริง');
ok('นำเข้าจริงสำเร็จ 3 คน', imp && imp.created === 3);
ok('ได้รับ PIN ของทุกคน', imp && imp.credentials.length === 3);
ok('สร้างกลุ่มใหม่อัตโนมัติจากไฟล์', !!S.dbFind('Groups', g => g.name === 'กลุ่มนำเข้าใหม่'));
ok('รวมสมาชิก 4 คน', S.dbAll('Members').length === 4, String(S.dbAll('Members').length));

const imp2 = unwrap(S.apiImportMembers({ token: TOKEN, rows: importRows }), 'นำเข้าซ้ำ');
ok('นำเข้าซ้ำถูกข้ามทั้งหมด', imp2 && imp2.created === 0 && imp2.skipped === 3, JSON.stringify(imp2 && {c:imp2.created,s:imp2.skipped}));

// แยกชื่อ-สกุลรวม
const imp3 = unwrap(S.apiImportMembers({ token: TOKEN, rows: [['ชื่อ-สกุล','ชั้น'],['นายวิชัย เก่งกาจ', gB.name]] }), 'นำเข้าชื่อรวม');
ok('แยกชื่อ-สกุลอัตโนมัติ', imp3 && imp3.created === 1);
const vichai = S.dbFind('Members', m => m.first_name === 'วิชัย');
ok('แยกคำนำหน้าถูกต้อง', vichai && vichai.prefix === 'นาย' && vichai.last_name === 'เก่งกาจ', vichai && JSON.stringify([vichai.prefix,vichai.first_name,vichai.last_name]));

console.log('\n=== 4. รีเซ็ตรหัส PIN ===');
const reset1 = unwrap(S.apiResetPin({ token: TOKEN, ids: [m1.id] }), 'รีเซ็ต PIN');
ok('รีเซ็ต PIN รายคนได้', reset1 && reset1.members[0].pin !== m1.pin);
const pin1 = reset1.members[0].pin;
const resetG = unwrap(S.apiResetPin({ token: TOKEN, group_id: gA.id }), 'รีเซ็ตทั้งกลุ่ม');
ok('รีเซ็ต PIN ทั้งกลุ่มได้', resetG && resetG.count >= 2, String(resetG && resetG.count));
const pinA = resetG.members.find(x => x.id === m1.id).pin;

console.log('\n=== 5. รายการจัดเก็บ ===');
const col = unwrap(S.apiSaveCollection({
  token: TOKEN, name: 'เงินบำรุงการศึกษา ภาคเรียนที่ 1', fiscal_year: '2569', term: '1',
  due_date: '2026-10-31', description: 'ค่าบำรุงการศึกษาและกิจกรรม',
  items: [
    { name: 'ค่าบำรุงการศึกษา', amount: 1200 },
    { name: 'ค่าประกันอุบัติเหตุ', amount: 300 },
    { name: 'ค่าเรียนเสริมพิเศษ', amount: 500, is_optional: true },
  ],
}), 'สร้างรายการจัดเก็บ');
ok('สร้างรายการจัดเก็บได้', !!col && !!col.code);
const detail = unwrap(S.apiCollection({ token: TOKEN, id: col.id }), 'ดึงรายละเอียด');
ok('มีกิจกรรมย่อย 3 รายการ', detail && detail.items.length === 3);
ok('ยอดฐาน 1500 (ไม่รวมรายการเลือกได้)', detail && detail.collection.base_amount === 1500, String(detail && detail.collection.base_amount));

const addItem = unwrap(S.apiSaveCollectionItem({ token: TOKEN, collection_id: col.id, name: 'ค่าคู่มือนักเรียน', amount: 150 }), 'เพิ่มกิจกรรมย่อย');
ok('เพิ่มกิจกรรมย่อยได้ไม่จำกัด', addItem && addItem.base_amount === 1650, String(addItem && addItem.base_amount));

console.log('\n=== 6. กำหนดผู้ที่ต้องชำระ ===');
ok('เปิดรับชำระไม่ได้ถ้ายังไม่มีผู้ต้องชำระ', !S.apiSetCollectionStatus({ token: TOKEN, id: col.id, status: 'open' }).ok);

const asg = unwrap(S.apiAssign({ token: TOKEN, collection_id: col.id, mode: 'group', group_ids: [gA.id] }), 'กำหนดรายกลุ่ม');
ok('กำหนดรายกลุ่มได้', asg && asg.created >= 2, JSON.stringify(asg));
ok('ยอดต่อคน 1650 บาท', asg && asg.amount === 1650);

const others = S.dbWhere('Members', m => Number(m.group_id) === gB.id);
const asg2 = unwrap(S.apiAssign({ token: TOKEN, collection_id: col.id, mode: 'members', member_ids: others.map(m => m.id), amount: 900 }), 'กำหนดรายบุคคล');
ok('กำหนดรายบุคคลพร้อมยอดเฉพาะได้', asg2 && asg2.amount === 900);
ok('เปิดรับชำระได้แล้ว', S.apiSetCollectionStatus({ token: TOKEN, id: col.id, status: 'open' }).ok);

console.log('\n=== 7. หน้าสาธารณะ ===');
const pub = unwrap(S.apiPublicCollections(), 'รายการสาธารณะ');
ok('เห็นรายการที่เปิดรับชำระ', pub && pub.collections.some(c => c.id === col.id));
const board = unwrap(S.apiPublicCollection({ id: col.id }), 'ตารางรายชื่อ');
ok('เห็นตารางรายชื่อ', board && board.members.length >= 3, String(board && board.members.length));
ok('ทุกคนเริ่มต้นเป็น "ยังไม่ชำระ"', board.members.every(m => m.status === 'unpaid'));
ok('ไม่เปิดเผย PIN บนหน้าสาธารณะ', !JSON.stringify(board).includes('pin_hash') && !JSON.stringify(board).includes('pin_salt') && !JSON.stringify(board).includes('pin_plain'));
const target = board.members.find(m => m.member_code === m1.member_code);
ok('พบสมาชิกเป้าหมาย', !!target);

console.log('\n=== 8. แจ้งชำระเงิน ===');
r = S.apiSubmitPayment({ assignment_id: target.assignment_id, pin: '000000', slip_base64: slip('A'), slip_name: 'slip.png' });
ok('PIN ผิดถูกปฏิเสธ', !r.ok && /รหัสสมาชิกไม่ถูกต้อง/.test(r.error), r.error);

const sub = unwrap(S.apiSubmitPayment({ assignment_id: target.assignment_id, pin: pinA, slip_base64: slip('A'), slip_name: 'slip.png', payer_name: 'นายสมบัติ ใจดี', transferred_at: '2026-09-19T09:30' }), 'แจ้งชำระ');
ok('แจ้งชำระเงินสำเร็จ', !!sub);
ok('ได้เลขอ้างอิง 4 หลัก', sub && /^\d{4}$/.test(sub.ref_code), sub && sub.ref_code);
ok('สถานะเป็น "รอตรวจสอบ"', sub && sub.status_label === 'รอตรวจสอบ');
const REF = sub.ref_code;

r = S.apiSubmitPayment({ assignment_id: target.assignment_id, pin: pinA, slip_base64: slip('B'), slip_name: 'x.png' });
ok('กันการแจ้งซ้ำขณะรอตรวจสอบ', !r.ok && /รอการตรวจสอบ/.test(r.error), r.error);

console.log('\n=== 9. ตรวจสอบด้วยเลขอ้างอิง ===');
const look = unwrap(S.apiLookupPayment({ ref: REF }), 'ค้นเลขอ้างอิง');
ok('ค้นหาด้วยเลขอ้างอิงได้', look && look.ref_code === REF);
ok('สถานะ "รอตรวจสอบ"', look && look.status === 'pending');
const slipData = unwrap(S.apiLookupSlip({ ref: REF }), 'ดูสลิป');
ok('ดูสลิปด้วยเลขอ้างอิงได้', slipData && slipData.data_url.indexOf('data:image/png;base64,') === 0);
ok('เลขอ้างอิงที่ไม่มีอยู่ถูกปฏิเสธ', !S.apiLookupPayment({ ref: '0000' }).ok);

const board2 = unwrap(S.apiPublicCollection({ id: col.id }), 'ตาราง');
const t2 = board2.members.find(m => m.member_code === m1.member_code);
ok('สถานะในตารางเป็น "รอตรวจสอบ" (เหลือง)', t2.status === 'pending' && t2.status_label === 'รอตรวจสอบ');

console.log('\n=== 10. ตรวจสอบและอนุมัติ ===');
const pend = unwrap(S.apiPayments({ token: TOKEN, status: 'pending' }), 'รายการรอตรวจสอบ');
ok('แอดมินเห็นรายการรอตรวจสอบ', pend && pend.payments.length === 1);
const payId = pend.payments[0].id;
ok('ไม่ส่ง file id ของ Drive ออกไปโดยไม่จำเป็น', pend.payments[0].slip_file_id === undefined);

const pdetail = unwrap(S.apiPayment({ token: TOKEN, id: payId }), 'รายละเอียดการชำระ');
ok('ดูรายละเอียดได้', pdetail && pdetail.payment.ref_code === REF);
ok('แอดมินดูสลิปได้', S.apiPaymentSlip({ token: TOKEN, id: payId }).ok);

const appr = unwrap(S.apiApprovePayment({ token: TOKEN, id: payId }), 'อนุมัติ');
ok('อนุมัติได้', !!appr);
ok('สถานะเป็น "ชำระแล้ว" (เขียว)', appr && appr.assignment_status_label === 'ชำระแล้ว', appr && appr.assignment_status_label);
ok('ออกเลขที่ใบเสร็จอัตโนมัติ', appr && /^RC\d{4}-\d{5}$/.test(appr.receipt_no), appr && appr.receipt_no);
ok('ออกใบเสร็จได้', S.apiReceipt({ token: TOKEN, id: payId }).ok);

const board3 = unwrap(S.apiPublicCollection({ id: col.id }), 'ตาราง');
const t3 = board3.members.find(m => m.member_code === m1.member_code);
ok('หน้าสาธารณะแสดง "ชำระแล้ว"', t3.status === 'paid');
ok('ค้นเลขอ้างอิงแสดง "ชำระแล้ว"', S.apiLookupPayment({ ref: REF }).data.status === 'approved');

console.log('\n=== 11. ไม่อนุมัติ และแจ้งใหม่ ===');
const other = board3.members.find(m => m.status === 'unpaid');
const otherMember = S.dbFind('Members', m => m.member_code === other.member_code);
const otherPin = S.apiResetPin({ token: TOKEN, ids: [otherMember.id] }).data.members[0].pin;

const sub2 = unwrap(S.apiSubmitPayment({ assignment_id: other.assignment_id, pin: otherPin, slip_base64: slip('C'), slip_name: 'c.png' }), 'แจ้งคนที่ 2');
ok('สมาชิกคนที่สองแจ้งชำระได้', !!sub2);
ok('เลขอ้างอิงไม่ซ้ำกัน', sub2.ref_code !== REF);

const pend2 = S.apiPayments({ token: TOKEN, status: 'pending' }).data.payments[0];
ok('ต้องระบุเหตุผลเมื่อไม่อนุมัติ', !S.apiRejectPayment({ token: TOKEN, id: pend2.id }).ok);
const rej = unwrap(S.apiRejectPayment({ token: TOKEN, id: pend2.id, reason: 'สลิปไม่ชัดเจน กรุณาแนบใหม่' }), 'ไม่อนุมัติ');
ok('ไม่อนุมัติพร้อมเหตุผลได้', rej && rej.assignment_status === 'rejected');

const board4 = S.apiPublicCollection({ id: col.id }).data;
const t4 = board4.members.find(m => m.member_code === other.member_code);
ok('สถานะกลับเป็นแดงพร้อมเหตุผล', t4.status === 'rejected' && /ไม่ชัดเจน/.test(t4.last_reject_reason));
ok('แจ้งชำระใหม่ได้หลังถูกปฏิเสธ', S.apiSubmitPayment({ assignment_id: other.assignment_id, pin: otherPin, slip_base64: slip('D'), slip_name: 'd.png' }).ok);

// สลิปซ้ำ
const third = S.apiPublicCollection({ id: col.id }).data.members.find(m => m.status === 'unpaid');
if (third) {
  const tm = S.dbFind('Members', m => m.member_code === third.member_code);
  const tp = S.apiResetPin({ token: TOKEN, ids: [tm.id] }).data.members[0].pin;
  r = S.apiSubmitPayment({ assignment_id: third.assignment_id, pin: tp, slip_base64: slip('D'), slip_name: 'dup.png' });
  ok('ตรวจจับสลิปซ้ำได้', !r.ok && /เคยถูกใช้/.test(r.error), r.error);
}

console.log('\n=== 12. ประวัติรายบุคคล ===');
const hist = unwrap(S.apiMemberHistory({ member_code: m1.member_code, pin: pinA }), 'ประวัติสมาชิก');
ok('สมาชิกดูประวัติตนเองได้', hist && hist.items.length >= 1);
ok('ยอดที่ชำระแล้วถูกต้อง (1650)', hist && hist.totals.total_paid === 1650, String(hist && hist.totals.total_paid));
ok('PIN ผิดดูประวัติไม่ได้', !S.apiMemberHistory({ member_code: m1.member_code, pin: '999999' }).ok);

console.log('\n=== 13. บันทึกเงินสดโดยผู้ดูแล ===');
const cashTarget = S.apiPublicCollection({ id: col.id }).data.members.find(m => m.status === 'unpaid');
if (cashTarget) {
  const cash = unwrap(S.apiManualPayment({ token: TOKEN, assignment_id: cashTarget.assignment_id, method: 'cash' }), 'บันทึกเงินสด');
  ok('บันทึกเงินสดได้', !!cash && !!cash.receipt_no);
  ok('สถานะเป็นชำระแล้วทันที', cash && cash.assignment_status === 'paid');
}

console.log('\n=== 14. สิทธิ์การใช้งาน ===');
const viewer = unwrap(S.apiSaveUser({ token: TOKEN, username: 'viewer1', email: 'v@example.com', full_name: 'ผู้ดูรายงาน', role: 'viewer' }), 'เพิ่ม viewer');
ok('เพิ่มผู้ดูรายงานได้', !!viewer && !!viewer.password);
const vAuth = S.login({ username: 'viewer1', password: viewer.password });
ok('ผู้ดูรายงานเข้าสู่ระบบได้', vAuth.ok);
const vTok = vAuth.data.token;
ok('ผู้ดูรายงานดูข้อมูลได้', S.apiMembers({ token: vTok }).ok);
ok('ผู้ดูรายงานเพิ่มสมาชิกไม่ได้', !S.apiSaveMember({ token: vTok, first_name: 'x', last_name: 'y' }).ok);
ok('ผู้ดูรายงานเข้าหน้าผู้ดูแลไม่ได้', !S.apiUsers({ token: vTok }).ok);
ok('ผู้ดูรายงานอนุมัติการชำระไม่ได้', !S.apiApprovePayment({ token: vTok, id: payId }).ok);

console.log('\n=== 15. ลืมรหัสผ่าน (ต้องตรงอีเมล) ===');
const mailBefore = shim._sentMail.length;
r = S.forgotPassword({ username: 'admin', email: 'wrong@example.com' });
ok('อีเมลผิด: ตอบข้อความกลาง ๆ และไม่ส่งเมล', r.ok && shim._sentMail.length === mailBefore);
r = S.forgotPassword({ username: 'admin', email: 'admin@example.com' });
ok('อีเมลถูก: ส่งลิงก์รีเซ็ต', r.ok && shim._sentMail.length === mailBefore + 1);
const mail = shim._sentMail[shim._sentMail.length - 1];
const tok = (mail.body.match(/token=([a-f0-9]{48})/) || [])[1];
ok('อีเมลมีโทเคนรีเซ็ต', !!tok);
ok('ตรวจสอบโทเคนได้', S.checkResetToken({ token: tok }).data.valid === true);
ok('รหัสผ่านอ่อนถูกปฏิเสธ', !S.resetPassword({ token: tok, password: 'abc', confirm_password: 'abc' }).ok);
ok('ตั้งรหัสผ่านใหม่สำเร็จ', S.resetPassword({ token: tok, password: 'NewPass2569', confirm_password: 'NewPass2569' }).ok);
ok('โทเคนใช้ซ้ำไม่ได้', !S.resetPassword({ token: tok, password: 'NewPass2570', confirm_password: 'NewPass2570' }).ok);
ok('เซสชันเดิมถูกยกเลิกหลังรีเซ็ต', !S.me({ token: TOKEN }).ok);
const relogin = S.login({ username: 'admin', password: 'NewPass2569' });
ok('เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้', relogin.ok);
const TOKEN2 = relogin.data.token;

console.log('\n=== 16. ล็อกบัญชีเมื่อกรอกผิดหลายครั้ง ===');
S.apiSaveUser({ token: TOKEN2, username: 'locktest', email: 'lock@example.com', full_name: 'ทดสอบล็อก', role: 'admin', password: 'Lock12345' });
for (let i = 0; i < 4; i++) S.login({ username: 'locktest', password: 'bad' + i });
r = S.login({ username: 'locktest', password: 'bad5' });
ok('ล็อกบัญชีหลังผิดครบ 5 ครั้ง', !r.ok && /ถูกล็อก/.test(r.error), r.error);
r = S.login({ username: 'locktest', password: 'Lock12345' });
ok('รหัสถูกก็เข้าไม่ได้ขณะถูกล็อก', !r.ok);
const lockUser = S.dbFind('Admins', a => a.username === 'locktest');
ok('ปลดล็อกได้', S.apiUnlockUser({ token: TOKEN2, id: lockUser.id }).ok);
ok('เข้าสู่ระบบได้หลังปลดล็อก', S.login({ username: 'locktest', password: 'Lock12345' }).ok);

console.log('\n=== 17. ตั้งค่าและบัญชีรับโอน ===');
const bank = unwrap(S.apiSaveBank({ token: TOKEN2, bank_name: 'ธนาคารกรุงไทย', account_name: 'โรงเรียนจุนวิทยาคม', account_number: '123-4-56789-0', promptpay_id: '0812345678', is_default: true }), 'เพิ่มบัญชี');
ok('เพิ่มบัญชีรับโอนได้', !!bank);
ok('ตรวจเลขพร้อมเพย์ผิดรูปแบบ', !S.apiSaveBank({ token: TOKEN2, bank_name: 'x', account_name: 'y', account_number: 'z', promptpay_id: '123' }).ok);
const qr = unwrap(S.apiBankQr({ token: TOKEN2, id: bank.id, amount: 1650 }), 'สร้าง QR');
ok('สร้าง QR พร้อมเพย์ได้', qr && qr.payload.indexOf('00020101021229') === 0);
const pqr = unwrap(S.apiPromptPay({ bank_id: bank.id, amount: 1650 }), 'QR สาธารณะ');
ok('หน้าสาธารณะขอ QR ระบุยอดได้', pqr && pqr.payload.indexOf('54071650.00') > 0, pqr && pqr.payload);

ok('บันทึกการตั้งค่าได้', S.apiSaveSettings({ token: TOKEN2, school_phone: '054-123456', mask_member_name: '1' }).ok);
const masked = S.apiPublicCollection({ id: col.id }).data;
ok('ปิดบังนามสกุลทำงาน', masked.members[0].name.indexOf('*') >= 0, masked.members[0].name);
S.apiSaveSettings({ token: TOKEN2, mask_member_name: '0' });

console.log('\n=== 18. บันทึกกิจกรรม ===');
ok('มีบันทึกกิจกรรมมากกว่า 20 รายการ', S.dbAll('AuditLogs').length > 20, String(S.dbAll('AuditLogs').length));

console.log('\n=== 19. ออกจากระบบ ===');
ok('ออกจากระบบได้', S.logout({ token: TOKEN2 }).ok);
ok('โทเคนใช้ไม่ได้แล้ว', !S.me({ token: TOKEN2 }).ok);

console.log('\n══════════════════════════════════════════');
console.log(`  ผ่าน ${pass} รายการ / ไม่ผ่าน ${fail} รายการ`);
if (failures.length) { console.log('\n  รายการที่ไม่ผ่าน:'); failures.forEach(f => console.log('   - ' + f)); }
console.log('══════════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
