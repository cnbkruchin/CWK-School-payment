/* รายงานและการส่งออก */
'use strict';

let repTab = 'overview';
let repFilters = { collection: '', group: '', member: '', from: '', to: '', status: 'approved' };

route('reports', {
  async render(view, params) {
    if (params[0] === 'collection' && params[1]) { repTab = 'collection'; repFilters.collection = params[1]; }
    if (params[0] === 'member' && params[1]) { repTab = 'member'; repFilters.member = params[1]; }

    view.innerHTML = '';
    view.appendChild(pageHead('รายงานและการส่งออก', 'ออกรายงานภาพรวม รายชุด และรายบุคคล พร้อมส่งออกเป็น Excel, CSV หรือพิมพ์เป็น PDF'));

    const tabs = el('div', { class: 'tabs no-print' }, [
      mkTab('overview', '📊 ภาพรวมทุกรายการ'),
      mkTab('collection', '📋 รายงานรายชุด'),
      mkTab('members', '👥 สรุปรายบุคคล (ทุกคน)'),
      mkTab('member', '👤 รายบุคคล (รายคน)'),
      mkTab('transactions', '🧾 รายการรับชำระ'),
      mkTab('outstanding', '⚠️ รายชื่อค้างชำระ'),
    ]);
    view.appendChild(tabs);
    view.appendChild(el('div', { id: 'repBody' }));
    await renderReportTab();
  },
});

function mkTab(key, label) {
  return el('button', {
    class: `tab${repTab === key ? ' active' : ''}`, type: 'button', text: label,
    onclick: () => {
      repTab = key;
      $$('.tabs .tab').forEach((t) => t.classList.toggle('active', t.textContent === label));
      renderReportTab();
    },
  });
}

async function renderReportTab() {
  const box = $('#repBody');
  box.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังสร้างรายงาน...</div>';
  try {
    if (repTab === 'overview') await repOverview(box);
    else if (repTab === 'collection') await repCollection(box);
    else if (repTab === 'members') await repAllMembers(box);
    else if (repTab === 'member') await repMember(box);
    else if (repTab === 'transactions') await repTransactions(box);
    else if (repTab === 'outstanding') await repOutstanding(box);
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'card' }, [el('div', { class: 'alert alert-error' }, [e.message])]));
  }
}

function exportBar(basePath, params = {}, filename = 'report') {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  return el('div', { class: 'row no-print', style: 'gap:.4rem' }, [
    el('button', { class: 'btn btn-sm btn-green', type: 'button', text: '⬇ Excel (.xlsx)',
      onclick: async (e) => { busy(e.target, true, 'กำลังสร้าง...'); try { await download(`${basePath}?${q}&format=xlsx`, `${filename}.xlsx`); } catch (ex) { toast(ex.message, 'error'); } finally { busy(e.target, false); } } }),
    el('button', { class: 'btn btn-sm', type: 'button', text: '⬇ CSV',
      onclick: async (e) => { busy(e.target, true, 'กำลังสร้าง...'); try { await download(`${basePath}?${q}&format=csv`, `${filename}.csv`); } catch (ex) { toast(ex.message, 'error'); } finally { busy(e.target, false); } } }),
    el('button', { class: 'btn btn-sm', type: 'button', text: '🖨 พิมพ์ / PDF', onclick: () => window.print() }),
  ]);
}

function reportTable(columns, rows, totals) {
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data' }, [
      el('thead', {}, [el('tr', {}, columns.map((c) => el('th', { class: c.cls || '', text: c.header })))]),
      el('tbody', {}, rows.length
        ? rows.map((r) => el('tr', {}, columns.map((c) => c.render
            ? el('td', { class: c.cls || '' }, [c.render(r)])
            : el('td', { class: c.cls || '', text: c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? '-') }))))
        : [el('tr', {}, [el('td', { colspan: String(columns.length), class: 'center muted', style: 'padding:2rem', text: 'ไม่มีข้อมูลตามเงื่อนไขที่เลือก' })])]),
      totals ? el('tfoot', {}, [el('tr', {}, columns.map((c, i) =>
        el('td', { class: c.cls || '', text: i === 0 ? (totals.__label || 'รวมทั้งสิ้น') : (totals[c.key] !== undefined ? money(totals[c.key]) : '') })))]) : null,
    ]),
  ]);
}

