/* ตรวจสอบการแจ้งชำระเงิน: ดูสลิป อนุมัติ ไม่อนุมัติ และออกใบเสร็จ */
'use strict';

const PAY_STATUS_BADGE = {
  pending: ['badge-pending', 'รอตรวจสอบ'],
  approved: ['badge-approved', 'ชำระแล้ว'],
  rejected: ['badge-rejected', 'ไม่ผ่านการตรวจสอบ'],
  cancelled: ['badge-cancelled', 'ยกเลิก'],
};

let payFilters = { status: 'pending', collection: '', group: '', q: '', page: 1 };

route('payments', {
  async render(view, params) {
    if (params[0]) return renderPaymentDetail(view, params[0]);

    view.innerHTML = '';
    view.appendChild(pageHead('ตรวจสอบการชำระเงิน', 'ตรวจสอบสลิปที่สมาชิกแจ้งเข้ามา แล้วยืนยันหรือปฏิเสธการชำระ', [
      canWrite() ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ บันทึกชำระเงินสด', onclick: openManualPayment }) : null,
      el('button', { class: 'btn btn-sm', type: 'button', text: '🔄 รีเฟรช', onclick: () => handleRoute() }),
    ]));

    const card = el('section', { class: 'card card-pad-0' });
    view.appendChild(card);
    card.appendChild(el('div', { id: 'payFilters' }));
    card.appendChild(el('div', { id: 'payList' }));
    await loadPayments();
  },
});

async function loadPayments() {
  const list = $('#payList');
  if (!list) return;
  list.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังโหลด...</div>';

  const qsx = new URLSearchParams();
  if (payFilters.status) qsx.set('status', payFilters.status);
  if (payFilters.collection) qsx.set('collection', payFilters.collection);
  if (payFilters.group) qsx.set('group', payFilters.group);
  if (payFilters.q) qsx.set('q', payFilters.q);
  qsx.set('page', String(payFilters.page));

  const [data, cols, groups] = await Promise.all([
    api(`/api/admin/payments?${qsx}`),
    api('/api/admin/collections'),
    api('/api/admin/groups'),
  ]);

  ADMIN.pendingCount = data.counts.pending;
  buildNav();
  renderPayFilters(cols.collections, groups.groups, data.counts);

  list.innerHTML = '';
  if (!data.payments.length) {
    list.appendChild(emptyState('🧾', 'ไม่พบรายการแจ้งชำระ',
      payFilters.status === 'pending' ? 'ไม่มีรายการที่รอการตรวจสอบในขณะนี้' : 'ลองปรับตัวกรองการค้นหา'));
    return;
  }

  const selected = new Set();
  const bulkBar = el('div', {
    class: 'row-between hidden', id: 'bulkBar',
    style: 'padding:.7rem 1.1rem;background:var(--brand-50);border-bottom:1px solid var(--brand-200)',
  });
  list.appendChild(bulkBar);

  const updateBulk = () => {
    if (!selected.size) { bulkBar.className = 'row-between hidden'; return; }
    bulkBar.className = 'row-between';
    bulkBar.innerHTML = '';
    bulkBar.appendChild(el('span', { class: 'bold small', text: `เลือกไว้ ${selected.size} รายการ` }));
    bulkBar.appendChild(el('div', { class: 'row', style: 'gap:.4rem' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: 'ยกเลิกการเลือก', onclick: () => { selected.clear(); $$('.row-check', list).forEach((c) => { c.checked = false; c.closest('tr').classList.remove('is-selected'); }); updateBulk(); } }),
      canWrite() ? el('button', { class: 'btn btn-sm btn-green', type: 'button', text: `✓ อนุมัติทั้งหมด (${selected.size})`, onclick: () => bulkApprove([...selected]) }) : null,
    ]));
  };

  const tbody = el('tbody');
  for (const p of data.payments) {
    const [cls, label] = PAY_STATUS_BADGE[p.status] || ['badge-draft', p.status];
    const cb = el('input', {
      type: 'checkbox', class: 'row-check',
      onchange: (e) => {
        if (e.target.checked) selected.add(p.id); else selected.delete(p.id);
        e.target.closest('tr').classList.toggle('is-selected', e.target.checked);
        updateBulk();
      },
    });

    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mid', 'data-label': '' }, [p.status === 'pending' && canWrite() ? cb : el('span', { class: 'tiny muted', text: '—' })]),
      el('td', { 'data-label': 'เลขอ้างอิง' }, [
        el('div', { class: 'mono bold', style: 'font-size:1.05rem', text: p.ref_code }),
        p.receipt_no ? el('div', { class: 'tiny muted', text: `ใบเสร็จ ${p.receipt_no}` }) : null,
      ]),
      el('td', { 'data-label': 'สมาชิก' }, [
        el('div', { class: 'bold', text: p.full_name }),
        el('div', { class: 'tiny muted' }, [
          el('span', { class: 'mono', text: p.member_code }),
          p.group_name ? el('span', { text: ` • ${p.group_name}` }) : null,
        ]),
      ]),
      el('td', { 'data-label': 'รายการจัดเก็บ', class: 'small', text: p.collection_name }),
      el('td', { class: 'num bold', 'data-label': 'จำนวนเงิน', text: money(p.amount) }),
      el('td', { 'data-label': 'วันที่แจ้ง', class: 'small' }, [
        el('div', { text: thaiDate(p.created_at, { short: true, withTime: true }) }),
        el('div', { class: 'tiny muted', text: relativeTime(p.created_at) }),
      ]),
      el('td', { class: 'mid', 'data-label': 'สถานะ' }, [
        el('span', { class: `badge ${cls}`, text: label }),
        p.reject_reason ? el('div', { class: 'tiny', style: 'color:var(--red-600)', text: p.reject_reason }) : null,
      ]),
      el('td', { class: 'mid cell-full', 'data-label': '' }, [
        el('a', { class: 'btn btn-sm btn-primary', href: `#/payments/${p.id}`, text: p.status === 'pending' ? '🔍 ตรวจสอบ' : 'ดูรายละเอียด' }),
      ]),
    ]));
  }

  list.appendChild(el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data cards' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { class: 'mid', style: 'width:40px' }),
        el('th', { text: 'เลขอ้างอิง' }),
        el('th', { text: 'สมาชิก' }),
        el('th', { text: 'รายการจัดเก็บ' }),
        el('th', { class: 'num', text: 'จำนวนเงิน' }),
        el('th', { text: 'วันที่แจ้ง' }),
        el('th', { class: 'mid', text: 'สถานะ' }),
        el('th', { class: 'mid', style: 'width:130px' }),
      ])]),
      tbody,
    ]),
  ]));

  const pg = pager(data, (p) => { payFilters.page = p; loadPayments(); });
  if (pg) list.appendChild(pg);
}

