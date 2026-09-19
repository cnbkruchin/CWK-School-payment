/* รายการจัดเก็บ: สร้าง แก้ไข กิจกรรมย่อย และกำหนดผู้ที่ต้องชำระ */
'use strict';

const COL_STATUS = { draft: ['badge-draft', 'ฉบับร่าง'], open: ['badge-open', 'เปิดรับชำระ'], closed: ['badge-closed', 'ปิดรับชำระ'] };

route('collections', {
  async render(view, params) {
    if (params[0]) return renderCollectionDetail(view, params[0]);

    const { collections } = await api('/api/admin/collections');
    view.innerHTML = '';
    view.appendChild(pageHead('รายการจัดเก็บ', 'สร้างและจัดการรายการเก็บเงินตามวัตถุประสงค์ (ไม่จำกัดจำนวน)', [
      canWrite() ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ สร้างรายการจัดเก็บ', onclick: () => openCollectionForm() }) : null,
    ]));

    if (!collections.length) {
      view.appendChild(el('div', { class: 'card' }, [
        emptyState('📋', 'ยังไม่มีรายการจัดเก็บ', 'เริ่มต้นด้วยการสร้างรายการเก็บเงินรายการแรก เช่น "เงินบำรุงการศึกษา ภาคเรียนที่ 1"',
          canWrite() ? el('button', { class: 'btn btn-primary', type: 'button', text: '+ สร้างรายการจัดเก็บ', onclick: () => openCollectionForm() }) : null),
      ]));
      return;
    }

    view.appendChild(el('div', { class: 'grid grid-2' }, collections.map((c) => {
      const s = c.summary;
      const [cls, label] = COL_STATUS[c.status] || ['badge-draft', c.status];
      return el('div', { class: 'card' }, [
        el('div', { class: 'row-between', style: 'align-items:flex-start' }, [
          el('div', { class: 'grow', style: 'min-width:0' }, [
            el('div', { class: 'row', style: 'gap:.35rem;margin-bottom:.2rem' }, [
              el('span', { class: 'chip', text: c.code }),
              el('span', { class: `badge ${cls}`, text: label }),
            ]),
            el('h3', { style: 'margin:.25rem 0 .1rem' }, [el('a', { href: `#/collections/${c.id}`, text: c.name })]),
            el('div', { class: 'tiny muted' }, [
              c.fiscal_year ? el('span', { text: `ปีการศึกษา ${c.fiscal_year} ` }) : null,
              c.term ? el('span', { text: `• ภาคเรียนที่ ${c.term} ` }) : null,
              c.due_date ? el('span', { text: `• ครบกำหนด ${thaiDate(c.due_date, { short: true })}` }) : null,
            ]),
          ]),
        ]),
        el('div', { class: 'row-between small', style: 'margin:.7rem 0 .25rem' }, [
          el('span', { class: 'muted', text: `${s.total_members} คน • ${c.item_count} กิจกรรมย่อย` }),
          el('span', { class: 'bold', text: `${money(s.total_paid)} / ${money(s.total_due)} บาท` }),
        ]),
        el('div', { class: 'progress' }, [el('span', { style: `width:${Math.min(100, s.percent_paid)}%` })]),
        el('div', { class: 'row', style: 'gap:.5rem;margin-top:.5rem;font-size:.78rem' }, [
          el('span', { style: 'color:var(--green-600)', text: `✓ ${s.count_paid}` }),
          el('span', { style: 'color:var(--amber-600)', text: `⏳ ${s.count_pending}` }),
          el('span', { style: 'color:var(--red-600)', text: `✕ ${s.count_unpaid + s.count_rejected}` }),
          el('span', { class: 'spacer' }),
          el('a', { class: 'btn btn-sm btn-primary', href: `#/collections/${c.id}`, text: 'จัดการ →' }),
        ]),
      ]);
    })));
  },
});

/* ============================ รายละเอียดรายการ ============================ */
let colFilters = { q: '', group: '', status: '' };

