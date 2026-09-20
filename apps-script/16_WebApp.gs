/**
 * ===========================================================================
 *  จุดเข้าเว็บแอป — เสิร์ฟหน้าเว็บทั้งหมด
 *
 *  เคล็ดลับความเร็วที่สำคัญที่สุดของหน้าเว็บ Apps Script:
 *  ฝังข้อมูลตั้งต้นลงในหน้า HTML ไปเลยตั้งแต่ตอนโหลด ทำให้ผู้ใช้เห็นข้อมูล
 *  ทันทีโดยไม่ต้องรอเรียก google.script.run อีกรอบ (ประหยัดได้ 1-2 วินาที)
 * ===========================================================================
 */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var page = String(params.page || '').toLowerCase();

  try {
    if (page === 'admin') return renderPage_('Admin', 'ผู้ดูแลระบบ', { page: 'admin' });
    if (page === 'reset') {
      return renderPage_('Admin', 'ตั้งรหัสผ่านใหม่', { page: 'reset', token: String(params.token || '') });
    }
    return renderPage_('Index', null, {
      page: 'public',
      view: page || 'home',
      id: params.id || '',
      ref: params.ref || ''
    });
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:2rem;max-width:640px;margin:auto">' +
      '<h2>ยังไม่ได้ติดตั้งระบบ</h2>' +
      '<p>กรุณาเปิดไฟล์ Google Sheets ของระบบ แล้วเลือกเมนู ' +
      '<b>ระบบแจ้งชำระเงิน → ติดตั้ง/ตรวจสอบระบบ</b> หนึ่งครั้งก่อนใช้งาน</p>' +
      '<p style="color:#64748b;font-size:.9rem">รายละเอียดข้อผิดพลาด: ' + escapeHtml_(err.message) + '</p></div>'
    ).setTitle('ยังไม่ได้ติดตั้งระบบ');
  }
}

function renderPage_(templateName, titleSuffix, initial) {
  var cfg = publicConfig_();
  var tpl = HtmlService.createTemplateFromFile(templateName);

  // ข้อมูลที่ฝังไปกับหน้าเว็บตั้งแต่แรก
  var boot = { config: cfg, initial: initial || {}, version: APP.VERSION };
  if (initial && initial.page === 'public') {
    try {
      if (initial.view === 'collection' && initial.id) {
        var r = apiPublicCollection({ id: initial.id });
        if (r.ok) boot.collection = r.data;
      } else if (!initial.view || initial.view === 'home') {
        var rc = apiPublicCollections();
        if (rc.ok) boot.collections = rc.data.collections;
      }
    } catch (e) {
      Logger.log('เตรียมข้อมูลตั้งต้นไม่สำเร็จ: ' + e.message);
    }
  }

  tpl.BOOT = JSON.stringify(boot);
  var title = cfg.school_name + (titleSuffix ? ' — ' + titleSuffix : ' — ' + cfg.system_title);

  return tpl.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** แทรกไฟล์ HTML อื่นเข้ามาในหน้า (ใช้ใน template) */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function escapeHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** ที่อยู่เว็บแอปสำหรับสร้างลิงก์ภายในระบบ */
function apiWebAppUrl() {
  return apiCall_('webAppUrl', function () { return { url: webAppUrl_() }; });
}