function renderPayFilters(collections, groups, counts) {
  const box = $('#payFilters');
  if (!box) return;
  box.innerHTML = '';

  const tab = (val, label, count) => el('button', {
    class: `tab${payFilters.status === val ? ' active' : ''}`, type: 'button',
    onclick: () => { payFilters.status = val; payFilters.page = 1; loadPayments(); },
  }, [label, count !== undefined ? el('span', { class: 'chip', style: 'margin-inline-start:.35rem', text: String(count) }) : null]);

  box.appendChild(el('div', { class: 'tabs', style: 'margin:0;padding:0 1.1rem' }, [
    tab('pending', 'รอตรวจสอบ', counts.pending),
    tab('approved', 'ชำระแล้ว', counts.approved),
    tab('rejected', 'ไม่ผ่าน', counts.rejected),
    tab('', 'ทั้งหมด'),
  ]));

  box.appendChild(el('div', { class: 'filters' }, [
    el('div', { class: 'field' }, [
      el('label', { text: 'ค้นหา' }),
      el('input', {
        type: 'search', placeholder: 'เลขอ้างอิง / ชื่อ / รหัสสมาชิก', value: payFilters.q,
        oninput: debounce((e) => { payFilters.q = e.target.value; payFilters.page = 1; loadPayments(); }, 350),
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'รายการจัดเก็บ' }),
      el('select', { onchange: (e) => { payFilters.collection = e.target.value; payFilters.page = 1; loadPayments(); } }, [
        el('option', { value: '', text: 'ทุกรายการ' }),
        ...collections.map((c) => el('option', { value: String(c.id), text: c.name, selected: String(c.id) === payFilters.collection })),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'กลุ่ม/ชั้น' }),
      el('select', { onchange: (e) => { payFilters.group = e.target.value; payFilters.page = 1; loadPayments(); } }, [
        el('option', { value: '', text: 'ทุกกลุ่ม' }),
        ...groups.map((g) => el('option', { value: String(g.id), text: g.name, selected: String(g.id) === payFilters.group })),
      ]),
    ]),
  ]));
}