async function renderCollectionDetail(view, id) {
  const d = await api(`/api/admin/collections/${id}`);
  const c = d.collection;
  const s = d.summary;
  const [cls, label] = COL_STATUS[c.status] || ['badge-draft', c.status];

  view.innerHTML = '';
  view.appendChild(pageHead(c.name, `${c.code}${c.fiscal_year ? ` • ปีการศึกษา ${c.fiscal_year}` : ''}${c.term ? ` • ภาคเรียนที่ ${c.term}` : ''}`, [
    el('a', { class: 'btn btn-sm', href: '#/collections', text: '← กลับ' }),
    el('button', { class: 'btn btn-sm', type: 'button', text: '📊 รายงาน', onclick: () => { location.hash = `#/reports/collection/${c.id}`; } }),
    canWrite() ? el('button', { class: 'btn btn-sm', type: 'button', text: '✎ แก้ไข', onclick: () => openCollectionForm(c) }) : null,
  ]));

  /* ---- สถานะและปุ่มเปิด/ปิด ---- */
  const statusRow = el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row-between' }, [
      el('div', { class: 'row', style: 'gap:.6rem' }, [
        el('span', { class: `badge ${cls}`, text: label }),
        c.due_date ? el('span', { class: 'small muted', text: `กำหนดชำระภายใน ${thaiDate(c.due_date)}` }) : null,
        c.allow_partial ? el('span', { class: 'chip', text: 'ผ่อนชำระได้' }) : null,
        c.is_public ? null : el('span', { class: 'badge badge-draft', text: 'ซ่อนจากหน้าสาธารณะ' }),
      ]),
      canWrite() ? el('div', { class: 'row', style: 'gap:.4rem' }, [
        c.status !== 'open'
          ? el('button', { class: 'btn btn-sm btn-green', type: 'button', text: '▶ เปิดรับชำระ', onclick: () => setStatus(c.id, 'open') })
          : el('button', { class: 'btn btn-sm btn-amber', type: 'button', text: '⏸ ปิดรับชำระ', onclick: () => setStatus(c.id, 'closed') }),
        el('button', { class: 'btn btn-sm', type: 'button', text: '⧉ ทำสำเนา', onclick: () => duplicateCollection(c.id) }),
        el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑 ลบ', onclick: () => deleteCollection(c) }),
      ]) : null,
    ]),
    c.description ? el('p', { class: 'small muted', style: 'margin:.6rem 0 0', text: c.description }) : null,
  ]);
  view.appendChild(statusRow);

  view.appendChild(el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
    statCard('ผู้ต้องชำระ', String(s.total_members), 'คน', ''),
    statCard('ชำระแล้ว', String(s.count_paid), 'คน', 'is-green', `${money(s.total_paid)} บาท`),
    statCard('รอตรวจสอบ', String(s.count_pending), 'คน', 'is-amber'),
    statCard('ยังไม่ชำระ', String(s.count_unpaid + s.count_rejected), 'คน', 'is-red', `${money(s.total_outstanding)} บาท`),
  ]));

  /* ---- กิจกรรมย่อย ---- */
  const itemsCard = el('section', { class: 'card card-pad-0', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { style: 'font-size:1.05rem' }, [
        'กิจกรรมย่อยของการจัดเก็บ ',
        el('span', { class: 'chip', text: `ยอดรวมบังคับ ${money(c.base_amount)} บาท` }),
      ]),
      canWrite() ? el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: '+ เพิ่มกิจกรรมย่อย', onclick: () => openItemForm(c.id) }) : null,
    ]),
  ]);
  if (!d.items.length) {
    itemsCard.appendChild(emptyState('🧩', 'ยังไม่มีกิจกรรมย่อย',
      'เพิ่มกิจกรรมย่อยเพื่อระบุว่าเงินที่เก็บนำไปใช้ทำอะไรบ้าง พร้อมจำนวนเงินของแต่ละกิจกรรม'));
  } else {
    itemsCard.appendChild(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data cards' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'กิจกรรมย่อย' }),
          el('th', { class: 'num', text: 'จำนวนเงิน' }),
          el('th', { class: 'mid', text: 'ประเภท' }),
          el('th', { class: 'mid', style: 'width:110px' }),
        ])]),
        el('tbody', {}, d.items.map((it) =>
          el('tr', {}, [
            el('td', { 'data-label': 'กิจกรรมย่อย' }, [
              el('div', { class: 'bold', text: it.name }),
              it.description ? el('div', { class: 'tiny muted', text: it.description }) : null,
            ]),
            el('td', { class: 'num bold', 'data-label': 'จำนวนเงิน', text: money(it.amount) }),
            el('td', { class: 'mid', 'data-label': 'ประเภท' }, [
              el('span', { class: `badge ${it.is_optional ? 'badge-draft' : 'badge-open'}`, text: it.is_optional ? 'เลือกได้' : 'บังคับ' }),
            ]),
            el('td', { class: 'mid cell-full', 'data-label': '' }, [
              canWrite() ? el('div', { class: 'row', style: 'gap:.25rem;justify-content:center' }, [
                el('button', { class: 'btn btn-sm', type: 'button', text: '✎', title: 'แก้ไข', onclick: () => openItemForm(c.id, it) }),
                el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑', title: 'ลบ', onclick: () => deleteItem(c.id, it) }),
              ]) : null,
            ]),
          ]))),
        el('tfoot', {}, [el('tr', {}, [
          el('td', { text: 'รวมกิจกรรมบังคับ' }),
          el('td', { class: 'num', text: money(c.base_amount) }),
          el('td', { colspan: '2' }),
        ])]),
      ]),
    ]));
  }
  view.appendChild(itemsCard);

  /* ---- ผู้ที่ต้องชำระ ---- */
  const membersCard = el('section', { class: 'card card-pad-0' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { style: 'font-size:1.05rem', text: `ผู้ที่ต้องชำระ (${d.members.length} คน)` }),
      el('div', { class: 'row', style: 'gap:.4rem' }, [
        canWrite() ? el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: '+ เพิ่มผู้ต้องชำระ', onclick: () => openAssignModal(c, d.items) }) : null,
        el('button', { class: 'btn btn-sm', type: 'button', text: '⬇ Excel', onclick: () => download(`/api/admin/reports/collection/${c.id}/export?format=xlsx`, `รายงาน-${c.code}.xlsx`) }),
      ]),
    ]),
    el('div', { class: 'filters' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'ค้นหา' }),
        el('input', { type: 'search', placeholder: 'ชื่อ หรือรหัสสมาชิก', value: colFilters.q,
          oninput: debounce((e) => { colFilters.q = e.target.value; renderAssignRows(d, c); }, 250) }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'กลุ่ม/ชั้น' }),
        el('select', { onchange: (e) => { colFilters.group = e.target.value; renderAssignRows(d, c); } }, [
          el('option', { value: '', text: 'ทุกกลุ่ม' }),
          ...d.groups.map((g) => el('option', { value: String(g.id), text: g.name, selected: String(g.id) === colFilters.group })),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'สถานะ' }),
        el('select', { onchange: (e) => { colFilters.status = e.target.value; renderAssignRows(d, c); } }, [
          el('option', { value: '', text: 'ทุกสถานะ' }),
          ...['unpaid', 'pending', 'paid', 'partial', 'rejected', 'waived'].map((st) =>
            el('option', { value: st, text: STATUS_META[st].label, selected: st === colFilters.status })),
        ]),
      ]),
    ]),
    el('div', { id: 'assignList' }),
  ]);
  view.appendChild(membersCard);
  renderAssignRows(d, c);
}

