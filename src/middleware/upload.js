'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { UPLOAD_DIR, getSettingNumber } = require('../db');

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

/** ลายเซ็นไฟล์ (magic bytes) เพื่อยืนยันชนิดไฟล์จริง */
const SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

function detectMime(buf) {
  for (const sig of SIGNATURES) {
    if (sig.bytes.every((b, i) => buf[i] === b)) return sig.mime;
  }
  // WEBP: RIFF....WEBP
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  // HEIC/HEIF: ....ftypheic / ftypmif1
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heim'].includes(brand)) return 'image/heic';
  }
  return null;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const d = new Date();
    const dir = path.join(UPLOAD_DIR, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `slip_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

function makeSlipUploader() {
  const maxMb = Math.max(1, Math.min(50, getSettingNumber('max_upload_mb', 10)));
  return multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
      if (!ALLOWED[file.mimetype]) {
        return cb(new Error('รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, HEIC) หรือ PDF เท่านั้น'));
      }
      cb(null, true);
    },
  }).single('slip');
}

/** อัปโหลดสลิป พร้อมแปลงข้อผิดพลาดเป็นภาษาไทย */
function slipUpload(req, res, next) {
  makeSlipUploader()(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = getSettingNumber('max_upload_mb', 10);
      return res.status(400).json({ error: `ไฟล์มีขนาดใหญ่เกิน ${maxMb} MB กรุณาย่อขนาดไฟล์ก่อนอัปโหลด` });
    }
    return res.status(400).json({ error: err.message || 'อัปโหลดไฟล์ไม่สำเร็จ' });
  });
}

/** อัปโหลดไฟล์ CSV/Excel สำหรับนำเข้าสมาชิก (เก็บในหน่วยความจำ) */
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
}).single('file');

/** อัปโหลดโลโก้โรงเรียน */
const logoUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(UPLOAD_DIR, 'branding');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = ALLOWED[file.mimetype] || '.png';
      cb(null, `logo_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('โลโก้ต้องเป็นไฟล์รูปภาพ'));
    cb(null, true);
  },
}).single('logo');

/** ตรวจสอบไฟล์จริงหลังอัปโหลด และคำนวณ hash สำหรับตรวจจับสลิปซ้ำ */
function inspectFile(absPath) {
  const buf = fs.readFileSync(absPath);
  const detected = detectMime(buf.slice(0, 32));
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return { detected, hash, size: buf.length };
}

module.exports = { slipUpload, importUpload, logoUpload, inspectFile, ALLOWED, UPLOAD_DIR };