/* ============================ หน้ารายละเอียด ============================ */
async function renderPaymentDetail(view, id) {
  const d = await api(`/api/admin/payments/${id}`);
  const p = d.payment;
  const a = d.assignment;
  const [cls, label] = PAY_STATUS_BADGE[p.status] || ['badge-draft', p.status];

  view.innerHTML = '';
  view.appendChild(pageHead(`ตรวจสอบการชำระเงิน — ${p.ref_code}`, `${p.full_name} • ${p.collection_name}`, [
    el('a', { class: 'btn btn-sm', href: '#/payments', text: '← กลับรายการ' }),
  ]));

  if (d.duplicates.length) {
    view.appendChild(el('div', { class: 'alert alert-warn', style: 'margin-bottom:1rem' }, [
      el('div', {}, [
        el('strong', { text: '⚠ พบสลิปนี้ถูกใช้ซ้ำ! ' }),
        `ไฟล์สลิปเดียวกันนี้ถูกใช้แจ้งชำระอีก ${d.duplicates.length} ครั้ง: `,
        d.duplicates.map((x) => `${x.ref_code} (${x.member_code})`).join(', '),
        ' — กรุณาตรวจสอบอย่างละเอียดก่อนอนุมัติ',
      ]),
    ]));
  }

  /* ---- ฝั่งซ้าย: สลิป ---- */
  const slipCard = el('section', { class: 'card' }, [
    el('div', { class: 'row-between', style: 'margin-bottom:.6rem' }, [
      el('h2', { style: 'font-size:1.05rem;margin:0', text: 'สลิปการโอนเงิน' }),
      p.has_slip ? el('div', { class: 'row', style: 'gap:.35rem' }, [
        el('a', { class: 'btn btn-sm', href: `/api/admin/payments/${p.id}/slip`, target: '_blank', rel: 'noopener', text: '🔍 เปิดเต็มจอ' }),
        el('button', { class: 'btn btn-sm', type: 'button', text: '⬇ ดาวน์โหลด', onclick: () => download(`/api/admin/payments/${p.id}/slip?download=1`, `slip-${p.ref_code}`) }),
      ]) : null,
    ]),
    p.has_slip
      ? (p.slip_mime === 'application/pdf'
        ? el('iframe', { src: `/api/admin/payments/${p.id}/slip`, class: 'slip-frame', style: 'height:70vh', title: 'สลิป PDF' })
        : el('img', { src: `/api/admin/payments/${p.id}/slip`, class: 'slip-frame', alt: `สลิป ${p.ref_code}` }))
      : el('div', { class: 'empty' }, [el('span', { class: 'empty-icon', text: '📎' }), 'ไม่มีไฟล์สลิป (อาจเป็นการบันทึกโดยผู้ดูแล)']),
  ]);

  /* ---- ฝั่งขวา: ข้อมูล + การกระทำ ---- */
  const infoCard = el('section', { class: 'card stack' }, [
    el('div', { class: 'center', style: 'padding-bottom:.5rem' }, [
      el('div', { class: 'ref-code', style: 'font-size:2.4rem', text: p.ref_code }),
      el('span', { class: `badge ${cls}`, text: label }),
    ]),
    el('hr', { class: 'divider' }),
    el('dl', { class: 'kv' }, [
      el('dt', { text: 'สมาชิก' }), el('dd', { text: `${p.full_name} (${p.member_code})` }),
      p.group_name ? el('dt', { text: 'กลุ่ม/ชั้น' }) : null,
      p.group_name ? el('dd', { text: p.group_name }) : null,
      p.phone ? el('dt', { text: 'เบอร์โทร' }) : null,
      p.phone ? el('dd', { class: 'mono', text: p.phone }) : null,
      el('dt', { text: 'รายการจัดเก็บ' }), el('dd', { text: `${p.collection_name} (${p.collection_code})` }),
      el('dt', { text: 'ยอดที่ต้องชำระ' }), el('dd', { text: `${money(a ? a.net_due : 0)} บาท` }),
      el('dt', { text: 'ชำระแล้ว (อนุมัติ)' }), el('dd', { text: `${money(a ? a.paid_amount : 0)} บาท` }),
      el('dt', { text: 'จำนวนเงินที่แจ้ง' }),
      el('dd', { style: 'font-size:1.2rem;font-weight:800;color:var(--brand-600)', text: `${money(p.amount)} บาท` }),
      p.payer_name ? el('dt', { text: 'ชื่อผู้โอน' }) : null,
      p.payer_name ? el('dd', { text: p.payer_name }) : null,
      p.transferred_at ? el('dt', { text: 'วัน-เวลาที่โอน' }) : null,
      p.transferred_at ? el('dd', { text: thaiDate(p.transferred_at, { withTime: true }) }) : null,
      p.bank_name ? el('dt', { text: 'บัญชีรับโอน' }) : null,
      p.bank_name ? el('dd', { text: `${p.bank_name} ${p.account_number || ''}` }) : null,
      el('dt', { text: 'วันที่แจ้ง' }), el('dd', { text: thaiDate(p.created_at, { withTime: true }) }),
      p.verified_at ? el('dt', { text: 'ตรวจสอบเมื่อ' }) : null,
      p.verified_at ? el('dd', { text: thaiDate(p.verified_at, { withTime: true }) }) : null,
      p.verified_by_name ? el('dt', { text: 'ผู้ตรวจสอบ' }) : null,
      p.verified_by_name ? el('dd', { text: p.verified_by_name }) : null,
      p.receipt_no ? el('dt', { text: 'เลขที่ใบเสร็จ' }) : null,
      p.receipt_no ? el('dd', { class: 'mono', text: p.receipt_no }) : null,
      p.note ? el('dt', { text: 'หมายเหตุ' }) : null,
      p.note ? el('dd', { text: p.note }) : null,
      p.slip_size ? el('dt', { text: 'ไฟล์สลิป' }) : null,
      p.slip_size ? el('dd', { class: 'small muted', text: `${p.slip_mime} • ${fileSize(p.slip_size)}` }) : null,
    ]),

    p.reject_reason ? el('div', { class: 'alert alert-error' }, [
      el('div', {}, [el('strong', { text: 'เหตุผลที่ไม่อนุมัติ: ' }), p.reject_reason]),
    ]) : null,
  ]);

  if (d.items.length) {
    infoCard.appendChild(el('details', { style: 'margin-top:.5rem' }, [
      el('summary', { style: 'cursor:pointer;font-weight:700;font-size:.9rem', text: `กิจกรรมย่อยที่ต้องชำระ (${d.items.length})` }),
      el('div', { class: 'table-wrap', style: 'margin-top:.4rem' }, [
        el('table', { class: 'data' }, [
          el('tbody', {}, d.items.map((it) => el('tr', {}, [el('td', { text: it.name }), el('td', { class: 'num', text: money(it.amount) })]))),
        ]),
      ]),
    ]));
  }

  /* ---- ปุ่มการทำงาน ---- */
  if (canWrite()) {
    const actions = el('div', { class: 'row no-print', style: 'gap:.5rem;margin-top:.5rem' });
    if (p.status === 'pending') {
      actions.appendChild(el('button', { class: 'btn btn-green grow btn-lg', type: 'button', text: '✓ อนุมัติการชำระเงิน', onclick: () => approvePayment(p, a) }));
      actions.appendChild(el('button', { class: 'btn btn-red grow btn-lg', type: 'button', text: '✕ ไม่อนุมัติ', onclick: () => rejectPayment(p) }));
    } else if (p.status === 'approved') {
      actions.appendChild(el('button', { class: 'btn btn-primary grow', type: 'button', text: '🧾 พิมพ์ใบเสร็จ', onclick: () => printReceipt(p.id) }));
      actions.appendChild(el('button', { class: 'btn grow', type: 'button', text: '↩ คืนสถานะเป็นรอตรวจสอบ', onclick: () => revertPayment(p) }));
    } else if (p.status === 'rejected') {
      actions.appendChild(el('button', { class: 'btn btn-green grow', type: 'button', text: '✓ อนุมัติแทน', onclick: () => approvePayment(p, a) }));
      actions.appendChild(el('button', { class: 'btn grow', type: 'button', text: '↩ คืนสถานะเป็นรอตรวจสอบ', onclick: () => revertPayment(p) }));
    }
    infoCard.appendChild(actions);
  }

  if (d.history.length > 1) {
    infoCard.appendChild(el('div', { style: 'margin-top:.5rem' }, [
      el('div', { class: 'label', text: 'ประวัติการแจ้งชำระของรายการนี้' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('tbody', {}, d.history.map((h) => el('tr', { style: h.id === p.id ? 'background:var(--brand-50)' : '' }, [
            el('td', {}, [el('a', { href: `#/payments/${h.id}`, class: 'mono bold', text: h.ref_code })]),
            el('td', { class: 'num', text: money(h.amount) }),
            el('td', { class: 'small', text: thaiDate(h.created_at, { short: true }) }),
            el('td', { class: 'mid small', text: h.status_label }),
          ]))),
        ]),
      ]),
    ]));
  }

  view.appendChild(el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(340px,1fr))' }, [slipCard, infoCard]));
}

