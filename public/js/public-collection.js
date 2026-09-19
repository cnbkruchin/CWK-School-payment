/* หน้ารายชื่อผู้ต้องชำระ + แจ้งชำระเงิน (หัวใจของระบบรับแจ้ง) */
'use strict';

const COLLECTION_ID = qs('id');
let DATA = null;
let CONFIG = { require_member_pin: true, max_upload_mb: 10 };
let filters = { q: '', group: '', status: '' };

/* ------------------------------- โหลดข้อมูล ------------------------------- */
async function loadConfig() {
  try {
    CONFIG = await api('/api/public/config');
    $('#schoolName').textContent = CONFIG.school_name;
    $('#contactNote').textContent = CONFIG.contact_note || '';
    if (CONFIG.school_logo) {
      $('#brandLogo').innerHTML = '';
      $('#brandLogo').appendChild(el('img', { src: CONFIG.school_logo, alt: 'ตราโรงเรียน' }));
    }
  } catch { /* ใช้ค่าเริ่มต้น */ }
}

async function load(showSpinner = true) {
  const box = $('#content');
  if (showSpinner) box.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังโหลดข้อมูล...</div>';
  try {
    DATA = await api(`/api/public/collections/${encodeURIComponent(COLLECTION_ID)}`);
    document.title = `${DATA.collection.name} — ${CONFIG.school_name || 'โรงเรียนทุนวิทยาคม'}`;
    render();
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'alert alert-error' }, [e.message]),
      el('p', { style: 'margin-top:1rem' }, [el('a', { class: 'btn', href: '/', text: '← กลับหน้าแรก' })]),
    ]));
  }
}