/* ============================== ภาพรวมทุกรายการ ============================== */
async function repOverview(box) {
  const d = await api('/api/admin/reports/overview');
  box.innerHTML = '';

  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row-between' }, [
      el('h2', { style: 'font-size:1.1rem;margin:0', text: 'รายงานภาพรวมการรับชำระเงินทุกรายการ' }),
      exportBar('/api/admin/reports/overview/export', {}, 'รายงานภาพรวม'),
    ]),
  ]));

  box.appendChild(el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
    statCard('ยอดที่ต้องเก็บ', money(d.totals.total_due), 'บาท', 'is-blue'),
    statCard('ยอดที่เก็บได้', money(d.totals.total_paid), 'บาท', 'is-green', `${d.totals.percent}%`),
    statCard('ยอดค้างชำระ', money(d.totals.outstanding), 'บาท', 'is-red'),
    statCard('รายการจัดเก็บ', String(d.rows.length), 'รายการ', ''),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0' }, [
    reportTable([
      { header: 'รหัส', key: 'code', cls: 'mono' },
      { header: 'วัตถุประสงค์การจัดเก็บ', key: 'name', render: (r) => el('a', { href: `#/collections/${r.id}`, class: 'bold', text: r.name }) },
      { header: 'ปี/ภาค', key: 'fiscal_year', cls: 'mid', fmt: (v, r) => `${v || '-'}${r.term !== '-' ? '/' + r.term : ''}` },
      { header: 'สถานะ', key: 'status_label', cls: 'mid' },
      { header: 'ผู้ต้องชำระ', key: 'members', cls: 'num' },
      { header: 'ยอดที่ต้องเก็บ', key: 'total_due', cls: 'num', fmt: money },
      { header: 'เก็บได้', key: 'total_paid', cls: 'num', fmt: money },
      { header: 'คงค้าง', key: 'outstanding', cls: 'num', fmt: money },
      { header: 'ชำระแล้ว', key: 'paid_count', cls: 'num' },
      { header: 'รอตรวจ', key: 'pending_count', cls: 'num' },
      { header: 'ค้าง', key: 'unpaid_count', cls: 'num' },
      { header: '%', key: 'percent', cls: 'num', fmt: (v) => `${v}%` },
    ], d.rows, {
      __label: 'รวมทั้งสิ้น', total_due: d.totals.total_due, total_paid: d.totals.total_paid,
      outstanding: d.totals.outstanding,
    }),
  ]));
}