/* ============================== การกระทำ ============================== */
async function approvePayment(p, a) {
  if (needWrite()) return;
  const maxAllowed = a ? a.net_due - a.paid_amount : p.amount;

  const form = el('form', { id: 'apForm' }, [
    el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' }, [
      `ยืนยันการชำระเงินของ ${p.full_name} จำนวน ${money(p.amount)} บาท — สถานะจะเปลี่ยนเป็น "ชำระแล้ว" และระบบจะออกเลขที่ใบเสร็จอัตโนมัติ`,
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'apAmount', text: 'จำนวนเงินที่อนุมัติ (บาท)' }),
      el('input', { type: 'number', id: 'apAmount', step: '0.01', min: '0.01', max: String(maxAllowed), value: String(p.amount) }),
      el('div', { class: 'hint', text: `แก้ไขได้หากยอดในสลิปไม่ตรงกับที่แจ้ง (สูงสุด ${money(maxAllowed)} บาท)` }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'apNote', text: 'หมายเหตุ (ถ้ามี)' }),
      el('input', { type: 'text', id: 'apNote', maxlength: '500' }),
    ]),
  ]);

  const btn = el('button', { class: 'btn btn-green', type: 'submit', form: 'apForm', text: '✓ ยืนยันอนุมัติ' });
  const m = modal({
    title: 'อนุมัติการชำระเงิน', body: form, size: 'modal-sm',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังอนุมัติ...');
    try {
      const r = await api(`/api/admin/payments/${p.id}/approve`, {
        method: 'POST', body: { amount: $('#apAmount').value, note: $('#apNote').value },
      });
      m.close();
      toast(r.message, 'success', 5000);
      refreshPendingCount();
      handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

async function rejectPayment(p) {
  if (needWrite()) return;
  const REASONS = ['สลิปไม่ชัดเจน อ่านไม่ออก', 'จำนวนเงินไม่ตรงกับที่ต้องชำระ', 'ไม่พบรายการโอนเข้าบัญชี', 'สลิปซ้ำกับรายการอื่น', 'โอนผิดบัญชี'];

  const form = el('form', { id: 'rjForm' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'rjReason', text: 'เหตุผลที่ไม่อนุมัติ' }),
      el('textarea', { id: 'rjReason', required: true, maxlength: '500', rows: '3', placeholder: 'ระบุเหตุผลเพื่อให้สมาชิกทราบและแจ้งใหม่ได้ถูกต้อง' }),
    ]),
    el('div', { class: 'label', text: 'เหตุผลที่ใช้บ่อย' }),
    el('div', { class: 'row', style: 'gap:.35rem' }, REASONS.map((r) =>
      el('button', { class: 'btn btn-sm', type: 'button', text: r, onclick: () => { $('#rjReason').value = r; } }))),
  ]);

  const btn = el('button', { class: 'btn btn-red', type: 'submit', form: 'rjForm', text: '✕ ยืนยันไม่อนุมัติ' });
  const m = modal({
    title: 'ไม่อนุมัติการชำระเงิน', body: form, size: 'modal-sm',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังบันทึก...');
    try {
      await api(`/api/admin/payments/${p.id}/reject`, { method: 'POST', body: { reason: $('#rjReason').value } });
      m.close();
      toast('บันทึกการไม่อนุมัติแล้ว สมาชิกสามารถแจ้งชำระใหม่ได้', 'success');
      refreshPendingCount();
      handleRoute();
    } catch (ex) { toast(ex.message, 'error'); busy(btn, false); }
  });
}