/* --------------------------------- แสดงผล --------------------------------- */
function render() {
  const c = DATA.collection;
  const s = DATA.summary;
  const box = $('#content');
  box.innerHTML = '';

  const isOpen = c.status === 'open';
  const overdue = c.due_date && new Date(c.due_date + 'T23:59:59') < new Date();

  /* ---- หัวเรื่อง ---- */
  box.appendChild(el('section', { class: 'card' }, [
    el('div', { class: 'row', style: 'gap:.4rem;margin-bottom:.4rem' }, [
      el('a', { href: '/', class: 'btn btn-ghost btn-sm no-print', text: '← ทั้งหมด' }),
      el('span', { class: 'chip', text: c.code }),
      el('span', { class: `badge badge-${c.status}`, text: isOpen ? 'เปิดรับชำระ' : 'ปิดรับชำระ' }),
      overdue && isOpen ? el('span', { class: 'badge badge-unpaid', text: 'เลยกำหนดชำระแล้ว' }) : null,
    ]),
    el('h1', { style: 'margin:.2rem 0', text: c.name }),
    c.description ? el('p', { class: 'muted', style: 'margin:.2rem 0', text: c.description }) : null,
    el('div', { class: 'row small muted', style: 'gap:1.1rem;margin-top:.4rem' }, [
      c.fiscal_year ? el('span', { text: `ปีการศึกษา ${c.fiscal_year}` }) : null,
      c.term ? el('span', { text: `ภาคเรียนที่ ${c.term}` }) : null,
      c.due_date ? el('span', { text: `กำหนดชำระภายใน ${thaiDate(c.due_date)}` }) : null,
    ]),

    DATA.items.length ? el('div', { style: 'margin-top:.9rem' }, [
      el('div', { class: 'label', text: 'รายละเอียดกิจกรรมย่อยของการจัดเก็บ' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('tbody', {}, DATA.items.map((it) =>
            el('tr', {}, [
              el('td', {}, [
                el('span', { text: it.name }),
                it.is_optional ? el('span', { class: 'chip', style: 'margin-right:.4rem', text: 'เลือกได้' }) : null,
                it.description ? el('div', { class: 'tiny muted', text: it.description }) : null,
              ]),
              el('td', { class: 'num', text: `${money(it.amount)} บาท` }),
            ])),
          ),
        ]),
      ]),
    ]) : null,
  ]));

  /* ---- สรุปสถานะ ---- */
  box.appendChild(el('div', { class: 'grid grid-4' }, [
    statCard('ผู้ต้องชำระทั้งหมด', `${s.total_members}`, 'คน', ''),
    statCard('ชำระแล้ว', `${s.count_paid}`, 'คน', 'is-green'),
    statCard('รอตรวจสอบ', `${s.count_pending}`, 'คน', 'is-amber'),
    statCard('ยังไม่ชำระ', `${s.count_unpaid + s.count_rejected}`, 'คน', 'is-red'),
  ]));

  box.appendChild(el('section', { class: 'card' }, [
    el('div', { class: 'row-between', style: 'margin-bottom:.5rem' }, [
      el('span', { class: 'small bold', text: `ยอดที่เก็บได้ ${money(s.total_paid)} จาก ${money(s.total_due)} บาท` }),
      el('span', { class: 'small muted', text: `คงค้าง ${money(s.total_outstanding)} บาท (${s.percent_paid}%)` }),
    ]),
    el('div', { class: 'progress' }, [el('span', { style: `width:${Math.min(100, s.percent_paid)}%` })]),
  ]));

  /* ---- ตารางรายชื่อ ---- */
  if (DATA.list_hidden) {
    box.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'alert alert-info' }, ['ผู้ดูแลระบบปิดการแสดงรายชื่อสาธารณะไว้ กรุณาใช้เมนู "ประวัติของฉัน" เพื่อดูรายการที่ต้องชำระของท่าน']),
      el('p', { style: 'margin-top:1rem' }, [el('a', { class: 'btn btn-primary', href: '/my.html', text: 'เข้าสู่ประวัติของฉัน' })]),
    ]));
    return;
  }

  const card = el('section', { class: 'card card-pad-0' });
  card.appendChild(el('div', { class: 'card-head no-print' }, [
    el('h2', { style: 'font-size:1.1rem', text: 'รายชื่อผู้ต้องชำระ' }),
    el('div', { class: 'row', style: 'gap:.5rem' }, [
      el('span', { class: 'small muted', id: 'rowCount' }),
      el('button', { class: 'btn btn-sm', type: 'button', text: '🖨 พิมพ์', onclick: () => window.print() }),
    ]),
  ]));

  card.appendChild(el('div', { class: 'board-filters no-print' }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'searchBox', text: 'ค้นหา' }),
      el('input', {
        type: 'search', id: 'searchBox', placeholder: 'ชื่อ หรือรหัสสมาชิก...', value: filters.q,
        oninput: debounce((e) => { filters.q = e.target.value; renderRows(); }, 200),
      }),
    ]),
    DATA.groups.length > 1 ? el('div', { class: 'field' }, [
      el('label', { for: 'groupSel', text: 'กลุ่ม/ชั้น' }),
      el('select', { id: 'groupSel', onchange: (e) => { filters.group = e.target.value; renderRows(); } }, [
        el('option', { value: '', text: 'ทุกกลุ่ม/ชั้น' }),
        ...DATA.groups.map((g) => el('option', { value: String(g.id), text: g.name, selected: String(g.id) === filters.group })),
      ]),
    ]) : null,
    el('div', { class: 'field' }, [
      el('label', { for: 'statusSel', text: 'สถานะ' }),
      el('select', { id: 'statusSel', onchange: (e) => { filters.status = e.target.value; renderRows(); } }, [
        el('option', { value: '', text: 'ทุกสถานะ' }),
        el('option', { value: 'unpaid', text: 'ยังไม่ชำระ' }),
        el('option', { value: 'pending', text: 'รอตรวจสอบ' }),
        el('option', { value: 'paid', text: 'ชำระแล้ว' }),
        el('option', { value: 'rejected', text: 'ไม่ผ่านการตรวจสอบ' }),
      ]),
    ]),
  ]));

  card.appendChild(el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data cards', id: 'boardTable' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { class: 'mid', style: 'width:60px', text: 'ลำดับ' }),
          el('th', { text: 'รหัส' }),
          el('th', { text: 'ชื่อ-สกุล' }),
          el('th', { class: 'mid', text: 'กลุ่ม/ชั้น' }),
          el('th', { class: 'num', text: 'ยอดที่ต้องชำระ' }),
          el('th', { class: 'mid', text: 'สถานะ' }),
          el('th', { class: 'mid no-print', style: 'width:180px', text: 'การแจ้งชำระ' }),
        ]),
      ]),
      el('tbody', { id: 'boardBody' }),
    ]),
  ]));
  box.appendChild(card);
  renderRows();
}

function statCard(label, value, unit, cls) {
  return el('div', { class: `stat ${cls}` }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value' }, [value, el('span', { style: 'font-size:.9rem;font-weight:600;color:var(--muted)', text: ' ' + unit })]),
  ]);
}