/* ============================== รายงานรายชุด ============================== */
async function repCollection(box) {
  const { collections } = await api('/api/admin/collections');
  const usable = collections.filter((c) => c.status !== 'draft');
  box.innerHTML = '';

  if (!usable.length) {
    box.appendChild(el('div', { class: 'card' }, [emptyState('📋', 'ยังไม่มีรายการจัดเก็บที่เปิดใช้งาน')]));
    return;
  }
  if (!repFilters.collection || !usable.some((c) => String(c.id) === String(repFilters.collection))) {
    repFilters.collection = String(usable[0].id);
  }

  const sel = el('select', { onchange: (e) => { repFilters.collection = e.target.value; renderReportTab(); } },
    usable.map((c) => el('option', { value: String(c.id), text: `${c.name} (${c.code})`, selected: String(c.id) === String(repFilters.collection) })));
  const statusSel = el('select', { onchange: (e) => { repFilters.repStatus = e.target.value; renderReportTab(); } }, [
    el('option', { value: '', text: 'ทุกสถานะ' }),
    ...['unpaid', 'pending', 'paid', 'partial', 'rejected', 'waived'].map((s) =>
      el('option', { value: s, text: STATUS_META[s].label, selected: s === repFilters.repStatus })),
  ]);

  const d = await api(`/api/admin/reports/collection/${repFilters.collection}?${new URLSearchParams(
    Object.entries({ group: repFilters.group, status: repFilters.repStatus || '' }).filter(([, v]) => v))}`);

  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row', style: 'gap:.6rem;align-items:flex-end' }, [
      el('div', { class: 'field grow', style: 'margin:0' }, [el('label', { text: 'รายการจัดเก็บ' }), sel]),
      el('div', { class: 'field', style: 'margin:0;min-width:160px' }, [el('label', { text: 'กรองสถานะ' }), statusSel]),
      exportBar(`/api/admin/reports/collection/${repFilters.collection}/export`,
        { group: repFilters.group, status: repFilters.repStatus || '' }, `รายงาน-${d.collection.code}`),
    ]),
  ]));

  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('h2', { style: 'font-size:1.15rem;margin:0', text: d.collection.name }),
    el('div', { class: 'small muted' }, [
      `${d.collection.code}`,
      d.collection.fiscal_year ? ` • ปีการศึกษา ${d.collection.fiscal_year}` : '',
      d.collection.term ? ` • ภาคเรียนที่ ${d.collection.term}` : '',
      d.collection.due_date ? ` • กำหนดชำระ ${thaiDate(d.collection.due_date)}` : '',
    ]),
    el('div', { class: 'grid grid-4', style: 'margin-top:.8rem' }, [
      statCard('ผู้ต้องชำระ', String(d.summary.total_members), 'คน', ''),
      statCard('ยอดที่ต้องเก็บ', money(d.summary.total_due), 'บาท', 'is-blue'),
      statCard('เก็บได้', money(d.summary.total_paid), 'บาท', 'is-green', `${d.summary.percent_paid}%`),
      statCard('คงค้าง', money(d.summary.total_outstanding), 'บาท', 'is-red'),
    ]),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0' }, [
    reportTable([
      { header: 'ลำดับ', key: 'no', cls: 'mid mono' },
      { header: 'รหัส', key: 'member_code', cls: 'mono' },
      { header: 'ชื่อ-สกุล', key: 'full_name' },
      { header: 'กลุ่ม/ชั้น', key: 'group_name', cls: 'mid' },
      { header: 'ต้องชำระ', key: 'amount_due', cls: 'num', fmt: money },
      { header: 'ชำระแล้ว', key: 'paid_amount', cls: 'num', fmt: money },
      { header: 'คงเหลือ', key: 'outstanding', cls: 'num', fmt: money },
      { header: 'สถานะ', key: 'status_label', cls: 'mid' },
      { header: 'เลขอ้างอิง', key: 'ref_code', cls: 'mid mono' },
      { header: 'วันที่อนุมัติ', key: 'verified_at', cls: 'mid', fmt: (v) => (v ? thaiDate(v, { short: true }) : '-') },
    ], d.rows, {
      __label: 'รวมทั้งสิ้น', amount_due: d.summary.total_due,
      paid_amount: d.summary.total_paid, outstanding: d.summary.total_outstanding,
    }),
  ]));
}