async function revertPayment(p) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'คืนสถานะเป็นรอตรวจสอบ',
    message: `ต้องการคืนสถานะของเลขอ้างอิง ${p.ref_code} เป็น "รอตรวจสอบ" ใช่หรือไม่? (เลขที่ใบเสร็จเดิมจะถูกยกเลิก)`,
    confirmText: 'คืนสถานะ',
  }))) return;
  try {
    await api(`/api/admin/payments/${p.id}/revert`, { method: 'POST', body: {} });
    toast('คืนสถานะเรียบร้อยแล้ว', 'success');
    refreshPendingCount();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function bulkApprove(ids) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'อนุมัติหลายรายการ',
    message: `ต้องการอนุมัติการชำระเงิน ${ids.length} รายการพร้อมกันใช่หรือไม่? ระบบจะออกเลขที่ใบเสร็จให้ทุกรายการ`,
    confirmText: `อนุมัติ ${ids.length} รายการ`,
  }))) return;
  try {
    const r = await api('/api/admin/payments/bulk/approve', { method: 'POST', body: { ids } });
    toast(`อนุมัติสำเร็จ ${r.approved} รายการ${r.failed.length ? ` • ไม่สำเร็จ ${r.failed.length} รายการ` : ''}`,
      r.failed.length ? 'warn' : 'success', 6000);
    if (r.failed.length) {
      modal({
        title: 'รายการที่อนุมัติไม่สำเร็จ', size: 'modal-sm',
        body: el('ul', { style: 'margin:0;padding-inline-start:1.2rem' },
          r.failed.map((f) => el('li', { text: `${f.ref_code || '#' + f.id}: ${f.reason}` }))),
      });
    }
    refreshPendingCount();
    loadPayments();
  } catch (e) { toast(e.message, 'error'); }
}