function filtered() {
  let rows = DATA.members;
  if (filters.group) rows = rows.filter((m) => String(m.group_name || '') === (DATA.groups.find((g) => String(g.id) === filters.group)?.name || ''));
  if (filters.status) rows = rows.filter((m) => m.status === filters.status);
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    rows = rows.filter((m) =>
      String(m.name).toLowerCase().includes(q) ||
      String(m.member_code).toLowerCase().includes(q) ||
      String(m.group_name || '').toLowerCase().includes(q));
  }
  return rows;
}

function renderRows() {
  const tbody = $('#boardBody');
  if (!tbody) return;
  const rows = filtered();
  tbody.innerHTML = '';
  const counter = $('#rowCount');
  if (counter) counter.textContent = `แสดง ${rows.length} จาก ${DATA.members.length} รายชื่อ`;

  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [
      el('td', { colspan: '7', class: 'empty', style: 'display:table-cell;text-align:center' }, [
        el('span', { class: 'empty-icon', text: '🔍' }),
        el('div', { text: 'ไม่พบรายชื่อที่ตรงกับเงื่อนไขการค้นหา' }),
      ]),
    ]));
    return;
  }

  const isOpen = DATA.collection.status === 'open';
  rows.forEach((m, i) => {
    const meta = STATUS_META[m.status] || STATUS_META.unpaid;
    const canPay = isOpen && ['unpaid', 'rejected', 'partial'].includes(m.status);

    const btn = el('button', {
      class: `btn btn-sm btn-status ${meta.btn}`, type: 'button',
      text: canPay ? meta.action : meta.action,
      onclick: () => (canPay ? openSubmitModal(m) : openInfoModal(m)),
    });

    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mid mono', 'data-label': 'ลำดับ', text: String(i + 1) }),
      el('td', { 'data-label': 'รหัส', class: 'mono', text: m.member_code }),
      el('td', { 'data-label': 'ชื่อ-สกุล' }, [
        el('span', { class: 'bold', text: m.name }),
        m.status === 'rejected' && m.last_reject_reason
          ? el('div', { class: 'tiny', style: 'color:var(--red-600)', text: `เหตุผล: ${m.last_reject_reason}` }) : null,
        m.status === 'partial'
          ? el('div', { class: 'tiny muted', text: `ชำระแล้ว ${money(m.paid_amount)} คงเหลือ ${money(m.outstanding)} บาท` }) : null,
      ]),
      el('td', { class: 'mid', 'data-label': 'กลุ่ม/ชั้น', text: m.group_name || '-' }),
      el('td', { class: 'num', 'data-label': 'ยอดที่ต้องชำระ', text: money(m.amount_due) }),
      el('td', { class: 'mid', 'data-label': 'สถานะ' }, [statusBadge(m.status, m.status_label)]),
      el('td', { class: 'mid no-print cell-full', 'data-label': 'การแจ้งชำระ' }, [btn]),
    ]));
  });
}

