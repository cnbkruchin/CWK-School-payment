#!/usr/bin/env node
'use strict';
/**
 * สร้างข้อมูลตัวอย่างสำหรับทดลองใช้งานระบบ
 * คำเตือน: ใช้กับฐานข้อมูลเปล่าเท่านั้น — รันด้วย  npm run demo
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db, migrate, setSetting, UPLOAD_DIR, nextReceiptNo } = require('../src/db');
const { generatePin, generateRefCode } = require('../src/utils/codes');

const GROUPS = ['ม.1/1', 'ม.1/2', 'ม.2/1', 'ม.3/1', 'ม.4/1', 'ม.5/1', 'ม.6/1', 'คณะครูและบุคลากร'];

const FIRST_M = ['สมชาย', 'อนุชา', 'ธนกฤต', 'ภูวดล', 'กิตติพงษ์', 'ณัฐวุฒิ', 'วีรภัทร', 'ศุภกร', 'ปิยะ', 'ชัยวัฒน์', 'ธีรเดช', 'อภิสิทธิ์'];
const FIRST_F = ['สมหญิง', 'กนกวรรณ', 'ณัฐชา', 'พิมพ์ชนก', 'สุภาพร', 'ชนิดา', 'วรรณิษา', 'อรอุมา', 'ปาริชาติ', 'ธิดารัตน์', 'มนัสนันท์', 'ศิริพร'];
const LAST = ['ใจดี', 'รักเรียน', 'ตั้งใจเรียน', 'ศรีสุข', 'บุญมี', 'ทองดี', 'แก้วมณี', 'พรหมมา', 'สุขสวัสดิ์', 'วงศ์คำ', 'จันทร์เพ็ญ', 'นามวงศ์', 'ดวงแก้ว', 'สีหานาม', 'พิมพ์ดี'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/** สร้างไฟล์ PNG ขนาดเล็กเป็นสลิปตัวอย่าง */
function makeDemoSlip(tag) {
  const dir = path.join(UPLOAD_DIR, 'demo');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `slip_demo_${tag}.png`);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAACWCAYAAAA1j1WCAAAAXUlEQVR42u3BMQEAAADCoPVPbQwf' +
    'oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAA4N8AVFUAAV7TjEsAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(file, Buffer.concat([png, Buffer.from(`\n<!--${tag}-->`)]));
  return { rel: path.relative(UPLOAD_DIR, file), size: fs.statSync(file).size };
}