/* ========================== สรุปรายบุคคล (ทุกคน) ========================== */
async function repAllMembers(box) {
  const [groupsRes, colsRes] = await Promise.all([api('/api/admin/groups'), api('/api/admin/collections')]);
  const p = new URLSearchParams();
  if (repFilters.group) p.set('group', repFilters.group);
  if (repFilters.collection) p.set('collection', repFilters.collection);
  if (repFilters.from) p.set('from', repFilters.from);
  if (repFilters.to) p.set('to', repFilters.to);
  const d = await api(`/api/admin/reports/members?${p}`);

  box.innerHTML = '';
  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row', style: 'gap:.6rem;align-items:flex-end' }, [
      el('div', { class: 'field', style: 'margin:0;min-width:150px' }, [
        el('label', { text: 'กลุ่ม/ชั้น' }),
        el('select', { onchange: (e) => { repFilters.group = e.target.value; renderReportTab(); } }, [
          el('option', { value: '', text: 'ทุกกลุ่ม' }),
          ...groupsRes.groups.map((g) => el('option', { value: String(g.id), text: g.name, selected: String(g.id) === repFilters.group })),
        ]),
      ]),
      el('div', { class: 'field', style: 'margin:0;min-width:180px' }, [
        el('label', { text: 'เฉพาะรายการจัดเก็บ' }),
        el('select', { onchange: (e) => { repFilters.collection = e.target.value; renderReportTab(); } }, [
          el('option', { value: '', text: 'ทุกรายการ (รวมทั้งหมด)' }),
          ...colsRes.collections.filter((c) => c.status !== 'draft').map((c) =>
            el('option', { value: String(c.id), text: c.name, selected: String(c.id) === repFilters.collection })),
        ]),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { text: 'ตั้งแต่วันที่' }),
        el('input', { type: 'date', value: repFilters.from, onchange: (e) => { repFilters.from = e.target.value; renderReportTab(); } }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { text: 'ถึงวันที่' }),
        el('input', { type: 'date', value: repFilters.to, onchange: (e) => { repFilters.to = e.target.value; renderReportTab(); } }),
      ]),
      exportBar('/api/admin/reports/members/export',
        { group: repFilters.group, collection: repFilters.collection, from: repFilters.from, to: repFilters.to },
        'สรุปรายบุคคลทุกคน'),
    ]),
  ]));

  box.appendChild(el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
    statCard('สมาชิก', String(d.rows.length), 'คน', ''),
    statCard('ยอดที่ต้องชำระรวม', money(d.totals.total_due), 'บาท', 'is-blue'),
    statCard('ชำระแล้วรวม', money(d.totals.total_paid), 'บาท', 'is-green'),
    statCard('ค้างชำระรวม', money(d.totals.outstanding), 'บาท', 'is-red'),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0' }, [
    reportTable([
      { header: 'ลำดับ', key: 'no', cls: 'mid mono' },
      { header: 'รหัส', key: 'member_code', cls: 'mono' },
      { header: 'ชื่อ-สกุล', key: 'full_name',
        render: (r) => el('a', { href: `#/members/${r.member_id}`, class: 'bold', text: r.full_name }) },
      { header: 'กลุ่ม/ชั้น', key: 'group_name', cls: 'mid' },
      { header: 'จำนวนรอบ', key: 'rounds', cls: 'num' },
      { header: 'ต้องชำระรวม', key: 'total_due', cls: 'num', fmt: money },
      { header: 'ชำระแล้วรวม', key: 'total_paid', cls: 'num', fmt: money },
      { header: 'ค้างชำระ', key: 'outstanding', cls: 'num', fmt: money },
      { header: 'ครบ', key: 'paid_rounds', cls: 'num' },
      { header: 'รอตรวจ', key: 'pending_rounds', cls: 'num' },
      { header: 'ค้าง', key: 'unpaid_rounds', cls: 'num' },
      { header: '%', key: 'percent', cls: 'num', fmt: (v) => `${v}%` },
    ], d.rows, {
      __label: 'รวมทั้งสิ้น', total_due: d.totals.total_due,
      total_paid: d.totals.total_paid, outstanding: d.totals.outstanding,
    }),
  ]));
}

