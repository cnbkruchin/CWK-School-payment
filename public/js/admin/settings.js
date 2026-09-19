/* ตั้งค่าระบบ บัญชีรับโอน ผู้ดูแลระบบ และบัญชีของฉัน */
'use strict';

route('settings', {
  async render(view) {
    const d = await api('/api/admin/settings');
    const s = d.settings;
    view.innerHTML = '';
    view.appendChild(pageHead('ตั้งค่าระบบ', 'ข้อมูลโรงเรียน บัญชีรับโอน และการทำงานของระบบ'));

    /* ---------------- ข้อมูลโรงเรียน ---------------- */
    const schoolForm = el('form', { id: 'schForm' }, [
      el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
        el('div', { class: 'field', style: 'margin:0' }, [
          el('label', { class: 'req', for: 'stName', text: 'ชื่อโรงเรียน' }),
          el('input', { type: 'text', id: 'stName', required: true, maxlength: '200', value: s.school_name }),
        ]),
        el('div', { class: 'field', style: 'margin:0' }, [
          el('label', { for: 'stShort', text: 'ชื่อย่อ' }),
          el('input', { type: 'text', id: 'stShort', maxlength: '80', value: s.school_short }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'stTitle', text: 'ชื่อระบบ (แสดงบนหน้าเว็บ)' }),
        el('input', { type: 'text', id: 'stTitle', maxlength: '200', value: s.system_title }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'stAddr', text: 'ที่อยู่ (ใช้บนใบเสร็จ)' }),
        el('input', { type: 'text', id: 'stAddr', maxlength: '300', value: s.school_address }),
      ]),
      el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
        el('div', { class: 'field', style: 'margin:0' }, [
          el('label', { for: 'stPhone', text: 'เบอร์โทรศัพท์' }),
          el('input', { type: 'text', id: 'stPhone', maxlength: '60', value: s.school_phone }),
        ]),
        el('div', { class: 'field', style: 'margin:0' }, [
          el('label', { for: 'stReceipt', text: 'คำนำหน้าเลขที่ใบเสร็จ' }),
          el('input', { type: 'text', id: 'stReceipt', maxlength: '10', value: s.receipt_prefix }),
          el('div', { class: 'hint', text: `เลขรันปัจจุบัน: ${s.receipt_running}` }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'stNote', text: 'ข้อความติดต่อท้ายหน้าเว็บ' }),
        el('input', { type: 'text', id: 'stNote', maxlength: '300', value: s.contact_note }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'ตราโรงเรียน (โลโก้)' }),
        el('div', { class: 'row', style: 'gap:.6rem;align-items:center' }, [
          s.school_logo ? el('img', { src: s.school_logo, style: 'width:56px;height:56px;object-fit:contain;border:1px solid var(--line);border-radius:10px;background:#fff', alt: 'โลโก้' }) : null,
          el('input', { type: 'file', id: 'stLogo', accept: 'image/*', style: 'flex:1', onchange: uploadLogo }),
          s.school_logo ? el('button', { class: 'btn btn-sm btn-red', type: 'button', text: 'ลบโลโก้', onclick: removeLogo }) : null,
        ]),
      ]),
      el('button', { class: 'btn btn-primary', type: 'submit', text: 'บันทึกข้อมูลโรงเรียน' }),
    ]);

    /* ---------------- การทำงานของระบบ ---------------- */
    const optForm = el('form', { id: 'optForm' }, [
      toggle('opPin', 'ต้องใช้รหัส PIN ยืนยันตัวตนก่อนแจ้งชำระ', 'ป้องกันไม่ให้ผู้อื่นแจ้งชำระแทนสมาชิก (แนะนำให้เปิด)', s.require_member_pin === '1'),
      toggle('opShowPin', 'แสดงรหัส PIN ของสมาชิกให้ผู้ดูแลเห็น', 'เพื่อให้ผู้ดูแลแจ้งรหัสแก่สมาชิกได้ หากปิดจะต้องรีเซ็ตรหัสใหม่เท่านั้น', s.show_pin_to_admin === '1'),
      toggle('opPublicList', 'แสดงรายชื่อผู้ต้องชำระบนหน้าสาธารณะ', 'หากปิด สมาชิกต้องเข้าผ่านเมนู "ประวัติของฉัน" ด้วยรหัสของตนเอง', s.allow_public_member_list === '1'),
      toggle('opMask', 'ปิดบังนามสกุลบนหน้าสาธารณะ', 'แสดงเป็น สมชาย ใ**ี เพื่อความเป็นส่วนตัว', s.mask_member_name === '1'),
      toggle('opDup', 'ตรวจจับสลิปซ้ำอัตโนมัติ', 'ปฏิเสธการแจ้งชำระที่ใช้ไฟล์สลิปเดิมซ้ำ (แนะนำให้เปิด)', s.detect_duplicate_slip === '1'),
      toggle('opAuto', 'อนุมัติอัตโนมัติเมื่อมีการแจ้งชำระ', '⚠ ไม่แนะนำ — ระบบจะบันทึกเป็นชำระแล้วทันทีโดยไม่ต้องตรวจสอบสลิป', s.auto_approve === '1'),
      el('div', { class: 'field' }, [
        el('label', { for: 'opSize', text: 'ขนาดไฟล์สลิปสูงสุด (MB)' }),
        el('input', { type: 'number', id: 'opSize', min: '1', max: '50', value: s.max_upload_mb }),
      ]),
      el('button', { class: 'btn btn-primary', type: 'submit', text: 'บันทึกการตั้งค่า' }),
    ]);

    view.appendChild(el('div', { class: 'grid grid-2' }, [
      el('section', { class: 'card' }, [el('h2', { style: 'font-size:1.05rem', text: '🏫 ข้อมูลโรงเรียน' }), schoolForm]),
      el('section', { class: 'card' }, [el('h2', { style: 'font-size:1.05rem', text: '⚙️ การทำงานของระบบ' }), optForm]),
    ]));

    /* ---------------- บัญชีรับโอน ---------------- */
    const bankCard = el('section', { class: 'card card-pad-0', style: 'margin-top:1rem' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { style: 'font-size:1.05rem', text: '🏦 บัญชีรับโอนและพร้อมเพย์' }),
        canWrite() ? el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: '+ เพิ่มบัญชี', onclick: () => openBankForm() }) : null,
      ]),
    ]);
    if (!d.banks.length) {
      bankCard.appendChild(emptyState('🏦', 'ยังไม่มีบัญชีรับโอน',
        'เพิ่มบัญชีธนาคารเพื่อให้สมาชิกเห็นช่องทางการโอน และระบบจะสร้าง QR พร้อมเพย์ระบุยอดให้อัตโนมัติ',
        canWrite() ? el('button', { class: 'btn btn-primary', type: 'button', text: '+ เพิ่มบัญชี', onclick: () => openBankForm() }) : null));
    } else {
      bankCard.appendChild(el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data cards' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'ธนาคาร' }), el('th', { text: 'เลขที่บัญชี' }), el('th', { text: 'ชื่อบัญชี' }),
            el('th', { class: 'mid', text: 'พร้อมเพย์' }), el('th', { class: 'mid', text: 'สถานะ' }),
            el('th', { class: 'mid', style: 'width:130px' }),
          ])]),
          el('tbody', {}, d.banks.map((b) => el('tr', {}, [
            el('td', { class: 'bold', 'data-label': 'ธนาคาร' }, [
              b.bank_name, b.is_default ? el('span', { class: 'chip', style: 'margin-inline-start:.35rem', text: 'ค่าเริ่มต้น' }) : null,
            ]),
            el('td', { class: 'mono', 'data-label': 'เลขที่บัญชี', text: b.account_number }),
            el('td', { class: 'small', 'data-label': 'ชื่อบัญชี' }, [
              b.account_name, b.branch ? el('div', { class: 'tiny muted', text: `สาขา ${b.branch}` }) : null,
            ]),
            el('td', { class: 'mid mono small', 'data-label': 'พร้อมเพย์', text: b.promptpay_id || '-' }),
            el('td', { class: 'mid', 'data-label': 'สถานะ' }, [
              el('span', { class: `badge ${b.is_active ? 'badge-open' : 'badge-closed'}`, text: b.is_active ? 'ใช้งาน' : 'ปิด' }),
            ]),
            el('td', { class: 'mid cell-full', 'data-label': '' }, [
              el('div', { class: 'row', style: 'gap:.25rem;justify-content:center' }, [
                b.promptpay_id ? el('button', { class: 'btn btn-sm', type: 'button', text: '📱 QR', onclick: () => showQr(b) }) : null,
                canWrite() ? el('button', { class: 'btn btn-sm', type: 'button', text: '✎', onclick: () => openBankForm(b) }) : null,
                canWrite() ? el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑', onclick: () => deleteBank(b) }) : null,
              ]),
            ]),
          ]))),
        ]),
      ]));
    }
    view.appendChild(bankCard);

    /* ---------------- ระบบและการสำรองข้อมูล ---------------- */
    const storage = await api('/api/admin/settings/storage');
    view.appendChild(el('section', { class: 'card', style: 'margin-top:1rem' }, [
      el('h2', { style: 'font-size:1.05rem', text: '💾 ข้อมูลระบบและการสำรองข้อมูล' }),
      el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
        miniStat('ฐานข้อมูล', fileSize(storage.database_bytes)),
        miniStat('ไฟล์สลิป', `${fileSize(storage.uploads_bytes)} (${storage.uploads_files} ไฟล์)`),
        miniStat('สมาชิก / รายการ', `${storage.counts.members} / ${storage.counts.collections}`),
        miniStat('การชำระเงิน', `${storage.counts.payments} รายการ`),
      ]),
      el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' }, [
        el('div', {}, [
          el('strong', { text: 'สถานะการส่งอีเมล: ' }),
          d.mail_mode === 'smtp'
            ? 'เชื่อมต่อ SMTP แล้ว — ลิงก์รีเซ็ตรหัสผ่านจะถูกส่งเข้าอีเมลจริง'
            : 'ยังไม่ได้ตั้งค่า SMTP — ลิงก์รีเซ็ตรหัสผ่านจะถูกบันทึกเป็นไฟล์ไว้ที่ data/outbox และแสดงใน console ของเซิร์ฟเวอร์ (ตั้งค่าได้ในไฟล์ .env)',
        ]),
      ]),
      el('div', { class: 'row', style: 'gap:.5rem' }, [
        isSuper() ? el('button', { class: 'btn', type: 'button', text: '⬇ ดาวน์โหลดไฟล์สำรองฐานข้อมูล',
          onclick: async (e) => { busy(e.target, true, 'กำลังสำรอง...'); try { await download('/api/admin/settings/backup', 'cwk-backup.db'); toast('ดาวน์โหลดไฟล์สำรองแล้ว', 'success'); } catch (ex) { toast(ex.message, 'error'); } finally { busy(e.target, false); } } }) : null,
        isSuper() ? el('button', { class: 'btn', type: 'button', text: '🧹 ลบบันทึกกิจกรรมเก่ากว่า 1 ปี', onclick: pruneLogs }) : null,
      ]),
    ]));

    schoolForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      busy(btn, true, 'กำลังบันทึก...');
      try {
        await api('/api/admin/settings', { method: 'PUT', body: {
          school_name: $('#stName').value, school_short: $('#stShort').value,
          system_title: $('#stTitle').value, school_address: $('#stAddr').value,
          school_phone: $('#stPhone').value, receipt_prefix: $('#stReceipt').value,
          contact_note: $('#stNote').value,
        } });
        ADMIN.config.school_name = $('#stName').value;
        toast('บันทึกข้อมูลโรงเรียนเรียบร้อย', 'success');
        handleRoute();
      } catch (ex) { toast(ex.message, 'error'); busy(btn, false); }
    });

    optForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      busy(btn, true, 'กำลังบันทึก...');
      try {
        await api('/api/admin/settings', { method: 'PUT', body: {
          require_member_pin: $('#opPin').checked, show_pin_to_admin: $('#opShowPin').checked,
          allow_public_member_list: $('#opPublicList').checked, mask_member_name: $('#opMask').checked,
          detect_duplicate_slip: $('#opDup').checked, auto_approve: $('#opAuto').checked,
          max_upload_mb: $('#opSize').value,
        } });
        toast('บันทึกการตั้งค่าเรียบร้อย', 'success');
        handleRoute();
      } catch (ex) { toast(ex.message, 'error'); busy(btn, false); }
    });
  },
});

