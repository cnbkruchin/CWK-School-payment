#!/usr/bin/env node
'use strict';
/** สร้างบัญชีผู้ดูแลระบบบัญชีแรก และข้อมูลตั้งต้นของระบบ */
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { db, migrate, setSetting, getSetting } = require('../src/db');
const { randomDigits } = require('../src/utils/codes');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def = '') =>
  new Promise((resolve) =>
    rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => resolve(String(a || '').trim() || def))
  );

function askHidden(q) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(`${q}: `);
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let pw = '';
    const onData = (ch) => {
      const s = ch.toString('utf8');
      if (s === '\n' || s === '\r' || s === '\u0004') {
        if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pw);
      } else if (s === '\u0003') {
        process.stdout.write('\n'); process.exit(1);
      } else if (s === '\u007f' || s === '\b') {
        if (pw.length) { pw = pw.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        pw += s; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function checkPassword(pw) {
  if (!pw || pw.length < 8) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'รหัสผ่านต้องประกอบด้วยตัวอักษรและตัวเลข';
  return null;
}

async function main() {
  migrate();
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ติดตั้งระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ');
  console.log('══════════════════════════════════════════════════════\n');

  const existing = db.prepare('SELECT COUNT(*) n FROM admins').get().n;

  // โหมดอัตโนมัติผ่านตัวแปรสภาพแวดล้อม (สำหรับการติดตั้งแบบสคริปต์)
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;
  const envMail = process.env.ADMIN_EMAIL;

  if (existing > 0 && !process.env.FORCE_SETUP) {
    console.log(`มีบัญชีผู้ดูแลระบบอยู่แล้ว ${existing} บัญชี`);
    console.log('หากลืมรหัสผ่าน ให้ใช้คำสั่ง  npm run reset-admin\n');
    rl.close();
    return;
  }

  let username, password, email, fullName, schoolName;

  if (envUser && envPass && envMail) {
    username = envUser.toLowerCase();
    password = envPass;
    email = envMail.toLowerCase();
    fullName = process.env.ADMIN_NAME || 'ผู้ดูแลระบบ';
    schoolName = process.env.SCHOOL_NAME || getSetting('school_name');
    console.log('ใช้ข้อมูลจากตัวแปรสภาพแวดล้อม (.env)');
  } else {
    schoolName = await ask('ชื่อโรงเรียน', getSetting('school_name'));
    fullName = await ask('ชื่อ-สกุลของผู้ดูแลระบบ', 'ผู้ดูแลระบบ');
    username = (await ask('ชื่อผู้ใช้สำหรับเข้าสู่ระบบ (ภาษาอังกฤษ)', 'admin')).toLowerCase();
    email = (await ask('อีเมลของผู้ดูแล (ใช้สำหรับรีเซ็ตรหัสผ่านกรณีลืม)')).toLowerCase();
    while (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      console.log('  ✗ รูปแบบอีเมลไม่ถูกต้อง');
      email = (await ask('อีเมลของผู้ดูแล')).toLowerCase();
    }
    for (;;) {
      password = await askHidden('รหัสผ่าน (อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข)');
      const err = checkPassword(password);
      if (err) { console.log(`  ✗ ${err}`); continue; }
      const confirm = await askHidden('ยืนยันรหัสผ่านอีกครั้ง');
      if (confirm !== password) { console.log('  ✗ รหัสผ่านไม่ตรงกัน'); continue; }
      break;
    }
  }

  const err = checkPassword(password);
  if (err) { console.error(`\n✗ ${err}`); process.exit(1); }
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) {
    console.error('\n✗ ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง ความยาว 3-80 ตัว');
    process.exit(1);
  }

  db.transaction(() => {
    const dup = db.prepare('SELECT id FROM admins WHERE lower(username) = ? OR lower(email) = ?').get(username, email);
    if (dup) {
      db.prepare(
        "UPDATE admins SET password_hash=?, email=?, full_name=?, role='superadmin', is_active=1, failed_attempts=0, locked_until=NULL WHERE id=?"
      ).run(bcrypt.hashSync(password, 12), email, fullName, dup.id);
    } else {
      db.prepare(
        `INSERT INTO admins (username, email, full_name, password_hash, role) VALUES (?,?,?,?,'superadmin')`
      ).run(username, email, fullName, bcrypt.hashSync(password, 12));
    }
    if (schoolName) setSetting('school_name', schoolName);

    if (db.prepare('SELECT COUNT(*) n FROM groups').get().n === 0) {
      const ins = db.prepare('INSERT INTO groups (name, sort_order) VALUES (?,?)');
      ['ม.1/1', 'ม.2/1', 'ม.3/1', 'ม.4/1', 'ม.5/1', 'ม.6/1', 'คณะครูและบุคลากร'].forEach((n, i) => ins.run(n, i));
    }
  })();

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ✓ ติดตั้งเรียบร้อยแล้ว');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  โรงเรียน    : ${getSetting('school_name')}`);
  console.log(`  ชื่อผู้ใช้   : ${username}`);
  console.log(`  อีเมล       : ${email}`);
  console.log('\n  เริ่มใช้งานด้วยคำสั่ง:  npm start');
  console.log('  แล้วเปิดเบราว์เซอร์ไปที่ http://localhost:3000/admin\n');
  rl.close();
}

main().catch((e) => { console.error('เกิดข้อผิดพลาด:', e.message); rl.close(); process.exit(1); });