/* -------------------------- บันทึกชำระเงินสด -------------------------- */
async function openManualPayment(prefillAssignment) {
  if (needWrite()) return;
  const cols = (await api('/api/admin/collections')).collections.filter((c) => c.status !== 'draft');
  if (!cols.length) return toast('ยังไม่มีรายการจัดเก็บที่เปิดใช้งาน', 'warn');

  const form = el('form', { id: 'mpForm' }, [
    el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' },
      ['ใช้สำหรับบันทึกการชำระที่รับเป็นเงินสดหรือรับที่โรงเรียน ระบบจะบันทึกเป็น "ชำระแล้ว" ทันทีพร้อมออกใบเสร็จ']),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'mpCol', text: 'รายการจัดเก็บ' }),
      el('select', { id: 'mpCol', required: true }, [
        el('option', { value: '', text: '— เลือกรายการ —' }),
        ...cols.map((c) => el('option', { value: String(c.id), text: `${c.name} (${c.code})` })),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'mpMember', text: 'สมาชิกที่ชำระ' }),
      el('select', { id: 'mpMember', required: true, disabled: true }, [el('option', { value: '', text: '— เลือกรายการจัดเก็บก่อน —' })]),
    ]),
    el('div', { class: 'grid grid-2', style: 'gap:.75rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { class: 'req', for: 'mpAmount', text: 'จำนวนเงิน (บาท)' }),
        el('input', { type: 'number', id: 'mpAmount', step: '0.01', min: '0.01', required: true }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'mpMethod', text: 'ช่องทาง' }),
        el('select', { id: 'mpMethod' }, [
          el('option', { value: 'cash', text: 'เงินสด' }),
          el('option', { value: 'transfer', text: 'โอนเงิน' }),
          el('option', { value: 'other', text: 'อื่น ๆ' }),
        ]),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'mpNote', text: 'หมายเหตุ' }),
      el('input', { type: 'text', id: 'mpNote', maxlength: '500', value: 'รับชำระที่โรงเรียน' }),
    ]),
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'mpForm', text: 'บันทึกการชำระเงิน' });
  const m = modal({
    title: 'บันทึกการชำระเงินโดยผู้ดูแล', body: form,
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  $('#mpCol', form).addEventListener('change', async (e) => {
    const sel = $('#mpMember', form);
    sel.disabled = true;
    sel.innerHTML = '<option value="">กำลังโหลด...</option>';
    if (!e.target.value) { sel.innerHTML = '<option value="">— เลือกรายการจัดเก็บก่อน —</option>'; return; }
    try {
      const d = await api(`/api/admin/collections/${e.target.value}`);
      const owing = d.members.filter((x) => !x.waived && x.outstanding > 0);
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', text: owing.length ? '— เลือกสมาชิก —' : 'ไม่มีผู้ค้างชำระในรายการนี้' }));
      for (const x of owing) {
        sel.appendChild(el('option', {
          value: String(x.assignment_id), dataset: { outstanding: String(x.outstanding) },
          text: `${x.member_code} ${x.full_name} — ค้าง ${money(x.outstanding)} บาท`,
        }));
      }
      sel.disabled = !owing.length;
    } catch (ex) { toast(ex.message, 'error'); }
  });

  $('#mpMember', form).addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt && opt.dataset.outstanding) $('#mpAmount', form).value = opt.dataset.outstanding;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังบันทึก...');
    try {
      const r = await api('/api/admin/payments/manual', {
        method: 'POST',
        body: {
          assignment_id: $('#mpMember', form).value,
          amount: $('#mpAmount', form).value,
          method: $('#mpMethod', form).value,
          note: $('#mpNote', form).value,
        },
      });
      m.close();
      toast(`บันทึกเรียบร้อย เลขที่ใบเสร็จ ${r.receipt_no} • สถานะ: ${r.assignment_status_label}`, 'success', 6000);
      handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });

  if (prefillAssignment) {
    $('#mpCol', form).value = String(prefillAssignment.collection_id);
    $('#mpCol', form).dispatchEvent(new Event('change'));
  }
}