/* --------------------------- ป๊อปอัปแจ้งชำระเงิน --------------------------- */
async function openSubmitModal(member) {
  let detail;
  try {
    detail = await api(`/api/public/assignments/${member.assignment_id}`);
  } catch (e) { return toast(e.message, 'error'); }

  const a = detail.assignment;
  const needPin = detail.require_pin;
  const maxMb = CONFIG.max_upload_mb || 10;

  const form = el('form', { id: 'payForm', autocomplete: 'off' });

  /* ข้อมูลผู้ชำระ */
  form.appendChild(el('div', { class: 'card', style: 'background:var(--surface-2);margin-bottom:1rem;padding:.9rem' }, [
    el('dl', { class: 'kv' }, [
      el('dt', { text: 'ชื่อ-สกุล' }), el('dd', { text: a.name }),
      el('dt', { text: 'รหัสสมาชิก' }), el('dd', { class: 'mono', text: a.member_code }),
      a.group_name ? el('dt', { text: 'กลุ่ม/ชั้น' }) : null,
      a.group_name ? el('dd', { text: a.group_name }) : null,
      el('dt', { text: 'ยอดที่ต้องชำระ' }),
      el('dd', { style: 'color:var(--red-600);font-size:1.25rem;font-weight:800', text: `${money(a.outstanding)} บาท` }),
    ]),
  ]));

  /* กิจกรรมย่อย */
  if (detail.items.length) {
    form.appendChild(el('details', { class: 'card', style: 'margin-bottom:1rem;padding:.75rem .9rem' }, [
      el('summary', { style: 'cursor:pointer;font-weight:700;font-size:.9rem', text: `รายละเอียดที่ต้องชำระ (${detail.items.length} รายการ)` }),
      el('div', { class: 'table-wrap', style: 'margin-top:.5rem' }, [
        el('table', { class: 'data' }, [
          el('tbody', {}, detail.items.map((it) =>
            el('tr', {}, [el('td', { text: it.name }), el('td', { class: 'num', text: money(it.amount) })]))),
        ]),
      ]),
    ]));
  }

  /* ช่องทางการโอน */
  const banksBox = el('div', { style: 'margin-bottom:1rem' });
  if (DATA.banks.length) {
    banksBox.appendChild(el('div', { class: 'label', text: 'ช่องทางการโอนเงิน' }));
    const sel = el('select', { name: 'bank_account_id', id: 'bankSel' },
      DATA.banks.map((b) => el('option', { value: String(b.id), text: `${b.bank_name} • ${b.account_number} (${b.account_name})` })));
    banksBox.appendChild(sel);
    const qrBox = el('div', { id: 'qrBox', style: 'margin-top:.75rem' });
    banksBox.appendChild(qrBox);

    const showQr = async () => {
      const bank = DATA.banks.find((b) => String(b.id) === sel.value);
      qrBox.innerHTML = '';
      if (!bank) return;
      qrBox.appendChild(el('div', { class: 'small muted', style: 'margin-bottom:.35rem' }, [
        el('span', { text: `ชื่อบัญชี: ${bank.account_name}` }),
        bank.branch ? el('span', { text: ` • สาขา ${bank.branch}` }) : null,
      ]));
      if (!bank.has_promptpay) return;
      qrBox.appendChild(el('div', { class: 'loading', style: 'padding:1rem' }, [el('span', { class: 'spinner' }), ' กำลังสร้าง QR...']));
      try {
        const r = await api(`/api/public/promptpay-qr?bank=${bank.id}&amount=${a.outstanding}`);
        qrBox.innerHTML = '';
        qrBox.appendChild(el('div', { class: 'qr-box' }, [
          el('div', { class: 'small bold', style: 'color:#0f172a;margin-bottom:.4rem', text: 'สแกนจ่ายด้วยพร้อมเพย์' }),
          el('img', { src: r.qr, alt: 'QR พร้อมเพย์' }),
          el('div', { class: 'tiny', style: 'color:#475569;margin-top:.35rem', text: `${r.bank.account_name} • ${money(r.amount)} บาท` }),
        ]));
      } catch { qrBox.innerHTML = ''; }
    };
    sel.addEventListener('change', showQr);
    showQr();
  }
  form.appendChild(banksBox);

  /* ฟิลด์กรอก */
  form.appendChild(el('div', { class: 'field' }, [
    el('label', { class: 'req', for: 'slipFile', text: 'แนบสลิปการโอนเงิน' }),
    el('input', { type: 'file', id: 'slipFile', name: 'slip', accept: 'image/*,application/pdf', required: true, capture: 'environment' }),
    el('div', { class: 'hint', text: `รองรับไฟล์รูปภาพ (JPG, PNG, HEIC) หรือ PDF ขนาดไม่เกิน ${maxMb} MB — ถ่ายรูปจากมือถือได้ทันที` }),
    el('div', { id: 'slipPreview', style: 'margin-top:.6rem' }),
  ]));

  form.appendChild(el('div', { class: 'grid grid-2', style: 'gap:.75rem' }, [
    el('div', { class: 'field', style: 'margin:0' }, [
      el('label', { for: 'amountInput', text: 'จำนวนเงินที่โอน (บาท)' }),
      el('input', {
        type: 'number', id: 'amountInput', name: 'amount', step: '0.01', min: '0',
        value: String(a.outstanding), readonly: !a.allow_partial,
      }),
      el('div', { class: 'hint', text: a.allow_partial ? 'รายการนี้ผ่อนชำระได้' : 'รายการนี้ต้องชำระเต็มจำนวน' }),
    ]),
    el('div', { class: 'field', style: 'margin:0' }, [
      el('label', { for: 'transferAt', text: 'วัน-เวลาที่โอน' }),
      el('input', { type: 'datetime-local', id: 'transferAt', name: 'transferred_at', value: nowLocal() }),
    ]),
  ]));

  form.appendChild(el('div', { class: 'field' }, [
    el('label', { for: 'payerName', text: 'ชื่อผู้โอน' }),
    el('input', { type: 'text', id: 'payerName', name: 'payer_name', value: a.name, maxlength: '120' }),
  ]));

  if (needPin) {
    form.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'pinInput', text: 'รหัสสมาชิก (PIN) สำหรับยืนยันตัวตน' }),
      el('input', {
        type: 'password', id: 'pinInput', name: 'pin', inputmode: 'numeric',
        autocomplete: 'off', required: true, maxlength: '12', placeholder: '••••••',
      }),
      el('div', { class: 'hint', text: 'หากลืมรหัส กรุณาติดต่อฝ่ายการเงินของโรงเรียนเพื่อขอรหัสใหม่' }),
    ]));
  }

  form.appendChild(el('div', { class: 'field' }, [
    el('label', { for: 'noteInput', text: 'หมายเหตุ (ถ้ามี)' }),
    el('textarea', { id: 'noteInput', name: 'note', rows: '2', maxlength: '500', style: 'min-height:60px' }),
  ]));

  const errBox = el('div', { id: 'formErr', class: 'hidden' });
  form.appendChild(errBox);

  const submitBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'submit', form: 'payForm', text: '✓ ยืนยันการแจ้งชำระเงิน' });
  const m = modal({
    title: 'แจ้งชำระเงิน',
    body: form,
    size: 'modal-lg',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), submitBtn],
  });

  /* ตัวอย่างสลิป */
  $('#slipFile', form).addEventListener('change', (e) => {
    const f = e.target.files[0];
    const pv = $('#slipPreview', form);
    pv.innerHTML = '';
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) {
      pv.appendChild(el('div', { class: 'alert alert-error small' }, [`ไฟล์มีขนาด ${fileSize(f.size)} เกิน ${maxMb} MB กรุณาเลือกไฟล์ที่เล็กลง`]));
      e.target.value = '';
      return;
    }
    pv.appendChild(el('div', { class: 'small muted', text: `${f.name} • ${fileSize(f.size)}` }));
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      pv.appendChild(el('img', { src: url, class: 'slip-frame', style: 'max-height:220px;margin-top:.4rem', alt: 'ตัวอย่างสลิป', onload: () => setTimeout(() => URL.revokeObjectURL(url), 1000) }));
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.className = 'hidden';
    const fd = new FormData();
    fd.append('assignment_id', String(member.assignment_id));
    const file = $('#slipFile', form).files[0];
    if (!file) { showErr(errBox, 'กรุณาแนบสลิปการโอนเงิน'); return; }
    fd.append('slip', file);
    fd.append('amount', $('#amountInput', form).value || String(a.outstanding));
    fd.append('transferred_at', $('#transferAt', form).value || '');
    fd.append('payer_name', $('#payerName', form).value || '');
    fd.append('note', $('#noteInput', form).value || '');
    if (needPin) fd.append('pin', $('#pinInput', form).value || '');
    const bankSel = $('#bankSel', form);
    if (bankSel) fd.append('bank_account_id', bankSel.value);

    busy(submitBtn, true, 'กำลังส่งข้อมูล...');
    try {
      const r = await api('/api/public/payments', { method: 'POST', body: fd });
      m.close();
      showSuccess(r);
      load(false);
    } catch (err) {
      showErr(errBox, err.message);
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      busy(submitBtn, false);
    }
  });
}