/* =========================== รายบุคคล (เลือกรายคน) =========================== */
async function repMember(box) {
  const membersRes = await api('/api/admin/members?per_page=500');
  box.innerHTML = '';

  if (!membersRes.members.length) {
    box.appendChild(el('div', { class: 'card' }, [emptyState('👤', 'ยังไม่มีสมาชิกในระบบ')]));
    return;
  }
  if (!repFilters.member) repFilters.member = String(membersRes.members[0].id);

  const colsRes = await api('/api/admin/collections');
  const p = new URLSearchParams();
  if (repFilters.collection) p.set('collection', repFilters.collection);
  if (repFilters.from) p.set('from', repFilters.from);
  if (repFilters.to) p.set('to', repFilters.to);
  const d = await api(`/api/admin/reports/member/${repFilters.member}?${p}`);

  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row', style: 'gap:.6rem;align-items:flex-end' }, [
      el('div', { class: 'field grow', style: 'margin:0' }, [
        el('label', { text: 'เลือกสมาชิก' }),
        el('select', { onchange: (e) => { repFilters.member = e.target.value; renderReportTab(); } },
          membersRes.members.map((m) => el('option', {
            value: String(m.id), selected: String(m.id) === String(repFilters.member),
            text: `${m.member_code} — ${m.full_name}${m.group_name ? ' (' + m.group_name + ')' : ''}`,
          }))),
      ]),
      el('div', { class: 'field', style: 'margin:0;min-width:170px' }, [
        el('label', { text: 'เฉพาะรอบ' }),
        el('select', { onchange: (e) => { repFilters.collection = e.target.value; renderReportTab(); } }, [
          el('option', { value: '', text: 'ทุกรอบ (รวมทั้งหมด)' }),
          ...colsRes.collections.filter((c) => c.status !== 'draft').map((c) =>
            el('option', { value: String(c.id), text: c.name, selected: String(c.id) === repFilters.collection })),
        ]),
      ]),
      exportBar(`/api/admin/reports/member/${repFilters.member}/export`,
        { collection: repFilters.collection, from: repFilters.from, to: repFilters.to },
        `รายงานรายบุคคล-${d.member.member_code}`),
    ]),
  ]));

  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('h2', { style: 'font-size:1.15rem;margin:0', text: d.member.full_name }),
    el('div', { class: 'small muted', text: `${d.member.member_code}${d.member.group_name ? ' • ' + d.member.group_name : ''}` }),
    el('div', { class: 'grid grid-4', style: 'margin-top:.8rem' }, [
      statCard('จำนวนรอบ', String(d.totals.total_members), 'รอบ', ''),
      statCard('ยอดที่ต้องชำระ', money(d.totals.total_due), 'บาท', 'is-blue'),
      statCard('ชำระแล้ว', money(d.totals.total_paid), 'บาท', 'is-green'),
      statCard('คงค้าง', money(d.totals.total_outstanding), 'บาท', d.totals.total_outstanding > 0 ? 'is-red' : 'is-green'),
    ]),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'card-head' }, [el('h3', { style: 'font-size:1rem', text: 'สรุปรายรอบ' })]),
    reportTable([
      { header: 'ลำดับ', key: 'no', cls: 'mid mono' },
      { header: 'รหัสรายการ', key: 'collection_code', cls: 'mono' },
      { header: 'วัตถุประสงค์การจัดเก็บ', key: 'collection_name' },
      { header: 'กำหนดชำระ', key: 'due_date', cls: 'mid', fmt: (v) => (v ? thaiDate(v, { short: true }) : '-') },
      { header: 'ต้องชำระ', key: 'amount_due', cls: 'num', fmt: money },
      { header: 'ชำระแล้ว', key: 'paid_amount', cls: 'num', fmt: money },
      { header: 'คงเหลือ', key: 'outstanding', cls: 'num', fmt: money },
      { header: 'สถานะ', key: 'status_label', cls: 'mid' },
      { header: 'เลขอ้างอิง', key: 'ref_code', cls: 'mid mono' },
    ], d.rows, {
      __label: 'รวมทั้งสิ้น', amount_due: d.totals.total_due,
      paid_amount: d.totals.total_paid, outstanding: d.totals.total_outstanding,
    }),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0' }, [
    el('div', { class: 'card-head' }, [el('h3', { style: 'font-size:1rem', text: 'ประวัติการแจ้งชำระทั้งหมด' })]),
    reportTable([
      { header: 'เลขอ้างอิง', key: 'ref_code', cls: 'mono' },
      { header: 'รายการจัดเก็บ', key: 'collection_name' },
      { header: 'จำนวนเงิน', key: 'amount', cls: 'num', fmt: money },
      { header: 'ช่องทาง', key: 'method', cls: 'mid', fmt: (v) => ({ cash: 'เงินสด', transfer: 'โอนเงิน', other: 'อื่น ๆ' }[v] || v) },
      { header: 'วันที่แจ้ง', key: 'created_at', cls: 'mid', fmt: (v) => thaiDate(v, { short: true }) },
      { header: 'วันที่อนุมัติ', key: 'verified_at', cls: 'mid', fmt: (v) => (v ? thaiDate(v, { short: true }) : '-') },
      { header: 'สถานะ', key: 'status', cls: 'mid', fmt: (v) => ({ pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่าน' }[v] || v) },
      { header: 'เลขที่ใบเสร็จ', key: 'receipt_no', cls: 'mid mono', fmt: (v) => v || '-' },
    ], d.payments),
  ]));
}