function toggle(id, label, hint, checked) {
  return el('label', { class: 'check', style: 'margin-bottom:.6rem' }, [
    el('input', { type: 'checkbox', id, checked }),
    el('span', {}, [el('span', { class: 'bold', text: label }), hint ? el('div', { class: 'tiny muted', text: hint }) : null]),
  ]);
}
function miniStat(label, value) {
  return el('div', { style: 'padding:.6rem;background:var(--surface-2);border-radius:10px;text-align:center' }, [
    el('div', { class: 'tiny muted', text: label }),
    el('div', { class: 'bold', text: value }),
  ]);
}

async function uploadLogo(e) {
  if (needWrite()) return;
  const f = e.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('logo', f);
  try {
    await api('/api/admin/settings/logo', { method: 'POST', body: fd });
    toast('อัปโหลดโลโก้เรียบร้อย', 'success');
    const cfg = await api('/api/public/config');
    ADMIN.config = cfg;
    handleRoute();
  } catch (ex) { toast(ex.message, 'error'); }
}

async function removeLogo() {
  if (needWrite()) return;
  if (!(await confirmDialog({ title: 'ลบโลโก้', message: 'ต้องการลบโลโก้โรงเรียนใช่หรือไม่?', confirmText: 'ลบ', danger: true }))) return;
  try {
    await api('/api/admin/settings/logo', { method: 'DELETE' });
    ADMIN.config.school_logo = '';
    toast('ลบโลโก้แล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function pruneLogs() {
  if (!(await confirmDialog({ title: 'ลบบันทึกกิจกรรมเก่า', message: 'ต้องการลบบันทึกกิจกรรมที่เก่ากว่า 1 ปีใช่หรือไม่?', confirmText: 'ลบ', danger: true }))) return;
  try {
    const r = await api('/api/admin/settings/prune-logs', { method: 'POST', body: { days: 365 } });
    toast(`ลบบันทึกเก่า ${r.deleted} รายการแล้ว`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

/* ------------------------------ บัญชีรับโอน ------------------------------ */
function openBankForm(b) {
  if (needWrite()) return;
  const BANKS = ['ธนาคารกรุงไทย', 'ธนาคารกรุงเทพ', 'ธนาคารกสิกรไทย', 'ธนาคารไทยพาณิชย์', 'ธนาคารกรุงศรีอยุธยา',
    'ธนาคารทหารไทยธนชาต', 'ธนาคารออมสิน', 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', 'ธนาคารอาคารสงเคราะห์'];

  const form = el('form', { id: 'bForm' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'bName', text: 'ธนาคาร' }),
      el('input', { type: 'text', id: 'bName', required: true, list: 'bankList', maxlength: '120', value: b ? b.bank_name : '' }),
      el('datalist', { id: 'bankList' }, BANKS.map((x) => el('option', { value: x }))),
    ]),
    el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { class: 'req', for: 'bNumber', text: 'เลขที่บัญชี' }),
        el('input', { type: 'text', id: 'bNumber', required: true, maxlength: '40', value: b ? b.account_number : '' }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'bBranch', text: 'สาขา' }),
        el('input', { type: 'text', id: 'bBranch', maxlength: '120', value: b ? (b.branch || '') : '' }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'bAccName', text: 'ชื่อบัญชี' }),
      el('input', { type: 'text', id: 'bAccName', required: true, maxlength: '160', value: b ? b.account_name : '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'bPromptpay', text: 'เลขพร้อมเพย์ (สำหรับสร้าง QR ระบุยอดอัตโนมัติ)' }),
      el('input', { type: 'text', id: 'bPromptpay', maxlength: '40', inputmode: 'numeric', value: b ? (b.promptpay_id || '') : '', placeholder: 'เบอร์โทร 10 หลัก หรือเลขประจำตัวผู้เสียภาษี 13 หลัก' }),
      el('div', { class: 'hint', text: 'เว้นว่างได้หากไม่ต้องการใช้ QR พร้อมเพย์' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'bNote', text: 'หมายเหตุ' }),
      el('input', { type: 'text', id: 'bNote', maxlength: '255', value: b ? (b.note || '') : '' }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'bDefault', checked: b ? !!b.is_default : true }),
      el('span', { text: 'ตั้งเป็นบัญชีหลัก (แสดงเป็นตัวเลือกแรก)' }),
    ]),
    b ? el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'bActive', checked: !!b.is_active }),
      el('span', { text: 'เปิดใช้งาน' }),
    ]) : null,
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'bForm', text: b ? 'บันทึก' : 'เพิ่มบัญชี' });
  const m = modal({
    title: b ? 'แก้ไขบัญชีรับโอน' : 'เพิ่มบัญชีรับโอน', body: form,
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true);
    const payload = {
      bank_name: $('#bName', form).value, account_number: $('#bNumber', form).value,
      branch: $('#bBranch', form).value, account_name: $('#bAccName', form).value,
      promptpay_id: $('#bPromptpay', form).value, note: $('#bNote', form).value,
      is_default: $('#bDefault', form).checked,
    };
    if (b) payload.is_active = $('#bActive', form).checked;
    try {
      if (b) await api(`/api/admin/settings/banks/${b.id}`, { method: 'PUT', body: payload });
      else await api('/api/admin/settings/banks', { method: 'POST', body: payload });
      m.close();
      toast('บันทึกเรียบร้อย', 'success');
      handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

async function deleteBank(b) {
  if (needWrite()) return;
  if (!(await confirmDialog({ title: 'ลบบัญชีรับโอน', danger: true, confirmText: 'ลบ', message: `ต้องการลบบัญชี ${b.bank_name} ${b.account_number} ใช่หรือไม่?` }))) return;
  try {
    await api(`/api/admin/settings/banks/${b.id}`, { method: 'DELETE' });
    toast('ลบบัญชีแล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function showQr(b) {
  const amountInput = el('input', { type: 'number', step: '0.01', min: '0', value: '0', placeholder: 'ระบุยอด (0 = ไม่ระบุ)' });
  const qrBox = el('div', { class: 'qr-box' });
  const load = async () => {
    qrBox.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      const r = await api(`/api/admin/settings/banks/${b.id}/qr?amount=${amountInput.value || 0}`);
      qrBox.innerHTML = '';
      qrBox.appendChild(el('img', { src: r.qr, alt: 'QR พร้อมเพย์' }));
      qrBox.appendChild(el('div', { class: 'small', style: 'color:#0f172a;margin-top:.4rem', text: `${b.account_name} • ${b.promptpay_id}` }));
    } catch (e) { qrBox.innerHTML = ''; qrBox.appendChild(el('div', { class: 'alert alert-error' }, [e.message])); }
  };
  amountInput.addEventListener('change', load);

  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', { text: 'จำนวนเงิน (บาท)' }), amountInput]),
    qrBox,
  ]);
  const m = modal({
    title: `QR พร้อมเพย์ — ${b.bank_name}`, body, size: 'modal-sm',
    footer: [el('button', { class: 'btn btn-primary', type: 'button', text: 'ปิด', onclick: () => m.close() })],
  });
  load();
}

/* ============================== ผู้ดูแลระบบ ============================== */
route('users', {
  superOnly: true,
  async render(view) {
    const d = await api('/api/admin/users');
    view.innerHTML = '';
    view.appendChild(pageHead('ผู้ดูแลระบบ', 'จัดการบัญชีผู้ดูแลและสิทธิ์การใช้งาน', [
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ เพิ่มผู้ดูแล', onclick: () => openUserForm(null, d.roles) }),
    ]));

    view.appendChild(el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' }, [
      el('div', {}, [
        el('strong', { text: 'ระดับสิทธิ์: ' }),
        el('div', { class: 'small', style: 'margin-top:.25rem' }, [
          el('div', { text: '• ผู้ดูแลระบบสูงสุด — ใช้งานได้ทุกอย่าง รวมถึงจัดการผู้ดูแลและสำรองข้อมูล' }),
          el('div', { text: '• ผู้ดูแลระบบ — จัดการสมาชิก รายการจัดเก็บ และตรวจสอบการชำระเงินได้' }),
          el('div', { text: '• ผู้ดูรายงาน — ดูข้อมูลและออกรายงานได้เท่านั้น แก้ไขข้อมูลไม่ได้' }),
        ]),
      ]),
    ]));

    view.appendChild(el('section', { class: 'card card-pad-0' }, [
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data cards' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'ชื่อผู้ใช้' }), el('th', { text: 'ชื่อ-สกุล' }), el('th', { text: 'อีเมล' }),
            el('th', { class: 'mid', text: 'สิทธิ์' }), el('th', { class: 'mid', text: 'เข้าใช้ล่าสุด' }),
            el('th', { class: 'mid', text: 'สถานะ' }), el('th', { class: 'mid', style: 'width:150px' }),
          ])]),
          el('tbody', {}, d.users.map((u) => el('tr', {}, [
            el('td', { class: 'mono bold', 'data-label': 'ชื่อผู้ใช้' }, [
              u.username, u.id === d.me ? el('span', { class: 'chip', style: 'margin-inline-start:.35rem', text: 'คุณ' }) : null,
            ]),
            el('td', { 'data-label': 'ชื่อ-สกุล', text: u.full_name }),
            el('td', { class: 'small', 'data-label': 'อีเมล', text: u.email }),
            el('td', { class: 'mid', 'data-label': 'สิทธิ์' }, [
              el('span', { class: `badge ${u.role === 'superadmin' ? 'badge-partial' : u.role === 'admin' ? 'badge-open' : 'badge-draft'}`, text: u.role_label }),
            ]),
            el('td', { class: 'mid small muted', 'data-label': 'เข้าใช้ล่าสุด', text: u.last_login_at ? relativeTime(u.last_login_at) : 'ยังไม่เคย' }),
            el('td', { class: 'mid', 'data-label': 'สถานะ' }, [
              el('span', { class: `badge ${u.is_active ? 'badge-open' : 'badge-closed'}`, text: u.is_active ? 'ใช้งาน' : 'ระงับ' }),
              u.locked ? el('div', { class: 'tiny', style: 'color:var(--red-600)', text: '🔒 ถูกล็อก' }) : null,
            ]),
            el('td', { class: 'mid cell-full', 'data-label': '' }, [
              el('div', { class: 'row', style: 'gap:.25rem;justify-content:center' }, [
                el('button', { class: 'btn btn-sm', type: 'button', text: '✎', title: 'แก้ไข', onclick: () => openUserForm(u, d.roles) }),
                el('button', { class: 'btn btn-sm', type: 'button', text: '🔑', title: 'ตั้งรหัสผ่านใหม่', onclick: () => resetUserPassword(u) }),
                u.locked ? el('button', { class: 'btn btn-sm btn-amber', type: 'button', text: '🔓', title: 'ปลดล็อก', onclick: () => unlockUser(u) }) : null,
                u.id !== d.me ? el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑', title: 'ลบ', onclick: () => deleteUser(u) }) : null,
              ]),
            ]),
          ]))),
        ]),
      ]),
    ]));
  },
});