function renderAssignRows(d, c) {
  const box = $('#assignList');
  if (!box) return;

  let rows = d.members;
  if (colFilters.group) {
    const gname = (d.groups.find((g) => String(g.id) === colFilters.group) || {}).name;
    rows = rows.filter((m) => m.group_name === gname);
  }
  if (colFilters.status) rows = rows.filter((m) => m.status === colFilters.status);
  if (colFilters.q) {
    const q = colFilters.q.trim().toLowerCase();
    rows = rows.filter((m) => m.full_name.toLowerCase().includes(q) || String(m.member_code).toLowerCase().includes(q));
  }

  box.innerHTML = '';
  if (!rows.length) {
    box.appendChild(emptyState('👥', 'ยังไม่มีผู้ที่ต้องชำระ',
      'กด "เพิ่มผู้ต้องชำระ" เพื่อเลือกสมาชิกเป็นรายกลุ่มหรือรายบุคคล พร้อมกำหนดยอดที่ต้องชำระ'));
    return;
  }

  box.appendChild(el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data cards' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { class: 'mid', style: 'width:55px', text: 'ลำดับ' }),
        el('th', { text: 'รหัส' }),
        el('th', { text: 'ชื่อ-สกุล' }),
        el('th', { class: 'mid', text: 'กลุ่ม/ชั้น' }),
        el('th', { class: 'num', text: 'ต้องชำระ' }),
        el('th', { class: 'num', text: 'ชำระแล้ว' }),
        el('th', { class: 'num', text: 'คงเหลือ' }),
        el('th', { class: 'mid', text: 'สถานะ' }),
        el('th', { class: 'mid', style: 'width:110px' }),
      ])]),
      el('tbody', {}, rows.map((m, i) => el('tr', {}, [
        el('td', { class: 'mid mono', 'data-label': 'ลำดับ', text: String(i + 1) }),
        el('td', { class: 'mono', 'data-label': 'รหัส', text: m.member_code }),
        el('td', { 'data-label': 'ชื่อ-สกุล' }, [
          el('a', { class: 'bold', href: `#/members/${m.member_id}`, text: m.full_name }),
          m.latest_ref ? el('div', { class: 'tiny muted', text: `เลขอ้างอิงล่าสุด ${m.latest_ref}` }) : null,
        ]),
        el('td', { class: 'mid small', 'data-label': 'กลุ่ม/ชั้น', text: m.group_name || '-' }),
        el('td', { class: 'num', 'data-label': 'ต้องชำระ', text: money(m.net_due) }),
        el('td', { class: 'num', 'data-label': 'ชำระแล้ว', text: money(m.paid_amount) }),
        el('td', { class: 'num bold', 'data-label': 'คงเหลือ', style: m.outstanding > 0 ? 'color:var(--red-600)' : '', text: money(m.outstanding) }),
        el('td', { class: 'mid', 'data-label': 'สถานะ' }, [statusBadge(m.status, m.status_label)]),
        el('td', { class: 'mid cell-full', 'data-label': '' }, [
          canWrite() ? el('div', { class: 'row', style: 'gap:.25rem;justify-content:center' }, [
            el('button', { class: 'btn btn-sm', type: 'button', text: '✎', title: 'แก้ไขยอด', onclick: () => openAssignEdit(c.id, m) }),
            el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑', title: 'นำออก', onclick: () => removeAssignment(c.id, m) }),
          ]) : null,
        ]),
      ]))),
      el('tfoot', {}, [el('tr', {}, [
        el('td', { colspan: '4', text: `รวม ${rows.length} คน` }),
        el('td', { class: 'num', text: money(rows.reduce((t, m) => t + (m.waived ? 0 : m.net_due), 0)) }),
        el('td', { class: 'num', text: money(rows.reduce((t, m) => t + m.paid_amount, 0)) }),
        el('td', { class: 'num', text: money(rows.reduce((t, m) => t + m.outstanding, 0)) }),
        el('td', { colspan: '2' }),
      ])]),
    ]),
  ]));
}

