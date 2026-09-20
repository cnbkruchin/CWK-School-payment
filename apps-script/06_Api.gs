/**
 * ===========================================================================
 *  ตัวครอบการเรียก API ทุกฟังก์ชัน
 *
 *  เหตุผลที่ต้องคืนค่าเป็น { ok, data, error } แทนการโยนข้อผิดพลาด:
 *  google.script.run จะตัดรายละเอียดข้อผิดพลาดทิ้งเกือบทั้งหมด ทำให้ผู้ใช้
 *  เห็นเพียงข้อความทั่วไปที่ไม่ช่วยอะไร การคืนค่าแบบนี้ทำให้แสดงข้อความ
 *  ภาษาไทยที่เข้าใจง่ายได้เสมอ
 * ===========================================================================
 */

function apiCall_(name, fn) {
  var started = Date.now();
  try {
    var data = fn();
    return { ok: true, data: data, ms: Date.now() - started };
  } catch (e) {
    var message;
    var code = 'ERROR';

    if (e && e.isAppError) {
      message = e.message;
      code = e.code || 'ERROR';
    } else {
      var raw = e && e.message ? String(e.message) : String(e);
      Logger.log('[' + name + '] ' + raw + (e && e.stack ? '\n' + e.stack : ''));

      // แปลงข้อผิดพลาดของ Google ให้เป็นภาษาไทยที่เข้าใจง่าย
      if (/lock|Lock/.test(raw)) {
        message = 'ระบบกำลังมีผู้ใช้งานพร้อมกันจำนวนมาก กรุณารอสักครู่แล้วลองใหม่';
        code = 'BUSY';
      } else if (/quota|Quota|limit|Limit/.test(raw)) {
        message = 'ระบบใช้งานเกินโควตาของ Google ในขณะนี้ กรุณาลองใหม่ในภายหลัง';
        code = 'QUOTA';
      } else if (/timed out|Timeout|exceeded maximum execution/.test(raw)) {
        message = 'การทำงานใช้เวลานานเกินไป กรุณาลดจำนวนข้อมูลแล้วลองใหม่';
        code = 'TIMEOUT';
      } else if (/permission|Permission|authoriz/i.test(raw)) {
        message = 'ระบบไม่มีสิทธิ์เข้าถึงข้อมูลที่จำเป็น กรุณาให้ผู้ติดตั้งอนุญาตสิทธิ์อีกครั้ง';
        code = 'PERMISSION';
      } else {
        message = 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง';
      }
    }
    return { ok: false, error: message, code: code, ms: Date.now() - started };
  }
}
