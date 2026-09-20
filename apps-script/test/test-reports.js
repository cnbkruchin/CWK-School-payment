'use strict';
const { loadProject } = require('./loader');
let pass=0, fail=0; const failures=[];
function ok(l,c,e=''){ if(c){pass++;console.log('  ✓ '+l);} else {fail++;failures.push(l);console.log('  ✗ '+l+' '+e);} }
function un(r,l){ if(!r.ok){fail++;failures.push(l);console.log('  ✗ '+l+' -> '+r.error);return null;} return r.data; }

const P = loadProject(); const S = P.sandbox;
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const slip=t=>Buffer.concat([Buffer.from(PNG,'base64'),Buffer.from(String(t))]).toString('base64');

S.setupSilent_({adminUsername:'admin',adminPassword:'Admin1234',adminEmail:'a@b.com'});
const T = S.login({username:'admin',password:'Admin1234'}).data.token;
const groups = S.apiGroups({token:T}).data.groups;

// สร้างสมาชิก 40 คน
const rows=[['รหัสสมาชิก','คำนำหน้า','ชื่อ','นามสกุล','กลุ่ม']];
for(let i=1;i<=40;i++) rows.push(['','เด็กชาย','ทดสอบ'+i,'นามสกุล'+i, groups[i%3].name]);
S.apiImportMembers({token:T, rows});

// 2 รายการจัดเก็บ
const c1 = S.apiSaveCollection({token:T,name:'เงินบำรุงการศึกษา 1/2569',fiscal_year:'2569',term:'1',due_date:'2026-10-31',
  items:[{name:'ค่าบำรุงการศึกษา',amount:1200},{name:'ค่าประกัน',amount:300}]}).data;
S.apiAssign({token:T,collection_id:c1.id,mode:'all'});
S.apiSetCollectionStatus({token:T,id:c1.id,status:'open'});

const c2 = S.apiSaveCollection({token:T,name:'ค่าเครื่องแบบ',fiscal_year:'2569',term:'1',due_date:'2025-01-01',
  items:[{name:'ชุดนักเรียน',amount:700}]}).data;
S.apiAssign({token:T,collection_id:c2.id,mode:'group',group_ids:[groups[0].id]});
S.apiSetCollectionStatus({token:T,id:c2.id,status:'open'});

// ให้บางคนชำระ
const board = S.apiPublicCollection({id:c1.id}).data.members;
let paid=0;
for(let i=0;i<12;i++){
  const b = board[i];
  const mem = S.dbFind('Members', m=>m.member_code===b.member_code);
  const pin = S.apiResetPin({token:T,ids:[mem.id]}).data.members[0].pin;
  const sub = S.apiSubmitPayment({assignment_id:b.assignment_id,pin,slip_base64:slip('r'+i),slip_name:'s.png'});
  if(sub.ok && i<8){ S.apiApprovePayment({token:T,id:S.dbFind('Payments',p=>p.ref_code===sub.data.ref_code).id}); paid++; }
}
console.log('เตรียมข้อมูล: สมาชิก', S.dbAll('Members').length, '| ชำระแล้ว', paid, '| รอตรวจสอบ', S.dbWhere('Payments',p=>p.status==='pending').length);

console.log('\n=== แดชบอร์ด ===');
const dash = un(S.apiDashboard({token:T}),'แดชบอร์ด');
ok('แดชบอร์ดทำงาน', dash && dash.stats.total_members > 0);
ok('มีรายการล่าสุด', dash && dash.recent.length > 0);
ok('มีความคืบหน้ารายชุด', dash && dash.by_collection.length === 2);
ok('มีสรุปตามกลุ่ม', dash && dash.by_group.length > 0);
ok('ยอดเก็บได้ถูกต้อง', dash && dash.stats.total_paid === paid*1500, String(dash && dash.stats.total_paid));

