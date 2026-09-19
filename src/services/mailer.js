'use strict';
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db');

const OUTBOX = path.join(DATA_DIR, 'outbox');

let transporter = null;
let mode = 'disabled';

function init() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: String(SMTP_SECURE || '').toLowerCase() === 'true' || Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    mode = 'smtp';
  } else {
    fs.mkdirSync(OUTBOX, { recursive: true });
    mode = 'file';
  }
  return mode;
}

function getMode() { return mode; }

/**
 * ส่งอีเมล ถ้าไม่ได้ตั้งค่า SMTP จะบันทึกเป็นไฟล์ไว้ใน data/outbox
 * และแสดงลิงก์ใน console เพื่อให้ใช้งานได้ทันทีโดยไม่ต้องตั้งค่าเพิ่ม
 */
async function send({ to, subject, text, html }) {
  if (!transporter && mode !== 'file') init();
  const from = process.env.MAIL_FROM || 'ระบบแจ้งชำระเงิน <no-reply@localhost>';

  if (mode === 'smtp') {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    return { delivered: true, mode, id: info.messageId };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTo = String(to).replace(/[^a-zA-Z0-9@._-]/g, '_');
  const file = path.join(OUTBOX, `${stamp}_${safeTo}.txt`);
  fs.mkdirSync(OUTBOX, { recursive: true });
  fs.writeFileSync(file, `To: ${to}\nSubject: ${subject}\nDate: ${new Date().toISOString()}\n\n${text || ''}\n`, 'utf8');
  console.log('\n──────── อีเมล (โหมดไม่มี SMTP) ────────');
  console.log(`ถึง: ${to}\nเรื่อง: ${subject}\n${text || ''}`);
  console.log(`บันทึกไว้ที่: ${file}`);
  console.log('────────────────────────────────────────\n');
  return { delivered: false, mode, file };
}

module.exports = { init, send, getMode, OUTBOX };
