/**
 * ===========================================================================
 *  สร้าง QR พร้อมเพย์ตามมาตรฐาน EMVCo
 *  คำนวณในเครื่องทั้งหมด ไม่ส่งข้อมูลบัญชีออกไปยังบริการภายนอก
 * ===========================================================================
 */

/** CRC-16/CCITT-FALSE */
function crc16_(str) {
  var crc = 0xffff;
  for (var i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) << 8);
    crc &= 0xffff;
    for (var j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
    }
  }
  var hex = crc.toString(16).toUpperCase();
  return padStart_(hex, 4, '0');
}

function tlv_(id, value) {
  return String(id) + padStart_(String(value.length), 2, '0') + value;
}

/** แปลงเลขพร้อมเพย์ให้อยู่ในรูปแบบมาตรฐาน */
function normalizePromptPay_(raw) {
  var digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 13) return { tag: '02', value: digits };              // เลขประจำตัวประชาชน/นิติบุคคล
  if (digits.length === 15) return { tag: '03', value: digits };              // e-Wallet
  if (digits.length === 10) return { tag: '01', value: '0066' + digits.substring(1) };  // เบอร์โทร
  if (digits.length === 9) return { tag: '01', value: '0066' + digits };
  return null;
}

/** สร้างข้อมูลสำหรับ QR พร้อมเพย์ (ระบุยอดเงินได้) */
function promptPayPayload_(target, amount) {
  var t = normalizePromptPay_(target);
  if (!t) return null;
  var hasAmount = Number(amount) > 0;
  var merchant = tlv_('00', 'A000000677010111') + tlv_(t.tag, t.value);

  var payload =
    tlv_('00', '01') +
    tlv_('01', hasAmount ? '12' : '11') +
    tlv_('29', merchant) +
    tlv_('53', '764') +
    (hasAmount ? tlv_('54', Number(amount).toFixed(2)) : '') +
    tlv_('58', 'TH');

  payload += '6304';
  return payload + crc16_(payload);
}

/**
 * สร้าง QR เป็นรูปภาพ (data URL)
 * ใช้บริการสร้าง QR ของ Google Charts ซึ่งรับเฉพาะข้อความ payload
 * (ข้อความนี้เป็นข้อมูลสาธารณะที่พิมพ์อยู่บน QR อยู่แล้ว ไม่ใช่ข้อมูลลับ)
 * หากเรียกไม่สำเร็จ จะคืน payload กลับไปให้เบราว์เซอร์วาด QR เอง
 */
function promptPayQr_(target, amount, size) {
  var payload = promptPayPayload_(target, amount);
  if (!payload) return null;
  return { payload: payload, size: size || 320 };
}