console.log('\n=== รายงานทั้ง 6 รูปแบบ ===');
const ov = un(S.apiReport({token:T,kind:'overview'}),'ภาพรวม');
ok('รายงานภาพรวม', ov && ov.rows.length === 2);
ok('ยอดรวมภาพรวมถูกต้อง', ov && ov.totals.total_paid === paid*1500, String(ov && ov.totals.total_paid));

const cr = un(S.apiReport({token:T,kind:'collection',collection:c1.id}),'รายชุด');
ok('รายงานรายชุด', cr && cr.rows.length === 40, String(cr && cr.rows.length));

const firstMember = S.dbAll('Members')[0];
const mr = un(S.apiReport({token:T,kind:'member',member:firstMember.id}),'รายบุคคล');
ok('รายงานรายบุคคล', mr && mr.rows.length >= 1);
ok('มีประวัติการแจ้งชำระ', mr && Array.isArray(mr.payments));

const amr = un(S.apiReport({token:T,kind:'members'}),'สรุปทุกคน');
ok('รายงานสรุปรายบุคคลทุกคน', amr && amr.rows.length === 40);

const tx = un(S.apiReport({token:T,kind:'transactions'}),'ธุรกรรม');
ok('รายงานธุรกรรม', tx && tx.count === paid, String(tx && tx.count));
ok('มีคำอ่านเงินภาษาไทย', tx && /บาท/.test(tx.baht_text), tx && tx.baht_text);

const os = un(S.apiReport({token:T,kind:'outstanding'}),'ค้างชำระ');
ok('รายงานค้างชำระ', os && os.count > 0);
ok('คำนวณวันเลยกำหนดได้', os && os.rows.some(r=>r.overdue_days>0), 'max='+Math.max(...os.rows.map(r=>r.overdue_days)));

const audit = un(S.apiAuditLogs({token:T}),'บันทึกกิจกรรม');
ok('บันทึกกิจกรรมมีข้อมูล', audit && audit.total > 20, String(audit && audit.total));

console.log('\n=== ส่งออกไฟล์ ===');
for (const kind of ['overview','collection','member','members','transactions','outstanding']) {
  const params = {token:T, kind};
  if(kind==='collection') params.collection=c1.id;
  if(kind==='member') params.member=firstMember.id;
  const ex = S.apiExportReport(params);
  ok('ส่งออก '+kind, ex.ok && ex.data.url && ex.data.xlsx_url && ex.data.pdf_url, ex.error||'');
}
const exOv = S.apiExportReport({token:T,kind:'overview'}).data;
ok('ลิงก์ Excel ถูกต้อง', /format=xlsx/.test(exOv.xlsx_url));
ok('ลิงก์ PDF ถูกต้อง', /format=pdf/.test(exOv.pdf_url));
ok('ลิงก์ CSV ถูกต้อง', /format=csv/.test(exOv.csv_url));

console.log('\n=== ตรวจเนื้อหาไฟล์รายงาน ===');
const shim = require('./gas-shim');
const created = S.SpreadsheetApp ? null : null;
const exC = S.apiExportReport({token:T,kind:'collection',collection:c1.id}).data;
const repSs = shim.SpreadsheetApp.openById(exC.file_id);
const sheet = repSs.getSheets()[0];
const vals = sheet.getRange(1,1,Math.min(12,sheet.getLastRow()),12).getValues();
ok('ไฟล์รายงานมีหัวเรื่อง', String(vals[0][0]).includes('เงินบำรุงการศึกษา'), String(vals[0][0]));
ok('มีหัวตารางภาษาไทย', vals.some(r=>r.includes('ชื่อ-สกุล')));
ok('มีแถวข้อมูล', sheet.getLastRow() > 10, String(sheet.getLastRow()));
ok('มีแผ่นงานกิจกรรมย่อย', repSs.getSheets().length === 2, String(repSs.getSheets().length));

console.log('\n══════════════════════════════════════════');
console.log(`  ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
if(failures.length) failures.forEach(f=>console.log('   - '+f));
console.log('══════════════════════════════════════════\n');
process.exit(fail?1:0);