function showErr(box, msg) {
  box.className = 'alert alert-error';
  box.textContent = msg;
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/* ------------------------ หน้าจอยืนยันพร้อมเลขอ้างอิง ------------------------ */
function showSuccess(r) {
  const body = el('div', { class: 'center' }, [
    el('div', { style: 'font-size:3.5rem;line-height:1', text: '✅' }),
    el('h3', { style: 'margin:.5rem 0 .2rem;color:var(--green-700)', text: 'แจ้งชำระเงินเรียบร้อยแล้ว' }),
    el('p', { class: 'muted small', style: 'margin:0 0 1rem', text: r.message }),

    el('div', { class: 'card', style: 'background:var(--brand-50);border-color:var(--brand-200)' }, [
      el('div', { class: 'small bold', style: 'color:var(--brand-700)', text: 'เลขอ้างอิงสำหรับตรวจสอบและดูสลิปภายหลัง' }),
      el('div', { class: 'ref-code', id: 'refCodeText', text: r.ref_code }),
      el('button', {
        class: 'btn btn-sm', type: 'button', text: '📋 คัดลอกเลขอ้างอิง',
        onclick: async (e) => {
          const ok = await copyText(r.ref_code);
          toast(ok ? `คัดลอกเลข ${r.ref_code} แล้ว` : 'คัดลอกไม่สำเร็จ กรุณาจดเลขไว้', ok ? 'success' : 'warn');
        },
      }),
    ]),

    el('div', { class: 'alert alert-warn', style: 'margin-top:1rem;text-align:right' }, [
      el('div', {}, [
        el('strong', { text: 'กรุณาบันทึกเลขอ้างอิงนี้ไว้ ' }),
        'ท่านสามารถใช้เลข 4 หลักนี้ตรวจสอบสถานะและเรียกดูสลิปที่แนบไว้ได้ตลอดเวลาที่เมนู "ตรวจสอบสลิป"',
      ]),
    ]),

    el('dl', { class: 'kv', style: 'margin-top:1rem;text-align:right' }, [
      el('dt', { text: 'ผู้ชำระ' }), el('dd', { text: `${r.member_name} (${r.member_code})` }),
      el('dt', { text: 'รายการ' }), el('dd', { text: r.collection_name }),
      el('dt', { text: 'จำนวนเงิน' }), el('dd', { text: `${money(r.amount)} บาท` }),
      el('dt', { text: 'สถานะ' }), el('dd', {}, [statusBadge(r.status === 'approved' ? 'paid' : 'pending', r.status_label)]),
    ]),
  ]);

  const m = modal({
    title: 'บันทึกการแจ้งชำระสำเร็จ',
    body,
    footer: [
      el('button', { class: 'btn', type: 'button', text: '🖨 พิมพ์หลักฐาน', onclick: () => window.print() }),
      el('a', { class: 'btn', href: `/check.html?ref=${r.ref_code}`, text: 'ตรวจสอบสถานะ' }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'เสร็จสิ้น', onclick: () => m.close() }),
    ],
  });
}

