'use strict';
require('dotenv').config();

const { createApp } = require('./src/app');
const { db, getSetting } = require('./src/db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  const admins = db.prepare('SELECT COUNT(*) n FROM admins').get().n;
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║   ระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ              ║');
  console.log(`  ║   ${String(getSetting('school_name')).padEnd(52, ' ')}  ║`);
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`   หน้าแจ้งชำระเงิน : ${url}/`);
  console.log(`   หน้าผู้ดูแลระบบ  : ${url}/admin`);
  console.log('');
  if (admins === 0) {
    console.log('   ⚠  ยังไม่มีบัญชีผู้ดูแลระบบ — รันคำสั่ง  npm run setup  เพื่อสร้างบัญชีแรก');
    console.log('');
  }
});

function shutdown(signal) {
  console.log(`\nได้รับสัญญาณ ${signal} กำลังปิดระบบ...`);
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