/* ============================= รายการรับชำระ ============================= */
async function repTransactions(box) {
  const [colsRes, groupsRes] = await Promise.all([api('/api/admin/collections'), api('/api/admin/groups')]);
  const p = new URLSearchParams();
  if (repFilters.collection) p.set('collection', repFilters.collection);
  if (repFilters.group) p.set('group', repFilters.group);
  if (repFilters.from) p.set('from', repFilters.from);
  if (repFilters.to) p.set('to', repFilters.to);
  p.set('status', repFilters.status);
  const d = await api(`/api/admin/reports/transactions?${p}`);

  box.innerHTML = '';
  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row', style: 'gap:.6rem;align-items:flex-end' }, [
      el('div', { class: 'field', style: 'margin:0;min-width:150px' }, [
        el('label', { text: 'สถานะ' }),
        el('select', { onchange: (e) => { repFilters.status = e.target.value; renderReportTab(); } }, [
          el('option', { value: 'approved', text: 'อนุมัติแล้ว', selected: repFilters.status === 'approved' }),
          el('option', { value: 'pending', text: 'รอตรวจสอบ', selected: repFilters.status === 'pending' }),
          el('option', { value: 'rejected', text: 'ไม่ผ่าน', selected: repFilters.status === 'rejected' }),
          el('option', { value: 'all', text: 'ทั้งหมด', selected: repFilters.status === 'all' }),
        ]),
      ]),
      el('div', { class: 'field', style: 'margin:0;min-width:170px' }, [
        el('label', { text: 'รายการจัดเก็บ' }),
        el('select', { onchange: (e) => { repFilters.collection = e.target.value; renderReportTab(); } }, [
          el('option', { value: '', text: 'ทุกรายการ' }),
          ...colsRes.collections.map((c) => el('option', { value: String(c.id), text: c.name, selected: String(c.id) === repFilters.collection })),
        ]),
      ]),
      el('div', { class: 'field', style: 'margin:0;min-width:130px' }, [
        el('label', { text: 'กลุ่ม/ชั้น' }),
        el('select', { onchange: (e) => { repFilters.group = e.target.value; renderReportTab(); } }, [
          el('option', { value: '', text: 'ทุกกลุ่ม' }),
          ...groupsRes.groups.map((g) => el('option', { value: String(g.id), text: g.name, selected: String(g.id) === repFilters.group })),
        ]),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { text: 'ตั้งแต่' }),
        el('input', { type: 'date', value: repFilters.from, onchange: (e) => { repFilters.from = e.target.value; renderReportTab(); } }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { text: 'ถึง' }),
        el('input', { type: 'date', value: repFilters.to, onchange: (e) => { repFilters.to = e.target.value; renderReportTab(); } }),
      ]),
      exportBar('/api/admin/reports/transactions/export',
        { collection: repFilters.collection, group: repFilters.group, from: repFilters.from, to: repFilters.to, status: repFilters.status },
        'รายงานการรับชำระ'),
    ]),
  ]));

  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('div', { class: 'small muted', text: `จำนวน ${d.count} รายการ` }),
        el('div', { style: 'font-size:1.5rem;font-weight:800', text: `${money(d.total)} บาท` }),
        el('div', { class: 'small muted', text: `(${d.baht_text})` }),
      ]),
    ]),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0' }, [
    reportTable([
      { header: 'ลำดับ', key: 'no', cls: 'mid mono' },
      { header: 'เลขอ้างอิง', key: 'ref_code', cls: 'mono',
        render: (r) => el('a', { href: `#/payments/${r.id}`, class: 'mono bold', text: r.ref_code }) },
      { header: 'ใบเสร็จ', key: 'receipt_no', cls: 'mono mid' },
      { header: 'รหัส', key: 'member_code', cls: 'mono' },
      { header: 'ชื่อ-สกุล', key: 'full_name' },
      { header: 'กลุ่ม/ชั้น', key: 'group_name', cls: 'mid' },
      { header: 'รายการจัดเก็บ', key: 'collection_name' },
      { header: 'จำนวนเงิน', key: 'amount', cls: 'num', fmt: money },
      { header: 'ช่องทาง', key: 'method_label', cls: 'mid' },
      { header: 'วันที่อนุมัติ', key: 'verified_at', cls: 'mid', fmt: (v) => (v ? thaiDate(v, { short: true }) : '-') },
      { header: 'ผู้ตรวจสอบ', key: 'verified_by_name' },
      { header: 'สถานะ', key: 'status_label', cls: 'mid' },
    ], d.rows, { __label: 'รวม', amount: d.total }),
  ]));
}