/* ------------------------------ ใบเสร็จรับเงิน ------------------------------ */
async function printReceipt(paymentId) {
  let d;
  try { d = await api(`/api/admin/payments/${paymentId}/receipt`); } catch (e) { return toast(e.message, 'error'); }
  const r = d.receipt;

  const box = el('div', { class: 'receipt', id: 'receiptBox' }, [
    el('div', { class: 'receipt-head' }, [
      r.school.logo ? el('img', { src: r.school.logo, style: 'width:60px;height:60px;object-fit:contain', alt: '' }) : null,
      el('h2', { style: 'margin:.2rem 0', text: r.school.name }),
      r.school.address ? el('div', { style: 'font-size:.85rem', text: r.school.address }) : null,
      r.school.phone ? el('div', { style: 'font-size:.85rem', text: `โทร. ${r.school.phone}` }) : null,
      el('h3', { style: 'margin:.7rem 0 0;font-size:1.15rem', text: 'ใบรับเงิน / ใบเสร็จรับเงิน' }),
    ]),
    el('div', { style: 'display:flex;justify-content:space-between;font-size:.9rem;flex-wrap:wrap;gap:.5rem' }, [
      el('div', {}, [el('strong', { text: 'เลขที่: ' }), r.receipt_no || '-']),
      el('div', {}, [el('strong', { text: 'วันที่: ' }), thaiDate(r.paid_at)]),
    ]),
    el('div', { style: 'margin-top:.8rem;font-size:.95rem' }, [
      el('div', {}, [el('strong', { text: 'ได้รับเงินจาก: ' }), `${r.member.full_name} (${r.member.member_code})`]),
      r.member.group_name ? el('div', {}, [el('strong', { text: 'กลุ่ม/ชั้น: ' }), r.member.group_name]) : null,
      el('div', {}, [el('strong', { text: 'วัตถุประสงค์: ' }), `${r.collection.name} (${r.collection.code})`]),
      el('div', {}, [el('strong', { text: 'ช่องทาง: ' }), { cash: 'เงินสด', transfer: 'โอนเงิน', other: 'อื่น ๆ' }[r.method] || r.method]),
      el('div', {}, [el('strong', { text: 'เลขอ้างอิง: ' }), r.ref_code]),
    ]),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'รายการ' }), el('th', { style: 'text-align:left;width:130px', text: 'จำนวนเงิน (บาท)' })])]),
      el('tbody', {}, r.items.length
        ? r.items.map((it) => el('tr', {}, [el('td', { text: it.name }), el('td', { style: 'text-align:left', text: money(it.amount) })]))
        : [el('tr', {}, [el('td', { text: r.collection.name }), el('td', { style: 'text-align:left', text: money(r.amount) })])]),
      el('tfoot', {}, [el('tr', {}, [
        el('th', { text: 'รวมเป็นเงินทั้งสิ้น' }),
        el('th', { style: 'text-align:left', text: money(r.amount) }),
      ])]),
    ]),
    el('div', { style: 'text-align:center;font-weight:700;margin:.5rem 0', text: `(${bahtTextClient(r.amount)})` }),
    el('div', { class: 'receipt-sign' }, [
      el('div', {}, [el('div', { class: 'line' }), el('div', { text: `( ${r.verified_by_name || '.........................'} )` }), el('div', { text: 'ผู้รับเงิน' })]),
      el('div', {}, [el('div', { class: 'line' }), el('div', { text: '( ......................................... )' }), el('div', { text: 'ผู้อนุมัติ' })]),
    ]),
  ]);

  const m = modal({
    title: `ใบเสร็จรับเงิน ${r.receipt_no}`, body: box, size: 'modal-lg',
    footer: [
      el('button', { class: 'btn', type: 'button', text: 'ปิด', onclick: () => m.close() }),
      el('button', { class: 'btn btn-primary', type: 'button', text: '🖨 พิมพ์', onclick: () => printElement(box) }),
    ],
  });
}

