'use strict';
const QRCode = require('qrcode');

/** CRC-16/CCITT-FALSE ตามมาตรฐาน EMVCo */
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id, value) {
  return String(id) + String(value.length).padStart(2, '0') + value;
}

/** แปลงเลขพร้อมเพย์ให้อยู่ในรูปแบบมาตรฐาน */
function normalizeTarget(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 13) return { tag: '02', value: digits };            // เลขประจำตัวประชาชน/นิติบุคคล
  if (digits.length === 15) return { tag: '03', value: digits };            // e-Wallet
  if (digits.length === 10) return { tag: '01', value: '0066' + digits.slice(1) }; // เบอร์โทร
  if (digits.length === 9) return { tag: '01', value: '0066' + digits };
  return null;
}

/**
 * สร้าง payload พร้อมเพย์ (EMVCo)
 * @param {string} target เบอร์โทร / เลขบัตรประชาชน / เลขนิติบุคคล
 * @param {number} [amount] จำนวนเงิน (ถ้าระบุจะเป็น QR แบบระบุยอด)
 */
function buildPayload(target, amount) {
  const t = normalizeTarget(target);
  if (!t) return null;
  const hasAmount = Number(amount) > 0;
  const merchant = tlv('00', 'A000000677010111') + tlv(t.tag, t.value);

  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', merchant) +
    tlv('53', '764') +
    (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '') +
    tlv('58', 'TH');

  payload += '6304';
  return payload + crc16(payload);
}

/** สร้าง QR พร้อมเพย์เป็น data URL */
async function buildQrDataUrl(target, amount, opts = {}) {
  const payload = buildPayload(target, amount);
  if (!payload) return null;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: opts.width || 360,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

module.exports = { buildPayload, buildQrDataUrl, normalizeTarget, crc16 };