/* ============================= รายชื่อค้างชำระ ============================= */
async function repOutstanding(box) {
  const colsRes = await api('/api/admin/collections');
  const p = new URLSearchParams();
  if (repFilters.collection) p.set('collection', repFilters.collection);
  if (repFilters.group) p.set('group', repFilters.group);
  const d = await api(`/api/admin/reports/outstanding?${p}`);

  box.innerHTML = '';
  box.appendChild(el('section', { class: 'card', style: 'margin-bottom:1rem' }, [
    el('div', { class: 'row', style: 'gap:.6rem;align-items:flex-end' }, [
      el('div', { class: 'field grow', style: 'margin:0' }, [
        el('label', { text: 'รายการจัดเก็บ' }),
        el('select', { onchange: (e) => { repFilters.collection = e.target.value; renderReportTab(); } }, [
          el('option', { value: '', text: 'ทุกรายการที่เปิดรับชำระ' }),
          ...colsRes.collections.filter((c) => c.status !== 'draft').map((c) =>
            el('option', { value: String(c.id), text: c.name, selected: String(c.id) === repFilters.collection })),
        ]),
      ]),
      el('button', { class: 'btn btn-sm no-print', type: 'button', text: '🖨 พิมพ์รายชื่อติดตาม', onclick: () => window.print() }),
    ]),
  ]));

  box.appendChild(el('div', { class: 'grid grid-3', style: 'margin-bottom:1rem' }, [
    statCard('รายการค้างชำระ', String(d.count), 'รายการ', 'is-red'),
    statCard('ยอดค้างรวม', money(d.total), 'บาท', 'is-red'),
    statCard('เลยกำหนด', String(d.rows.filter((r) => r.overdue_days > 0).length), 'รายการ', 'is-amber'),
  ]));

  box.appendChild(el('section', { class: 'card card-pad-0' }, [
    reportTable([
      { header: 'รหัส', key: 'member_code', cls: 'mono' },
      { header: 'ชื่อ-สกุล', key: 'full_name' },
      { header: 'กลุ่ม/ชั้น', key: 'group_name', cls: 'mid' },
      { header: 'รายการจัดเก็บ', key: 'collection_name' },
      { header: 'กำหนดชำระ', key: 'due_date', cls: 'mid', fmt: (v) => (v ? thaiDate(v, { short: true }) : '-') },
      { header: 'เลยกำหนด', key: 'overdue_days', cls: 'num',
        render: (r) => r.overdue_days > 0
          ? el('span', { class: 'badge badge-unpaid', text: `${r.overdue_days} วัน` })
          : el('span', { class: 'muted', text: '-' }) },
      { header: 'ต้องชำระ', key: 'amount_due', cls: 'num', fmt: money },
      { header: 'ชำระแล้ว', key: 'paid_amount', cls: 'num', fmt: money },
      { header: 'คงค้าง', key: 'outstanding', cls: 'num', fmt: money },
      { header: 'สถานะ', key: 'status_label', cls: 'mid' },
    ], d.rows, { __label: 'รวม', outstanding: d.total }),
  ]));
}