/** พิมพ์เฉพาะส่วนที่ระบุ โดยเปิดหน้าต่างใหม่ */
function printElement(node) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาตป๊อปอัปแล้วลองอีกครั้ง', 'warn', 6000);
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบเสร็จรับเงิน</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/admin.css">
    <style>body{background:#fff;padding:12mm}@page{size:A4;margin:12mm}</style></head><body></body></html>`);
  w.document.close();
  w.addEventListener('load', () => {
    w.document.body.appendChild(w.document.importNode(node, true));
    setTimeout(() => { w.focus(); w.print(); }, 350);
  });
}

/** แปลงจำนวนเงินเป็นตัวอักษรไทย (ฝั่งเบราว์เซอร์) */
function bahtTextClient(amount) {
  const NUM = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];
  const readInt = (str) => {
    str = String(str).replace(/^0+(?=\d)/, '');
    if (str === '' || str === '0') return 'ศูนย์';
    if (str.length > 7) {
      const head = str.slice(0, str.length - 6);
      const tail = str.slice(str.length - 6);
      return readInt(head) + 'ล้าน' + (/^0+$/.test(tail) ? '' : readInt(tail));
    }
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const dgt = Number(str[i]);
      const pos = str.length - i - 1;
      if (dgt === 0) continue;
      if (pos === 1) out += dgt === 1 ? 'สิบ' : dgt === 2 ? 'ยี่สิบ' : NUM[dgt] + 'สิบ';
      else if (pos === 0 && dgt === 1 && str.length > 1) out += 'เอ็ด';
      else out += NUM[dgt] + POS[pos];
    }
    return out;
  };
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const baht = Math.floor(Math.abs(n));
  const satang = Math.round((Math.abs(n) - baht) * 100);
  return readInt(String(baht)) + 'บาท' + (satang === 0 ? 'ถ้วน' : readInt(String(satang)) + 'สตางค์');
}