function openUserForm(u, roles) {
  const form = el('form', { id: 'uForm', autocomplete: 'off' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'uUser', text: 'ชื่อผู้ใช้ (ภาษาอังกฤษ)' }),
      el('input', { type: 'text', id: 'uUser', required: true, maxlength: '80', value: u ? u.username : '', readonly: !!u, autocapitalize: 'none', pattern: '[a-z0-9._-]{3,80}' }),
      u ? el('div', { class: 'hint', text: 'ไม่สามารถเปลี่ยนชื่อผู้ใช้ได้' }) : el('div', { class: 'hint', text: 'ตัวอักษรภาษาอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง ความยาว 3-80 ตัว' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'uName', text: 'ชื่อ-สกุล' }),
      el('input', { type: 'text', id: 'uName', required: true, maxlength: '160', value: u ? u.full_name : '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'uEmail', text: 'อีเมล' }),
      el('input', { type: 'email', id: 'uEmail', required: true, maxlength: '160', value: u ? u.email : '', autocapitalize: 'none' }),
      el('div', { class: 'hint', text: 'ใช้สำหรับรับลิงก์ตั้งรหัสผ่านใหม่กรณีลืมรหัสผ่าน — ต้องเป็นอีเมลที่เข้าถึงได้จริง' }),
    ]),
    el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'uRole', text: 'ระดับสิทธิ์' }),
        el('select', { id: 'uRole' }, roles.map((r) => el('option', { value: r.value, text: r.label, selected: u && u.role === r.value }))),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'uPhone', text: 'เบอร์โทร' }),
        el('input', { type: 'tel', id: 'uPhone', maxlength: '40', value: u ? (u.phone || '') : '' }),
      ]),
    ]),
    !u ? el('div', { class: 'field' }, [
      el('label', { for: 'uPass', text: 'รหัสผ่าน' }),
      el('input', { type: 'text', id: 'uPass', minlength: '8', maxlength: '72', placeholder: 'เว้นว่างเพื่อให้ระบบสร้างให้อัตโนมัติ' }),
      el('div', { class: 'hint', text: 'อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข' }),
    ]) : null,
    u ? el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'uActive', checked: !!u.is_active }),
      el('span', { text: 'เปิดใช้งานบัญชี' }),
    ]) : el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'uMustChange', checked: true }),
      el('span', { text: 'บังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งแรก' }),
    ]),
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'uForm', text: u ? 'บันทึก' : 'เพิ่มผู้ดูแล' });
  const m = modal({
    title: u ? `แก้ไขผู้ดูแล — ${u.username}` : 'เพิ่มผู้ดูแลระบบ', body: form,
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังบันทึก...');
    const payload = {
      username: $('#uUser', form).value.toLowerCase(), full_name: $('#uName', form).value,
      email: $('#uEmail', form).value, role: $('#uRole', form).value, phone: $('#uPhone', form).value,
    };
    if (u) payload.is_active = $('#uActive', form).checked;
    else {
      payload.password = $('#uPass', form).value;
      payload.must_change_pw = $('#uMustChange', form).checked;
    }
    try {
      const r = u
        ? await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: payload })
        : await api('/api/admin/users', { method: 'POST', body: payload });
      m.close();
      if (r.password) showGeneratedPassword(r.username, r.password);
      else toast('บันทึกเรียบร้อย', 'success');
      handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

function showGeneratedPassword(username, password) {
  const body = el('div', {}, [
    el('div', { class: 'alert alert-warn', style: 'margin-bottom:1rem' },
      ['กรุณาคัดลอกรหัสผ่านนี้แจ้งแก่ผู้ใช้ทันที เนื่องจากจะไม่แสดงอีก']),
    el('div', { class: 'credential-box center' }, [
      el('div', { class: 'small', text: `ชื่อผู้ใช้: ${username}` }),
      el('div', { class: 'code', text: password }),
    ]),
  ]);
  const m = modal({
    title: 'รหัสผ่านที่ระบบสร้างให้', body, size: 'modal-sm',
    footer: [
      el('button', { class: 'btn', type: 'button', text: '📋 คัดลอก', onclick: async () => toast(await copyText(password) ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ', 'success') }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'เสร็จสิ้น', onclick: () => m.close() }),
    ],
  });
}

async function resetUserPassword(u) {
  const input = el('input', { type: 'text', id: 'rpPass', minlength: '8', placeholder: 'เว้นว่างเพื่อให้ระบบสร้างให้' });
  const body = el('div', {}, [
    el('p', { class: 'small', text: `ตั้งรหัสผ่านใหม่ให้ ${u.full_name} (${u.username}) — ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งถัดไป` }),
    el('div', { class: 'field' }, [el('label', { text: 'รหัสผ่านใหม่' }), input]),
  ]);
  const m = modal({
    title: 'ตั้งรหัสผ่านใหม่', body, size: 'modal-sm',
    footer: [
      el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'ตั้งรหัสผ่านใหม่', onclick: async (e) => {
        busy(e.target, true);
        try {
          const r = await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', body: { password: input.value } });
          m.close();
          if (r.password) showGeneratedPassword(r.username, r.password);
          else toast('ตั้งรหัสผ่านใหม่เรียบร้อย', 'success');
        } catch (ex) { toast(ex.message, 'error'); busy(e.target, false); }
      } }),
    ],
  });
}

async function unlockUser(u) {
  try {
    await api(`/api/admin/users/${u.id}/unlock`, { method: 'POST', body: {} });
    toast('ปลดล็อกบัญชีแล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteUser(u) {
  if (!(await confirmDialog({ title: 'ลบผู้ดูแลระบบ', danger: true, confirmText: 'ลบ', message: `ต้องการลบบัญชี ${u.username} (${u.full_name}) ใช่หรือไม่?` }))) return;
  try {
    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    toast('ลบบัญชีแล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

/* ============================== บัญชีของฉัน ============================== */
route('profile', {
  async render(view) {
    const d = await api('/api/admin/me');
    const u = d.admin;
    view.innerHTML = '';
    view.appendChild(pageHead('บัญชีของฉัน', 'ข้อมูลผู้ใช้และการเปลี่ยนรหัสผ่าน'));

    if (u.must_change_pw) {
      view.appendChild(el('div', { class: 'alert alert-warn', style: 'margin-bottom:1rem' },
        [el('div', {}, [el('strong', { text: 'กรุณาเปลี่ยนรหัสผ่าน ' }), 'บัญชีนี้ยังใช้รหัสผ่านที่ผู้ดูแลตั้งให้ กรุณาตั้งรหัสผ่านใหม่เพื่อความปลอดภัย'])]));
    }

    const pwForm = el('form', { id: 'pwForm', autocomplete: 'off' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'req', for: 'cpCur', text: 'รหัสผ่านปัจจุบัน' }),
        el('input', { type: 'password', id: 'cpCur', required: true, autocomplete: 'current-password' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'req', for: 'cpNew', text: 'รหัสผ่านใหม่' }),
        el('input', { type: 'password', id: 'cpNew', required: true, minlength: '8', autocomplete: 'new-password' }),
        el('div', { class: 'hint', text: 'อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'req', for: 'cpConf', text: 'ยืนยันรหัสผ่านใหม่' }),
        el('input', { type: 'password', id: 'cpConf', required: true, minlength: '8', autocomplete: 'new-password' }),
      ]),
      el('button', { class: 'btn btn-primary', type: 'submit', text: 'เปลี่ยนรหัสผ่าน' }),
    ]);

    view.appendChild(el('div', { class: 'grid grid-2' }, [
      el('section', { class: 'card' }, [
        el('h2', { style: 'font-size:1.05rem', text: '👤 ข้อมูลผู้ใช้' }),
        el('dl', { class: 'kv' }, [
          el('dt', { text: 'ชื่อผู้ใช้' }), el('dd', { class: 'mono', text: u.username }),
          el('dt', { text: 'ชื่อ-สกุล' }), el('dd', { text: u.full_name }),
          el('dt', { text: 'อีเมล' }), el('dd', { text: u.email }),
          el('dt', { text: 'ระดับสิทธิ์' }), el('dd', {}, [el('span', { class: 'badge badge-open', text: ROLE_LABEL[u.role] || u.role })]),
          el('dt', { text: 'เบอร์โทร' }), el('dd', { text: u.phone || '-' }),
          el('dt', { text: 'เข้าใช้ล่าสุด' }), el('dd', { text: u.last_login_at ? thaiDate(u.last_login_at, { withTime: true }) : '-' }),
        ]),
        el('div', { class: 'hint', style: 'margin-top:.8rem', text: 'หากต้องการเปลี่ยนอีเมล กรุณาติดต่อผู้ดูแลระบบสูงสุด' }),
      ]),
      el('section', { class: 'card' }, [el('h2', { style: 'font-size:1.05rem', text: '🔒 เปลี่ยนรหัสผ่าน' }), pwForm]),
    ]));

    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      busy(btn, true, 'กำลังบันทึก...');
      try {
        await api('/api/admin/change-password', { method: 'POST', body: {
          current_password: $('#cpCur').value, new_password: $('#cpNew').value, confirm_password: $('#cpConf').value,
        } });
        toast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว', 'success');
        ADMIN.user.must_change_pw = 0;
        handleRoute();
      } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
    });
  },
});