/* =============================== บันทึกกิจกรรม =============================== */
let auditPage = 1;
let auditQ = '';

route('audit', {
  async render(view) {
    view.innerHTML = '';
    view.appendChild(pageHead('บันทึกกิจกรรม', 'ประวัติการทำงานทั้งหมดในระบบ เพื่อการตรวจสอบย้อนหลัง'));
    view.appendChild(el('section', { class: 'card card-pad-0' }, [
      el('div', { class: 'filters' }, [
        el('div', { class: 'field' }, [
          el('label', { text: 'ค้นหา' }),
          el('input', { type: 'search', placeholder: 'การกระทำ / ผู้ใช้ / รายละเอียด', value: auditQ,
            oninput: debounce((e) => { auditQ = e.target.value; auditPage = 1; loadAudit(); }, 350) }),
        ]),
      ]),
      el('div', { id: 'auditList' }),
    ]));
    await loadAudit();
  },
});

async function loadAudit() {
  const box = $('#auditList');
  if (!box) return;
  box.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังโหลด...</div>';
  const p = new URLSearchParams({ page: String(auditPage), per_page: '50' });
  if (auditQ) p.set('q', auditQ);
  const d = await api(`/api/admin/reports/audit?${p}`);

  box.innerHTML = '';
  if (!d.logs.length) { box.appendChild(emptyState('📜', 'ไม่พบบันทึกกิจกรรม')); return; }

  box.appendChild(el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data cards' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { style: 'width:170px', text: 'เวลา' }),
        el('th', { text: 'ผู้ใช้' }),
        el('th', { text: 'การกระทำ' }),
        el('th', { text: 'รายละเอียด' }),
        el('th', { class: 'mid', text: 'IP' }),
      ])]),
      el('tbody', {}, d.logs.map((l) => el('tr', {}, [
        el('td', { class: 'small', 'data-label': 'เวลา' }, [
          el('div', { text: thaiDate(l.created_at, { short: true, withTime: true }) }),
          el('div', { class: 'tiny muted', text: relativeTime(l.created_at) }),
        ]),
        el('td', { 'data-label': 'ผู้ใช้' }, [
          el('div', { class: 'small bold', text: l.actor_name || '-' }),
          el('div', { class: 'tiny muted', text: { admin: 'ผู้ดูแล', member: 'สมาชิก', system: 'ระบบ' }[l.actor_type] || l.actor_type }),
        ]),
        el('td', { class: 'small', 'data-label': 'การกระทำ', text: l.action }),
        el('td', { class: 'tiny muted', 'data-label': 'รายละเอียด', text: l.detail || '-' }),
        el('td', { class: 'mid tiny muted mono', 'data-label': 'IP', text: l.ip || '-' }),
      ]))),
    ]),
  ]));

  const pg = pager(d, (p2) => { auditPage = p2; loadAudit(); });
  if (pg) box.appendChild(pg);
}