function main() {
  migrate();

  if (db.prepare('SELECT COUNT(*) n FROM members').get().n > 0) {
    console.log('\n⚠  ฐานข้อมูลมีข้อมูลสมาชิกอยู่แล้ว — ยกเลิกการสร้างข้อมูลตัวอย่าง');
    console.log('   หากต้องการเริ่มใหม่ ให้ลบไฟล์ data/app.db แล้วรัน npm run setup ใหม่\n');
    process.exit(0);
  }
  if (db.prepare('SELECT COUNT(*) n FROM admins').get().n === 0) {
    console.log('\n⚠  ยังไม่มีบัญชีผู้ดูแลระบบ กรุณารัน  npm run setup  ก่อน\n');
    process.exit(1);
  }
  const admin = db.prepare("SELECT id FROM admins ORDER BY id LIMIT 1").get();

  const out = db.transaction(() => {
    /* ---------- ตั้งค่าโรงเรียน ---------- */
    setSetting('school_address', '123 หมู่ 4 อำเภอจุน จังหวัดพะเยา');
    setSetting('school_phone', '054-123456');

    /* ---------- บัญชีรับโอน ---------- */
    db.prepare(
      `INSERT INTO bank_accounts (bank_name, account_name, account_number, branch, promptpay_id, is_default, sort_order)
       VALUES (?,?,?,?,?,1,0)`
    ).run('ธนาคารกรุงไทย', 'โรงเรียนจุนวิทยาคม', '123-4-56789-0', 'สาขาจุน', '0812345678');
    db.prepare(
      `INSERT INTO bank_accounts (bank_name, account_name, account_number, branch, is_default, sort_order)
       VALUES (?,?,?,?,0,1)`
    ).run('ธนาคารออมสิน', 'โรงเรียนจุนวิทยาคม (กิจกรรม)', '020-1-23456-7', 'สาขาจุน');

    /* ---------- กลุ่ม ---------- */
    db.prepare('DELETE FROM groups').run();
    const insG = db.prepare('INSERT INTO groups (name, sort_order) VALUES (?,?)');
    const groupIds = GROUPS.map((g, i) => insG.run(g, i).lastInsertRowid);

    /* ---------- สมาชิก ---------- */
    const insM = db.prepare(
      `INSERT INTO members (member_code, prefix, first_name, last_name, group_id, phone, guardian, pin_hash, pin_plain, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    const members = [];
    let seq = 1;
    groupIds.forEach((gid, gi) => {
      const isStaff = GROUPS[gi].includes('ครู');
      const count = isStaff ? 8 : randInt(10, 14);
      for (let i = 0; i < count; i++) {
        const male = Math.random() < 0.5;
        const prefix = isStaff ? (male ? 'นาย' : 'นาง') : (gi >= 4 ? (male ? 'นาย' : 'นางสาว') : (male ? 'เด็กชาย' : 'เด็กหญิง'));
        const first = male ? rand(FIRST_M) : rand(FIRST_F);
        const last = rand(LAST);
        const code = `M${String(seq).padStart(4, '0')}`;
        const pin = generatePin();
        const id = insM.run(
          code, prefix, first, last, gid,
          `08${randInt(10000000, 99999999)}`,
          isStaff ? null : `${male ? 'นาย' : 'นาง'}${rand(FIRST_M)} ${last}`,
          bcrypt.hashSync(pin, 10), pin, i
        ).lastInsertRowid;
        members.push({ id, code, pin, gid, full_name: `${prefix}${first} ${last}` });
        seq++;
      }
    });

    /* ---------- รายการจัดเก็บ ---------- */
    const insC = db.prepare(
      `INSERT INTO collections (code, name, description, fiscal_year, term, default_amount, due_date, allow_partial, status, is_public, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`
    );
    const insCI = db.prepare('INSERT INTO collection_items (collection_id, name, description, amount, is_optional, sort_order) VALUES (?,?,?,?,?,?)');
    const insA = db.prepare('INSERT INTO assignments (collection_id, member_id, amount_due, discount, waived, created_by) VALUES (?,?,?,?,?,?)');
    const insAI = db.prepare('INSERT INTO assignment_items (assignment_id, collection_item_id, amount) VALUES (?,?,?)');

    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

    const collections = [
      {
        code: 'CWK69-001', name: 'เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569',
        desc: 'ค่าบำรุงการศึกษาและกิจกรรมพัฒนาผู้เรียน ภาคเรียนที่ 1',
        term: '1', due: daysAhead(20), status: 'open', created: daysAgo(30), partial: 1,
        items: [
          ['ค่าบำรุงการศึกษา', 'ค่าใช้จ่ายด้านการเรียนการสอน', 1200, 0],
          ['ค่าประกันอุบัติเหตุนักเรียน', 'คุ้มครองตลอดปีการศึกษา', 300, 0],
          ['ค่าสาธารณูปโภค', '', 200, 0],
          ['ค่าเรียนเสริมพิเศษวันเสาร์', 'สำหรับผู้สนใจ', 500, 1],
        ],
        assignTo: 'all',
      },
      {
        code: 'CWK69-002', name: 'เงินค่าเครื่องแบบและอุปกรณ์การเรียน',
        desc: 'ชุดนักเรียน ชุดพละ และอุปกรณ์การเรียนประจำปี',
        term: '1', due: daysAhead(5), status: 'open', created: daysAgo(18), partial: 0,
        items: [
          ['ชุดนักเรียน 2 ชุด', '', 700, 0],
          ['ชุดพลศึกษา', '', 350, 0],
          ['กระเป๋านักเรียน', '', 250, 0],
        ],
        assignTo: 'students',
      },
      {
        code: 'CWK69-003', name: 'เงินกิจกรรมทัศนศึกษา ม.ปลาย',
        desc: 'ทัศนศึกษาแหล่งเรียนรู้จังหวัดนครราชสีมา สำหรับนักเรียนชั้น ม.4-ม.6',
        term: '1', due: daysAhead(12), status: 'open', created: daysAgo(10), partial: 0,
        items: [['ค่ารถโดยสาร', '', 450, 0], ['ค่าอาหารและที่พัก', '', 800, 0], ['ค่าเข้าชมสถานที่', '', 150, 0]],
        assignTo: 'upper',
      },
      {
        code: 'CWK68-012', name: 'เงินบำรุงการศึกษา ภาคเรียนที่ 2/2568',
        desc: 'รอบที่ปิดรับชำระแล้ว (ข้อมูลย้อนหลัง)',
        term: '2', due: daysAhead(-40), status: 'closed', created: daysAgo(160), partial: 0,
        items: [['ค่าบำรุงการศึกษา', '', 1200, 0], ['ค่าประกันอุบัติเหตุ', '', 300, 0]],
        assignTo: 'all', historical: true,
      },
      {
        code: 'CWK69-004', name: 'เงินสนับสนุนกิจกรรมกีฬาสี (ฉบับร่าง)',
        desc: 'ยังไม่เปิดรับชำระ — อยู่ระหว่างเตรียมการ',
        term: '1', due: daysAhead(45), status: 'draft', created: daysAgo(2), partial: 0,
        items: [['ค่าเสื้อกีฬาสี', '', 180, 0], ['ค่าอุปกรณ์กีฬา', '', 120, 0]],
        assignTo: 'none',
      },
    ];

    const assignments = [];
    for (const c of collections) {
      const base = c.items.filter((it) => !it[3]).reduce((s, it) => s + it[2], 0);
      const cid = insC.run(c.code, c.name, c.desc, '2569', c.term, base, c.due, c.partial, c.status, admin.id, c.created).lastInsertRowid;
      const itemIds = c.items.map((it, i) => insCI.run(cid, it[0], it[1] || null, it[2], it[3], i).lastInsertRowid);
      const requiredItems = c.items.map((it, i) => ({ id: itemIds[i], amount: it[2], optional: it[3] })).filter((x) => !x.optional);

      let targets = [];
      if (c.assignTo === 'all') targets = members;
      else if (c.assignTo === 'students') targets = members.filter((m) => !GROUPS[groupIds.indexOf(m.gid)].includes('ครู'));
      else if (c.assignTo === 'upper') {
        const upper = groupIds.filter((_, i) => ['ม.4/1', 'ม.5/1', 'ม.6/1'].includes(GROUPS[i]));
        targets = members.filter((m) => upper.includes(m.gid));
      }

      for (const m of targets) {
        const waived = !c.historical && Math.random() < 0.03 ? 1 : 0;   // ได้รับทุน/ยกเว้น
        const aid = insA.run(cid, m.id, base, 0, waived, admin.id).lastInsertRowid;
        for (const it of requiredItems) insAI.run(aid, it.id, it.amount);
        assignments.push({ aid, member: m, base, cid, collection: c, waived });
      }
    }

    /* ---------- การแจ้งชำระเงิน ---------- */
    const insP = db.prepare(
      `INSERT INTO payments (ref_code, assignment_id, amount, method, payer_name, transferred_at, bank_account_id,
                             slip_path, slip_mime, slip_size, slip_hash, note, status, reject_reason,
                             verified_by, verified_at, receipt_no, created_at)
       VALUES (@ref,@aid,@amount,@method,@payer,@tat,1,@sp,'image/png',@size,@hash,@note,@status,@reason,@vby,@vat,@receipt,@created)`
    );

    let slipSeq = 0;
    let firstApprovedRef = null;
    let firstApprovedMember = null;

    for (const a of assignments) {
      if (a.waived) continue;
      const hist = a.collection.historical;
      const roll = Math.random();
      // รอบเก่า: ชำระเกือบครบ / รอบปัจจุบัน: กระจายทุกสถานะ
      let kind;
      if (hist) kind = roll < 0.92 ? 'approved' : 'none';
      else if (roll < 0.42) kind = 'approved';
      else if (roll < 0.58) kind = 'pending';
      else if (roll < 0.66) kind = 'rejected';
      else if (roll < 0.72 && a.collection.partial) kind = 'partial';
      else kind = 'none';
      if (kind === 'none') continue;

      const created = daysAgo(randInt(1, hist ? 150 : 25));
      const slip = makeDemoSlip(`${slipSeq++}`);
      const hash = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(UPLOAD_DIR, slip.rel))).digest('hex');

      const mk = (status, amount, extra = {}) => {
        const ref = generateRefCode(db);
        insP.run({
          ref, aid: a.aid, amount, method: 'transfer', payer: a.member.full_name,
          tat: created, sp: slip.rel, size: slip.size, hash,
          note: null, status, reason: extra.reason || null,
          vby: status === 'pending' ? null : admin.id,
          vat: status === 'pending' ? null : created,
          receipt: status === 'approved' ? nextReceiptNo() : null,
          created,
        });
        return ref;
      };

      if (kind === 'approved') {
        const ref = mk('approved', a.base);
        if (!firstApprovedRef && !hist) { firstApprovedRef = ref; firstApprovedMember = a.member; }
      } else if (kind === 'pending') {
        mk('pending', a.base);
      } else if (kind === 'rejected') {
        mk('rejected', a.base, { reason: rand(['สลิปไม่ชัดเจน อ่านไม่ออก', 'จำนวนเงินไม่ตรงกับที่ต้องชำระ', 'ไม่พบรายการโอนเข้าบัญชี']) });
      } else if (kind === 'partial') {
        mk('approved', Math.round(a.base * 0.5 * 100) / 100);
      }
    }

    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, detail)
       VALUES ('system', NULL, 'ระบบ', 'สร้างข้อมูลตัวอย่าง', ?)`
    ).run(`สมาชิก ${members.length} คน • รายการจัดเก็บ ${collections.length} รายการ`);

    return { members, collections, assignments, firstApprovedRef, firstApprovedMember };
  })();

  const stats = {
    members: db.prepare('SELECT COUNT(*) n FROM members').get().n,
    groups: db.prepare('SELECT COUNT(*) n FROM groups').get().n,
    collections: db.prepare('SELECT COUNT(*) n FROM collections').get().n,
    assignments: db.prepare('SELECT COUNT(*) n FROM assignments').get().n,
    payments: db.prepare('SELECT COUNT(*) n FROM payments').get().n,
    approved: db.prepare("SELECT COUNT(*) n FROM payments WHERE status='approved'").get().n,
    pending: db.prepare("SELECT COUNT(*) n FROM payments WHERE status='pending'").get().n,
  };

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ✓ สร้างข้อมูลตัวอย่างเรียบร้อยแล้ว');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  กลุ่ม/ชั้นเรียน   : ${stats.groups}`);
  console.log(`  สมาชิก            : ${stats.members} คน`);
  console.log(`  รายการจัดเก็บ     : ${stats.collections} รายการ`);
  console.log(`  รายการที่ต้องชำระ : ${stats.assignments}`);
  console.log(`  การแจ้งชำระ       : ${stats.payments} (อนุมัติ ${stats.approved} • รอตรวจสอบ ${stats.pending})`);
  if (out.firstApprovedRef) {
    console.log(`\n  ตัวอย่างสำหรับทดลอง:`);
    console.log(`    เลขอ้างอิง 4 หลัก : ${out.firstApprovedRef}`);
    console.log(`    รหัสสมาชิก        : ${out.firstApprovedMember.code}`);
    console.log(`    รหัส PIN          : ${out.firstApprovedMember.pin}`);
  }
  console.log('\n  เริ่มใช้งาน: npm start\n');

  if (process.env.EMIT_JSON) {
    fs.writeFileSync(process.env.EMIT_JSON, JSON.stringify({
      ref: out.firstApprovedRef,
      member_code: out.firstApprovedMember && out.firstApprovedMember.code,
      pin: out.firstApprovedMember && out.firstApprovedMember.pin,
      stats,
    }, null, 2));
  }
}

main();