/* -------------------- ป๊อปอัปดูข้อมูลของรายการที่แจ้งแล้ว -------------------- */
async function openInfoModal(member) {
  let detail;
  try {
    detail = await api(`/api/public/assignments/${member.assignment_id}`);
  } catch (e) { return toast(e.message, 'error'); }

  const a = detail.assignment;
  const body = el('div', {}, [
    el('dl', { class: 'kv' }, [
      el('dt', { text: 'ชื่อ-สกุล' }), el('dd', { text: a.name }),
      el('dt', { text: 'รหัสสมาชิก' }), el('dd', { class: 'mono', text: a.member_code }),
      el('dt', { text: 'ยอดที่ต้องชำระ' }), el('dd', { text: `${money(a.net_due)} บาท` }),
      el('dt', { text: 'ชำระแล้ว' }), el('dd', { text: `${money(a.paid_amount)} บาท` }),
      el('dt', { text: 'สถานะ' }), el('dd', {}, [statusBadge(a.status, a.status_label)]),
    ]),
    el('hr', { class: 'divider' }),
    el('div', { class: 'label', text: 'ประวัติการแจ้งชำระ' }),
  ]);

  if (!detail.payments.length) {
    body.appendChild(el('p', { class: 'muted small', text: 'ยังไม่มีการแจ้งชำระ' }));
  } else {
    body.appendChild(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'เลขอ้างอิง' }), el('th', { class: 'num', text: 'จำนวนเงิน' }),
          el('th', { text: 'วันที่แจ้ง' }), el('th', { class: 'mid', text: 'สถานะ' }), el('th', {}),
        ])]),
        el('tbody', {}, detail.payments.map((p) =>
          el('tr', {}, [
            el('td', { class: 'mono bold', text: p.ref_code }),
            el('td', { class: 'num', text: money(p.amount) }),
            el('td', { class: 'small', text: thaiDate(p.created_at, { short: true, withTime: true }) }),
            el('td', { class: 'mid' }, [
              statusBadge(p.status === 'approved' ? 'paid' : p.status === 'rejected' ? 'rejected' : 'pending',
                { pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่าน' }[p.status]),
              p.reject_reason ? el('div', { class: 'tiny', style: 'color:var(--red-600)', text: p.reject_reason }) : null,
            ]),
            el('td', {}, [p.has_slip
              ? el('a', { class: 'btn btn-sm', href: `/check.html?ref=${p.ref_code}`, text: 'ดูสลิป' }) : null]),
          ]))),
      ]),
    ]));
  }

  const m = modal({
    title: `ข้อมูลการชำระเงิน — ${a.name}`,
    body,
    footer: [el('button', { class: 'btn btn-primary', type: 'button', text: 'ปิด', onclick: () => m.close() })],
  });
}

/* --------------------------------- เริ่มต้น --------------------------------- */
if (!COLLECTION_ID) {
  location.replace('/');
} else {
  loadConfig().then(load);
}
