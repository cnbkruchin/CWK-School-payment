#!/usr/bin/env node
'use strict';
/**
 * ตั้งรหัสผ่านผู้ดูแลระบบใหม่จากเครื่องเซิร์ฟเวอร์
 * ใช้กรณีลืมรหัสผ่านและไม่สามารถรับอีเมลได้
 *   npm run reset-admin
 */
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { db, migrate } = require('../src/db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def = '') =>
  new Promise((r) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => r(String(a || '').trim() || def)));

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
      } else if (s === '\u0003') { process.stdout.write('\n'); process.exit(1); }
      else if (s === '\u007f' || s === '\b') { if (pw.length) { pw = pw.slice(0, -1); process.stdout.write('\b \b'); } }
      else { pw += s; process.stdout.write('*'); }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  migrate();
  const admins = db.prepare('SELECT id, username, email, full_name, role, is_active FROM admins ORDER BY id').all();
  if (!admins.length) {
    console.log('\nยังไม่มีบัญชีผู้ดูแลระบบ กรุณารัน  npm run setup  ก่อน\n');
    rl.close();
    return;
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ตั้งรหัสผ่านผู้ดูแลระบบใหม่');
  console.log('══════════════════════════════════════════════════════\n');
  admins.forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.username.padEnd(16)} ${a.full_name}  (${a.email})${a.is_active ? '' : '  [ระงับการใช้งาน]'}`);
  });
  console.log('');

  const pick = await ask('เลือกหมายเลขบัญชีที่ต้องการตั้งรหัสผ่านใหม่', '1');
  const target = admins[Number(pick) - 1];
  if (!target) { console.log('หมายเลขไม่ถูกต้อง'); rl.close(); process.exit(1); }

  let password;
  for (;;) {
    password = await askHidden(`รหัสผ่านใหม่ของ "${target.username}" (อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข)`);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      console.log('  ✗ รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร และมีทั้งตัวอักษรและตัวเลข');
      continue;
    }
    const confirm = await askHidden('ยืนยันรหัสผ่านอีกครั้ง');
    if (confirm !== password) { console.log('  ✗ รหัสผ่านไม่ตรงกัน'); continue; }
    break;
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE admins SET password_hash = ?, must_change_pw = 0, failed_attempts = 0,
              locked_until = NULL, is_active = 1, updated_at = datetime('now') WHERE id = ?`
    ).run(bcrypt.hashSync(password, 12), target.id);
    db.prepare('DELETE FROM sessions').run(); // ออกจากระบบทุกเครื่องเพื่อความปลอดภัย
    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_name, action, target_type, target_id, detail)
       VALUES ('system', 'เครื่องเซิร์ฟเวอร์', 'ตั้งรหัสผ่านผู้ดูแลใหม่จากเครื่องเซิร์ฟเวอร์', 'admin', ?, ?)`
    ).run(target.id, target.username);
  })();

  console.log(`\n  ✓ ตั้งรหัสผ่านใหม่ให้ "${target.username}" เรียบร้อยแล้ว`);
  console.log('    บัญชีถูกปลดล็อกและเปิดใช้งานแล้ว • ผู้ใช้ทุกคนถูกออกจากระบบเพื่อความปลอดภัย\n');
  rl.close();
}

main().catch((e) => { console.error('เกิดข้อผิดพลาด:', e.message); rl.close(); process.exit(1); });