/* ============================== แบบฟอร์มต่าง ๆ ============================== */
function openCollectionForm(c) {
  if (needWrite()) return;
  const isEdit = !!c;
  const thisYear = new Date().getFullYear() + 543;

  const itemsBox = el('div', { id: 'itemsBox' });
  const addItemRow = (name = '', amount = '', optional = false) => {
    const row = el('div', { class: 'row', style: 'gap:.4rem;margin-bottom:.4rem' }, [
      el('input', { type: 'text', class: 'it-name grow', placeholder: 'ชื่อกิจกรรมย่อย เช่น ค่าบำรุงการศึกษา', value: name, style: 'flex:2 1 180px' }),
      el('input', { type: 'number', class: 'it-amount', placeholder: 'จำนวนเงิน', step: '0.01', min: '0', value: amount, style: 'flex:1 1 110px' }),
      el('label', { class: 'check', style: 'flex:0 0 auto;white-space:nowrap' }, [
        el('input', { type: 'checkbox', class: 'it-opt', checked: optional }),
        el('span', { class: 'small', text: 'เลือกได้' }),
      ]),
      el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '✕', onclick: (e) => e.target.closest('.row').remove() }),
    ]);
    itemsBox.appendChild(row);
  };

  const form = el('form', { id: 'colForm' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'cfName', text: 'วัตถุประสงค์ของการจัดเก็บ' }),
      el('input', { type: 'text', id: 'cfName', required: true, maxlength: '200', value: c ? c.name : '', placeholder: 'เช่น เงินบำรุงการศึกษา ภาคเรียนที่ 1' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'cfDesc', text: 'รายละเอียดเพิ่มเติม' }),
      el('textarea', { id: 'cfDesc', rows: '2', maxlength: '1000', text: c ? (c.description || '') : '' }),
    ]),
    el('div', { class: 'grid grid-3', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'cfYear', text: 'ปีการศึกษา' }),
        el('input', { type: 'text', id: 'cfYear', maxlength: '20', value: c ? (c.fiscal_year || '') : String(thisYear) }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'cfTerm', text: 'ภาคเรียน' }),
        el('select', { id: 'cfTerm' }, ['', '1', '2', '3'].map((t) =>
          el('option', { value: t, text: t ? `ภาคเรียนที่ ${t}` : 'ไม่ระบุ', selected: c && String(c.term) === t }))),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'cfDue', text: 'กำหนดชำระภายใน' }),
        el('input', { type: 'date', id: 'cfDue', value: c ? (c.due_date || '') : '' }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'cfAmount', text: 'ยอดตั้งต้นต่อคน (บาท)' }),
      el('input', { type: 'number', id: 'cfAmount', step: '0.01', min: '0', value: c ? String(c.default_amount) : '0' }),
      el('div', { class: 'hint', text: 'ใช้เมื่อไม่ได้กำหนดกิจกรรมย่อย — หากมีกิจกรรมย่อยแบบบังคับ ระบบจะใช้ผลรวมของกิจกรรมย่อยแทน' }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'cfPartial', checked: c ? !!c.allow_partial : false }),
      el('span', {}, [el('span', { class: 'bold', text: 'อนุญาตให้ผ่อนชำระ' }), el('div', { class: 'tiny muted', text: 'สมาชิกสามารถแจ้งชำระบางส่วนได้หลายครั้งจนครบยอด' })]),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'cfPublic', checked: c ? !!c.is_public : true }),
      el('span', {}, [el('span', { class: 'bold', text: 'แสดงบนหน้าสาธารณะ' }), el('div', { class: 'tiny muted', text: 'ให้สมาชิกเห็นและแจ้งชำระผ่านหน้าเว็บได้' })]),
    ]),
  ]);

  if (!isEdit) {
    form.appendChild(el('fieldset', { style: 'margin-top:1rem' }, [
      el('legend', { text: 'กิจกรรมย่อยและจำนวนเงิน (เพิ่มได้ไม่จำกัด)' }),
      itemsBox,
      el('button', { class: 'btn btn-sm', type: 'button', text: '+ เพิ่มกิจกรรมย่อย', onclick: () => addItemRow() }),
    ]));
    addItemRow();
  }

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'colForm', text: isEdit ? 'บันทึกการแก้ไข' : 'สร้างรายการจัดเก็บ' });
  const m = modal({
    title: isEdit ? 'แก้ไขรายการจัดเก็บ' : 'สร้างรายการจัดเก็บใหม่', body: form, size: 'modal-lg',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังบันทึก...');
    const payload = {
      name: $('#cfName', form).value,
      description: $('#cfDesc', form).value,
      fiscal_year: $('#cfYear', form).value,
      term: $('#cfTerm', form).value,
      due_date: $('#cfDue', form).value,
      default_amount: $('#cfAmount', form).value,
      allow_partial: $('#cfPartial', form).checked,
      is_public: $('#cfPublic', form).checked,
    };
    if (!isEdit) {
      payload.items = $$('.row', itemsBox).map((r) => ({
        name: $('.it-name', r).value,
        amount: $('.it-amount', r).value || 0,
        is_optional: $('.it-opt', r).checked,
      })).filter((x) => x.name.trim());
    }
    try {
      const r = isEdit
        ? await api(`/api/admin/collections/${c.id}`, { method: 'PUT', body: payload })
        : await api('/api/admin/collections', { method: 'POST', body: payload });
      m.close();
      toast(isEdit ? 'บันทึกการแก้ไขเรียบร้อย' : 'สร้างรายการจัดเก็บเรียบร้อย', 'success');
      if (!isEdit) location.hash = `#/collections/${r.id}`;
      else handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

function openItemForm(collectionId, item) {
  if (needWrite()) return;
  const form = el('form', { id: 'itForm' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'ifName', text: 'ชื่อกิจกรรมย่อย' }),
      el('input', { type: 'text', id: 'ifName', required: true, maxlength: '200', value: item ? item.name : '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'ifDesc', text: 'รายละเอียด' }),
      el('input', { type: 'text', id: 'ifDesc', maxlength: '500', value: item ? (item.description || '') : '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'ifAmount', text: 'จำนวนเงิน (บาท)' }),
      el('input', { type: 'number', id: 'ifAmount', step: '0.01', min: '0', required: true, value: item ? String(item.amount) : '' }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'ifOpt', checked: item ? !!item.is_optional : false }),
      el('span', {}, [el('span', { class: 'bold', text: 'เป็นรายการที่เลือกได้' }), el('div', { class: 'tiny muted', text: 'ไม่นับรวมในยอดบังคับ — ใช้เมื่อเลือกกำหนดเฉพาะบางคน' })]),
    ]),
    item ? el('div', { class: 'alert alert-warn small' }, ['การแก้ไขจำนวนเงินจะปรับยอดของสมาชิกที่ผูกกับกิจกรรมย่อยนี้ไว้โดยอัตโนมัติ']) : null,
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'itForm', text: item ? 'บันทึก' : 'เพิ่มกิจกรรมย่อย' });
  const m = modal({
    title: item ? 'แก้ไขกิจกรรมย่อย' : 'เพิ่มกิจกรรมย่อย', body: form, size: 'modal-sm',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true);
    const payload = {
      name: $('#ifName', form).value, description: $('#ifDesc', form).value,
      amount: $('#ifAmount', form).value, is_optional: $('#ifOpt', form).checked,
    };
    try {
      if (item) await api(`/api/admin/collections/${collectionId}/items/${item.id}`, { method: 'PUT', body: payload });
      else await api(`/api/admin/collections/${collectionId}/items`, { method: 'POST', body: payload });
      m.close();
      toast('บันทึกเรียบร้อย', 'success');
      handleRoute();
    } catch (ex) { toast(ex.message, 'error'); busy(btn, false); }
  });
}

async function deleteItem(collectionId, item) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'ลบกิจกรรมย่อย', danger: true, confirmText: 'ลบ',
    message: `ต้องการลบ "${item.name}" (${money(item.amount)} บาท) ใช่หรือไม่? ยอดของสมาชิกที่ผูกกับกิจกรรมนี้จะถูกคำนวณใหม่`,
  }))) return;
  try {
    await api(`/api/admin/collections/${collectionId}/items/${item.id}`, { method: 'DELETE' });
    toast('ลบกิจกรรมย่อยแล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

/* --------------------- กำหนดผู้ที่ต้องชำระ (กลุ่ม/รายบุคคล) --------------------- */
async function openAssignModal(c, items) {
  if (needWrite()) return;
  const [groupsRes, availRes] = await Promise.all([
    api('/api/admin/groups'),
    api(`/api/admin/collections/${c.id}/available-members`),
  ]);
  const groups = groupsRes.groups.filter((g) => g.member_count > 0);
  const avail = availRes.members;

  let mode = 'group';
  const selectedMembers = new Set();

  const modeBox = el('div', { class: 'tabs' }, [
    el('button', { class: 'tab active', type: 'button', dataset: { mode: 'group' }, text: '📁 เลือกทั้งกลุ่ม' }),
    el('button', { class: 'tab', type: 'button', dataset: { mode: 'members' }, text: '👤 เลือกรายบุคคล' }),
    el('button', { class: 'tab', type: 'button', dataset: { mode: 'all' }, text: '🌐 สมาชิกทั้งหมด' }),
  ]);

  const paneGroup = el('div', {}, [
    el('div', { class: 'label', text: 'เลือกกลุ่ม/ชั้นเรียนที่ต้องชำระ' }),
    groups.length
      ? el('div', { style: 'max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:.5rem' },
          groups.map((g) => el('label', { class: 'check' }, [
            el('input', { type: 'checkbox', class: 'grp-check', value: String(g.id) }),
            el('span', {}, [g.name, el('span', { class: 'muted small', text: ` (${g.member_count} คน)` })]),
          ])))
      : el('div', { class: 'alert alert-warn' }, ['ยังไม่มีกลุ่มที่มีสมาชิก กรุณาเพิ่มสมาชิกก่อน']),
  ]);

  const memberList = el('div', { id: 'availList', style: 'max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:.5rem' });
  const renderAvail = (q = '') => {
    memberList.innerHTML = '';
    const rows = q
      ? avail.filter((m) => m.full_name.toLowerCase().includes(q.toLowerCase()) || String(m.member_code).toLowerCase().includes(q.toLowerCase()))
      : avail;
    if (!rows.length) { memberList.appendChild(el('div', { class: 'muted small center', style: 'padding:1rem', text: 'ไม่พบสมาชิกที่ยังไม่อยู่ในรายการนี้' })); return; }
    for (const m of rows) {
      memberList.appendChild(el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox', value: String(m.id), checked: selectedMembers.has(m.id),
          onchange: (e) => { if (e.target.checked) selectedMembers.add(m.id); else selectedMembers.delete(m.id); updateCount(); },
        }),
        el('span', { class: 'small' }, [
          el('span', { class: 'mono', text: m.member_code }), ' ', m.full_name,
          m.group_name ? el('span', { class: 'muted', text: ` • ${m.group_name}` }) : null,
        ]),
      ]));
    }
  };
  const countLabel = el('span', { class: 'chip', text: 'เลือกแล้ว 0 คน' });
  const updateCount = () => { countLabel.textContent = `เลือกแล้ว ${selectedMembers.size} คน`; };

  const paneMembers = el('div', { class: 'hidden' }, [
    el('div', { class: 'row-between', style: 'margin-bottom:.4rem' }, [
      el('span', { class: 'label', style: 'margin:0', text: 'เลือกสมาชิกรายบุคคล' }), countLabel,
    ]),
    el('input', { type: 'search', placeholder: 'ค้นหาชื่อหรือรหัส...', style: 'margin-bottom:.4rem', oninput: debounce((e) => renderAvail(e.target.value), 200) }),
    memberList,
    el('div', { class: 'row', style: 'gap:.35rem;margin-top:.4rem' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: 'เลือกทั้งหมดที่แสดง', onclick: () => { $$('input[type=checkbox]', memberList).forEach((cb) => { cb.checked = true; selectedMembers.add(Number(cb.value)); }); updateCount(); } }),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'ล้างการเลือก', onclick: () => { selectedMembers.clear(); $$('input[type=checkbox]', memberList).forEach((cb) => { cb.checked = false; }); updateCount(); } }),
    ]),
  ]);
  renderAvail();

  const paneAll = el('div', { class: 'hidden' }, [
    el('div', { class: 'alert alert-warn' }, [`จะเพิ่มสมาชิกที่เปิดใช้งานทั้งหมดเข้ารายการนี้ (ยังไม่อยู่ในรายการ ${avail.length} คน)`]),
  ]);

  /* กิจกรรมย่อยที่เลือกให้ชุดนี้ */
  const itemChecks = el('div', {},
    items.map((it) => el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', class: 'ai-check', value: String(it.id), checked: !it.is_optional, dataset: { amount: String(it.amount) }, onchange: calcAmount }),
      el('span', { class: 'small' }, [it.name, el('span', { class: 'muted', text: ` — ${money(it.amount)} บาท` })]),
    ])));

  const amountInput = el('input', { type: 'number', id: 'asAmount', step: '0.01', min: '0', value: String(c.base_amount || c.default_amount || 0) });
  function calcAmount() {
    if (!items.length) return;
    const total = $$('.ai-check', itemChecks).filter((x) => x.checked).reduce((s, x) => s + Number(x.dataset.amount), 0);
    amountInput.value = String(Math.round(total * 100) / 100);
  }

  const form = el('form', { id: 'asForm' }, [
    modeBox, paneGroup, paneMembers, paneAll,
    el('hr', { class: 'divider' }),
    items.length ? el('fieldset', {}, [
      el('legend', { text: 'กิจกรรมย่อยที่ต้องชำระ' }),
      itemChecks,
      el('div', { class: 'hint', text: 'ติ๊กเลือกเฉพาะกิจกรรมที่กลุ่ม/บุคคลนี้ต้องชำระ ยอดรวมจะคำนวณให้อัตโนมัติ' }),
    ]) : null,
    el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { class: 'req', for: 'asAmount', text: 'ยอดที่ต้องชำระต่อคน (บาท)' }), amountInput,
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'asDiscount', text: 'ส่วนลด (บาท)' }),
        el('input', { type: 'number', id: 'asDiscount', step: '0.01', min: '0', value: '0' }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'asNote', text: 'หมายเหตุ' }),
      el('input', { type: 'text', id: 'asNote', maxlength: '500' }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'asOverwrite' }),
      el('span', {}, [el('span', { class: 'bold', text: 'แก้ไขยอดของผู้ที่อยู่ในรายการอยู่แล้ว' }), el('div', { class: 'tiny muted', text: 'ข้ามผู้ที่มีการแจ้งชำระแล้วเสมอ เพื่อไม่ให้กระทบข้อมูลการเงิน' })]),
    ]),
  ]);

  $$('button.tab', modeBox).forEach((t) => t.addEventListener('click', () => {
    mode = t.dataset.mode;
    $$('button.tab', modeBox).forEach((x) => x.classList.toggle('active', x === t));
    paneGroup.classList.toggle('hidden', mode !== 'group');
    paneMembers.classList.toggle('hidden', mode !== 'members');
    paneAll.classList.toggle('hidden', mode !== 'all');
  }));

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'asForm', text: 'เพิ่มผู้ที่ต้องชำระ' });
  const m = modal({
    title: `กำหนดผู้ที่ต้องชำระ — ${c.name}`, body: form, size: 'modal-lg',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      mode,
      amount: amountInput.value,
      discount: $('#asDiscount', form).value,
      note: $('#asNote', form).value,
      overwrite: $('#asOverwrite', form).checked,
      item_ids: items.length ? $$('.ai-check', itemChecks).filter((x) => x.checked).map((x) => Number(x.value)) : [],
    };
    if (mode === 'group') {
      payload.group_ids = $$('.grp-check', paneGroup).filter((x) => x.checked).map((x) => Number(x.value));
      if (!payload.group_ids.length) return toast('กรุณาเลือกกลุ่มอย่างน้อย 1 กลุ่ม', 'warn');
    } else if (mode === 'members') {
      payload.member_ids = [...selectedMembers];
      if (!payload.member_ids.length) return toast('กรุณาเลือกสมาชิกอย่างน้อย 1 คน', 'warn');
    }

    busy(btn, true, 'กำลังบันทึก...');
    try {
      const r = await api(`/api/admin/collections/${c.id}/assign`, { method: 'POST', body: payload });
      m.close();
      toast(`เพิ่ม ${r.created} คน • แก้ไข ${r.updated} คน • ข้าม ${r.skipped} คน (ยอด ${money(r.amount)} บาท/คน)`, 'success', 6000);
      handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

function openAssignEdit(collectionId, m2) {
  if (needWrite()) return;
  const form = el('form', { id: 'aeForm' }, [
    el('div', { class: 'card', style: 'background:var(--surface-2);margin-bottom:1rem;padding:.7rem' }, [
      el('div', { class: 'bold', text: m2.full_name }),
      el('div', { class: 'tiny muted', text: `${m2.member_code}${m2.group_name ? ' • ' + m2.group_name : ''} • ชำระแล้ว ${money(m2.paid_amount)} บาท` }),
    ]),
    el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { class: 'req', for: 'aeAmount', text: 'ยอดที่ต้องชำระ (บาท)' }),
        el('input', { type: 'number', id: 'aeAmount', step: '0.01', min: '0', required: true, value: String(m2.amount_due) }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'aeDiscount', text: 'ส่วนลด (บาท)' }),
        el('input', { type: 'number', id: 'aeDiscount', step: '0.01', min: '0', value: String(m2.discount || 0) }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'aeNote', text: 'หมายเหตุ' }),
      el('input', { type: 'text', id: 'aeNote', maxlength: '500', value: m2.note || '' }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'aeWaived', checked: !!m2.waived }),
      el('span', {}, [el('span', { class: 'bold', text: 'ยกเว้นการชำระ' }), el('div', { class: 'tiny muted', text: 'ใช้กรณีได้รับทุนหรือได้รับการยกเว้น — สถานะจะแสดงเป็น "ยกเว้นการชำระ"' })]),
    ]),
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'aeForm', text: 'บันทึก' });
  const m = modal({
    title: 'แก้ไขยอดที่ต้องชำระ', body: form, size: 'modal-sm',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true);
    try {
      await api(`/api/admin/collections/${collectionId}/assignments/${m2.assignment_id}`, {
        method: 'PUT',
        body: {
          amount_due: $('#aeAmount', form).value, discount: $('#aeDiscount', form).value,
          note: $('#aeNote', form).value, waived: $('#aeWaived', form).checked,
        },
      });
      m.close();
      toast('บันทึกเรียบร้อย', 'success');
      handleRoute();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

async function removeAssignment(collectionId, m2) {
  if (needWrite()) return;
  const force = m2.payment_count > 0;
  if (!(await confirmDialog({
    title: 'นำสมาชิกออกจากรายการ', danger: true, confirmText: 'นำออก',
    message: force
      ? `${m2.full_name} มีการแจ้งชำระแล้ว ${m2.payment_count} รายการ การนำออกจะลบข้อมูลการชำระทั้งหมดด้วย ยืนยันหรือไม่?`
      : `ต้องการนำ ${m2.full_name} ออกจากรายการจัดเก็บนี้ใช่หรือไม่?`,
  }))) return;
  try {
    await api(`/api/admin/collections/${collectionId}/assignments/${m2.assignment_id}${force ? '?force=1' : ''}`, { method: 'DELETE' });
    toast('นำออกเรียบร้อย', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error', 6000); }
}

async function setStatus(id, status) {
  if (needWrite()) return;
  try {
    await api(`/api/admin/collections/${id}/status`, { method: 'POST', body: { status } });
    toast(status === 'open' ? 'เปิดรับชำระแล้ว — สมาชิกสามารถแจ้งชำระได้ทันที' : 'ปิดรับชำระแล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error', 6000); }
}

async function duplicateCollection(id) {
  if (needWrite()) return;
  const withMembers = await confirmDialog({
    title: 'ทำสำเนารายการจัดเก็บ',
    message: 'ต้องการคัดลอกรายชื่อผู้ที่ต้องชำระไปด้วยหรือไม่? (กิจกรรมย่อยจะถูกคัดลอกเสมอ)',
    confirmText: 'คัดลอกพร้อมรายชื่อ', cancelText: 'คัดลอกเฉพาะโครงสร้าง',
  });
  try {
    const r = await api(`/api/admin/collections/${id}/duplicate`, { method: 'POST', body: { with_members: withMembers } });
    toast('ทำสำเนาเรียบร้อย (สถานะเป็นฉบับร่าง)', 'success');
    location.hash = `#/collections/${r.id}`;
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteCollection(c) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'ลบรายการจัดเก็บ', danger: true, confirmText: 'ลบถาวร',
    message: `ต้องการลบ "${c.name}" ใช่หรือไม่? ข้อมูลผู้ต้องชำระและประวัติการชำระทั้งหมดของรายการนี้จะถูกลบไปด้วย และไม่สามารถกู้คืนได้`,
  }))) return;
  try {
    await api(`/api/admin/collections/${c.id}`, { method: 'DELETE' });
    toast('ลบรายการจัดเก็บแล้ว', 'success');
    location.hash = '#/collections';
  } catch (e) {
    if (e.status === 409) {
      if (!(await confirmDialog({ title: 'ยืนยันอีกครั้ง', danger: true, confirmText: 'ลบถาวร', message: e.message }))) return;
      try {
        await api(`/api/admin/collections/${c.id}?force=1`, { method: 'DELETE' });
        toast('ลบรายการจัดเก็บแล้ว', 'success');
        location.hash = '#/collections';
      } catch (e2) { toast(e2.message, 'error'); }
    } else toast(e.message, 'error');
  }
}
