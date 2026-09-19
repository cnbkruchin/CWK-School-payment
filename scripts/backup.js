#!/usr/bin/env node
'use strict';
/**
 * สำรองฐานข้อมูลและไฟล์สลิป
 *   npm run backup                 -> เก็บไว้ที่ backups/
 *   npm run backup -- /path/to/dir -> ระบุปลายทางเอง
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, migrate, DB_FILE, UPLOAD_DIR, DATA_DIR } = require('../src/db');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function main() {
  migrate();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base = process.argv[2] || path.join(__dirname, '..', 'backups');
  const dir = path.join(base, `backup-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  // VACUUM INTO สร้างสำเนาที่สมบูรณ์ได้แม้ระบบกำลังทำงานอยู่
  const dbOut = path.join(dir, 'app.db');
  db.prepare('VACUUM INTO ?').run(dbOut);
  const dbSize = fs.statSync(dbOut).size;

  const files = copyDir(UPLOAD_DIR, path.join(dir, 'uploads'));

  fs.writeFileSync(path.join(dir, 'README.txt'),
    [
      'ไฟล์สำรองข้อมูลระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ',
      `สร้างเมื่อ: ${new Date().toISOString()}`,
      `ฐานข้อมูล: app.db (${(dbSize / 1024).toFixed(0)} KB)`,
      `ไฟล์สลิปและรูปภาพ: uploads/ (${files} ไฟล์)`,
      '',
      'วิธีกู้คืน:',
      '  1. หยุดการทำงานของระบบ',
      `  2. คัดลอก app.db ทับไฟล์ ${DB_FILE}`,
      `  3. คัดลอกโฟลเดอร์ uploads ทับ ${UPLOAD_DIR}`,
      '  4. เริ่มระบบใหม่ด้วยคำสั่ง npm start',
    ].join('\n'), 'utf8');

  console.log('\n  ✓ สำรองข้อมูลเรียบร้อยแล้ว');
  console.log(`    ตำแหน่ง   : ${dir}`);
  console.log(`    ฐานข้อมูล : ${(dbSize / 1024).toFixed(0)} KB`);
  console.log(`    ไฟล์สลิป  : ${files} ไฟล์`);
  console.log(`    ข้อมูลต้นทาง: ${DATA_DIR}\n`);
}

main();
