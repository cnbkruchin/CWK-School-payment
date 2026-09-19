/* จัดการสมาชิกและกลุ่ม: เพิ่มทีละคน นำเข้าไฟล์ CSV/Excel และรีเซ็ตรหัส */
'use strict';

let memFilters = { q: '', group: '', active: '', page: 1 };

route('members', {
  async render(view, params) {
    if (params[0]) return renderMemberDetail(view, params[0]);

    view.innerHTML = '';
    view.appendChild(pageHead('สมาชิก', 'จัดการรายชื่อผู้ที่ต้องชำระเงิน เพิ่มทีละคนหรือนำเข้าจากไฟล์', [
      canWrite() ? el('button', { class: 'btn btn-sm', type: 'button', text: '📥 นำเข้าไฟล์', onclick: openImportModal }) : null,
      canWrite() ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ เพิ่มสมาชิก', onclick: () => openMemberForm() }) : null,
    ]));

    const card = el('section', { class: 'card card-pad-0' }, [
      el('div', { id: 'memFilters' }),
      el('div', { id: 'memList' }),
    ]);
    view.appendChild(card);
    await loadMembers();
  },
});

async function loadMembers() {
  const list = $('#memList');
  if (!list) return;
  list.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังโหลด...</div>';

  const p = new URLSearchParams();
  if (memFilters.q) p.set('q', memFilters.q);
  if (memFilters.group) p.set('group', memFilters.group);
  if (memFilters.active !== '') p.set('active', memFilters.active);
  p.set('page', String(memFilters.page));
  p.set('per_page', '50');

  const [data, groupsRes] = await Promise.all([api(`/api/admin/members?${p}`), api('/api/admin/groups')]);
  renderMemFilters(groupsRes.groups, data.total);

  list.innerHTML = '';
  if (!data.members.length) {
    list.appendChild(emptyState('👥', 'ไม่พบสมาชิก',
      memFilters.q || memFilters.group ? 'ลองปรับตัวกรองการค้นหา' : 'เริ่มต้นด้วยการเพิ่มสมาชิกหรือนำเข้าจากไฟล์ Excel/CSV',
      canWrite() ? el('div', { class: 'row', style: 'justify-content:center;gap:.5rem' }, [
        el('button', { class: 'btn btn-primary', type: 'button', text: '+ เพิ่มสมาชิก', onclick: () => openMemberForm() }),
        el('button', { class: 'btn', type: 'button', text: '📥 นำเข้าไฟล์', onclick: openImportModal }),
      ]) : null));
    return;
  }

  const selected = new Set();
  const bulkBar = el('div', { class: 'hidden', id: 'memBulk', style: 'padding:.7rem 1.1rem;background:var(--brand-50);border-bottom:1px solid var(--brand-200)' });
  list.appendChild(bulkBar);

  const updateBulk = () => {
    if (!selected.size) { bulkBar.className = 'hidden'; return; }
    bulkBar.className = 'row-between';
    bulkBar.innerHTML = '';
    bulkBar.appendChild(el('span', { class: 'bold small', text: `เลือกไว้ ${selected.size} คน` }));
    bulkBar.appendChild(el('div', { class: 'row', style: 'gap:.35rem' }, [
      el('button', { class: 'btn btn-sm', type: 'button', text: '🔑 รีเซ็ตรหัส', onclick: () => bulkResetPin([...selected]) }),
      el('button', { class: 'btn btn-sm', type: 'button', text: '🏷️ ย้ายกลุ่ม', onclick: () => bulkMoveGroup([...selected], groupsRes.groups) }),
      el('button', { class: 'btn btn-sm', type: 'button', text: '⏸ ปิดใช้งาน', onclick: () => bulkStatus([...selected], false) }),
      el('button', { class: 'btn btn-sm', type: 'button', text: '▶ เปิดใช้งาน', onclick: () => bulkStatus([...selected], true) }),
      el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑 ลบ', onclick: () => bulkDelete([...selected]) }),
      el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'ยกเลิก', onclick: () => { selected.clear(); $$('.row-check', list).forEach((cb) => { cb.checked = false; cb.closest('tr').classList.remove('is-selected'); }); updateBulk(); } }),
    ]));
  };

  const headCheck = el('input', {
    type: 'checkbox', class: 'row-check',
    onchange: (e) => {
      $$('.row-check', list).forEach((cb) => {
        if (cb === e.target) return;
        cb.checked = e.target.checked;
        const id = Number(cb.value);
        if (e.target.checked) selected.add(id); else selected.delete(id);
        cb.closest('tr').classList.toggle('is-selected', e.target.checked);
      });
      updateBulk();
    },
  });

  list.appendChild(el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data cards' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { class: 'mid', style: 'width:40px' }, [canWrite() ? headCheck : null]),
        el('th', { text: 'รหัส' }),
        el('th', { text: 'ชื่อ-สกุล' }),
        el('th', { class: 'mid', text: 'กลุ่ม/ชั้น' }),
        el('th', { text: 'ติดต่อ' }),
        data.show_pin ? el('th', { class: 'mid', text: 'รหัส PIN' }) : null,
        el('th', { class: 'mid', text: 'สถานะ' }),
        el('th', { class: 'mid', style: 'width:130px' }),
      ])]),
      el('tbody', {}, data.members.map((m) => {
        const cb = el('input', {
          type: 'checkbox', class: 'row-check', value: String(m.id),
          onchange: (e) => {
            if (e.target.checked) selected.add(m.id); else selected.delete(m.id);
            e.target.closest('tr').classList.toggle('is-selected', e.target.checked);
            updateBulk();
          },
        });
        return el('tr', {}, [
          el('td', { class: 'mid', 'data-label': '' }, [canWrite() ? cb : null]),
          el('td', { class: 'mono', 'data-label': 'รหัส', text: m.member_code }),
          el('td', { 'data-label': 'ชื่อ-สกุล' }, [
            el('a', { class: 'bold', href: `#/members/${m.id}`, text: m.full_name }),
            m.assignment_count ? el('div', { class: 'tiny muted', text: `อยู่ใน ${m.assignment_count} รายการจัดเก็บ` }) : null,
          ]),
          el('td', { class: 'mid small', 'data-label': 'กลุ่ม/ชั้น', text: m.group_name || '-' }),
          el('td', { class: 'small', 'data-label': 'ติดต่อ' }, [
            m.phone ? el('div', { class: 'mono', text: m.phone }) : null,
            m.email ? el('div', { class: 'tiny muted', text: m.email }) : null,
            !m.phone && !m.email ? el('span', { class: 'muted', text: '-' }) : null,
          ]),
          data.show_pin ? el('td', { class: 'mid mono', 'data-label': 'รหัส PIN' }, [
            m.pin_plain
              ? el('button', {
                  class: 'btn btn-sm', type: 'button', text: m.pin_plain, title: 'คลิกเพื่อคัดลอก',
                  onclick: async () => toast(await copyText(m.pin_plain) ? `คัดลอก ${m.pin_plain} แล้ว` : 'คัดลอกไม่สำเร็จ', 'success'),
                })
              : el('span', { class: 'muted tiny', text: 'ไม่แสดง' }),
          ]) : null,
          el('td', { class: 'mid', 'data-label': 'สถานะ' }, [
            el('span', { class: `badge ${m.is_active ? 'badge-open' : 'badge-closed'}`, text: m.is_active ? 'ใช้งาน' : 'ปิดใช้งาน' }),
          ]),
          el('td', { class: 'mid cell-full', 'data-label': '' }, [
            canWrite() ? el('div', { class: 'row', style: 'gap:.25rem;justify-content:center' }, [
              el('button', { class: 'btn btn-sm', type: 'button', text: '✎', title: 'แก้ไข', onclick: () => openMemberForm(m) }),
              el('button', { class: 'btn btn-sm', type: 'button', text: '🔑', title: 'รีเซ็ตรหัส', onclick: () => resetPin(m) }),
              el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑', title: 'ลบ', onclick: () => deleteMember(m) }),
            ]) : el('a', { class: 'btn btn-sm', href: `#/members/${m.id}`, text: 'ดู' }),
          ]),
        ]);
      })),
    ]),
  ]));

  const pg = pager(data, (p2) => { memFilters.page = p2; loadMembers(); });
  if (pg) list.appendChild(pg);
}

function renderMemFilters(groups, total) {
  const box = $('#memFilters');
  if (!box) return;
  box.innerHTML = '';
  box.appendChild(el('div', { class: 'filters' }, [
    el('div', { class: 'field' }, [
      el('label', { text: `ค้นหา (ทั้งหมด ${total} คน)` }),
      el('input', { type: 'search', placeholder: 'ชื่อ รหัส หรือเบอร์โทร', value: memFilters.q,
        oninput: debounce((e) => { memFilters.q = e.target.value; memFilters.page = 1; loadMembers(); }, 350) }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'กลุ่ม/ชั้น' }),
      el('select', { onchange: (e) => { memFilters.group = e.target.value; memFilters.page = 1; loadMembers(); } }, [
        el('option', { value: '', text: 'ทุกกลุ่ม' }),
        ...groups.map((g) => el('option', { value: String(g.id), text: `${g.name} (${g.member_count})`, selected: String(g.id) === memFilters.group })),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'สถานะ' }),
      el('select', { onchange: (e) => { memFilters.active = e.target.value; memFilters.page = 1; loadMembers(); } }, [
        el('option', { value: '', text: 'ทั้งหมด' }),
        el('option', { value: '1', text: 'ใช้งาน', selected: memFilters.active === '1' }),
        el('option', { value: '0', text: 'ปิดใช้งาน', selected: memFilters.active === '0' }),
      ]),
    ]),
  ]));
}

/* ============================== ฟอร์มสมาชิก ============================== */
async function openMemberForm(m) {
  if (needWrite()) return;
  const groups = (await api('/api/admin/groups')).groups;
  const isEdit = !!m;

  const form = el('form', { id: 'mForm', autocomplete: 'off' }, [
    el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'mCode', text: 'รหัสสมาชิก' }),
        el('input', { type: 'text', id: 'mCode', maxlength: '40', value: m ? m.member_code : '', placeholder: 'เว้นว่างเพื่อสร้างอัตโนมัติ' }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'mGroup', text: 'กลุ่ม/ชั้นเรียน' }),
        el('select', { id: 'mGroup' }, [
          el('option', { value: '', text: '— ไม่ระบุ —' }),
          ...groups.map((g) => el('option', { value: String(g.id), text: g.name, selected: m && m.group_id === g.id })),
        ]),
      ]),
    ]),
    el('div', { class: 'grid grid-3', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'mPrefix', text: 'คำนำหน้า' }),
        el('input', { type: 'text', id: 'mPrefix', list: 'prefixList', maxlength: '40', value: m ? (m.prefix || '') : '' }),
        el('datalist', { id: 'prefixList' }, ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นาง', 'นางสาว'].map((p) => el('option', { value: p }))),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { class: 'req', for: 'mFirst', text: 'ชื่อ' }),
        el('input', { type: 'text', id: 'mFirst', required: true, maxlength: '120', value: m ? m.first_name : '' }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { class: 'req', for: 'mLast', text: 'นามสกุล' }),
        el('input', { type: 'text', id: 'mLast', required: true, maxlength: '120', value: m ? m.last_name : '' }),
      ]),
    ]),
    el('div', { class: 'grid grid-2', style: 'gap:.7rem' }, [
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'mPhone', text: 'เบอร์โทรศัพท์' }),
        el('input', { type: 'tel', id: 'mPhone', maxlength: '40', value: m ? (m.phone || '') : '' }),
      ]),
      el('div', { class: 'field', style: 'margin:0' }, [
        el('label', { for: 'mEmail', text: 'อีเมล' }),
        el('input', { type: 'email', id: 'mEmail', maxlength: '160', value: m ? (m.email || '') : '' }),
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'mGuardian', text: 'ชื่อผู้ปกครอง' }),
      el('input', { type: 'text', id: 'mGuardian', maxlength: '160', value: m ? (m.guardian || '') : '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'mNote', text: 'หมายเหตุ' }),
      el('input', { type: 'text', id: 'mNote', maxlength: '500', value: m ? (m.note || '') : '' }),
    ]),
    isEdit ? el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'mActive', checked: !!m.is_active }),
      el('span', { text: 'เปิดใช้งาน' }),
    ]) : el('div', { class: 'alert alert-info small' }, ['ระบบจะสร้างรหัส PIN 6 หลักให้อัตโนมัติ และแสดงให้ทราบหลังบันทึก']),
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'mForm', text: isEdit ? 'บันทึก' : 'เพิ่มสมาชิก' });
  const mo = modal({
    title: isEdit ? `แก้ไขสมาชิก — ${m.full_name}` : 'เพิ่มสมาชิกใหม่', body: form,
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => mo.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังบันทึก...');
    const payload = {
      member_code: $('#mCode', form).value, prefix: $('#mPrefix', form).value,
      first_name: $('#mFirst', form).value, last_name: $('#mLast', form).value,
      group_id: $('#mGroup', form).value || null, phone: $('#mPhone', form).value,
      email: $('#mEmail', form).value, guardian: $('#mGuardian', form).value, note: $('#mNote', form).value,
    };
    if (isEdit) payload.is_active = $('#mActive', form).checked;
    try {
      const r = isEdit
        ? await api(`/api/admin/members/${m.id}`, { method: 'PUT', body: payload })
        : await api('/api/admin/members', { method: 'POST', body: payload });
      mo.close();
      if (!isEdit && r.pin) showCredentials([{ member_code: r.member_code, full_name: `${payload.prefix}${payload.first_name} ${payload.last_name}`.trim(), pin: r.pin }]);
      else toast('บันทึกเรียบร้อย', 'success');
      loadMembers();
    } catch (ex) { toast(ex.message, 'error', 6000); busy(btn, false); }
  });
}

/* ============================== นำเข้าไฟล์ ============================== */
function openImportModal() {
  if (needWrite()) return;
  const form = el('form', { id: 'impForm' }, [
    el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' }, [
      el('div', {}, [
        el('strong', { text: 'รองรับไฟล์ Excel (.xlsx) และ CSV ' }),
        el('div', { class: 'small', style: 'margin-top:.3rem' }, [
          'หัวคอลัมน์ที่ระบบรู้จัก: รหัสสมาชิก, คำนำหน้า, ชื่อ, นามสกุล (หรือ "ชื่อ-สกุล" รวมกัน), กลุ่ม, เบอร์โทร, อีเมล, ผู้ปกครอง, หมายเหตุ',
        ]),
      ]),
    ]),
    el('div', { class: 'row', style: 'gap:.4rem;margin-bottom:1rem' }, [
      el('button', { class: 'btn btn-sm grow', type: 'button', text: '⬇ ดาวน์โหลดต้นแบบ Excel', onclick: () => download('/api/admin/members/template/download?format=xlsx', 'member-import-template.xlsx') }),
      el('button', { class: 'btn btn-sm grow', type: 'button', text: '⬇ ดาวน์โหลดต้นแบบ CSV', onclick: () => download('/api/admin/members/template/download?format=csv', 'member-import-template.csv') }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'impFile', text: 'เลือกไฟล์' }),
      el('input', { type: 'file', id: 'impFile', accept: '.csv,.xlsx,.xls,.txt,text/csv', required: true }),
    ]),
    el('label', { class: 'check' }, [
      el('input', { type: 'checkbox', id: 'impUpdate' }),
      el('span', {}, [el('span', { class: 'bold', text: 'อัปเดตข้อมูลของสมาชิกที่มีอยู่แล้ว' }), el('div', { class: 'tiny muted', text: 'ถ้าไม่ติ๊ก ระบบจะข้ามรายชื่อที่ซ้ำ' })]),
    ]),
    el('div', { id: 'impResult', style: 'margin-top:1rem' }),
  ]);

  const previewBtn = el('button', { class: 'btn', type: 'button', text: '👁 ตรวจสอบก่อนนำเข้า' });
  const importBtn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'impForm', text: '📥 นำเข้าข้อมูล' });

  const mo = modal({
    title: 'นำเข้าสมาชิกจากไฟล์', body: form, size: 'modal-lg',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ปิด', onclick: () => mo.close() }), previewBtn, importBtn],
  });

  async function doImport(dryRun) {
    const file = $('#impFile', form).files[0];
    if (!file) return toast('กรุณาเลือกไฟล์', 'warn');
    const fd = new FormData();
    fd.append('file', file);
    if (dryRun) fd.append('dry_run', '1');
    if ($('#impUpdate', form).checked) fd.append('update_existing', '1');

    const btn = dryRun ? previewBtn : importBtn;
    busy(btn, true, dryRun ? 'กำลังตรวจสอบ...' : 'กำลังนำเข้า...');
    try {
      const r = await api('/api/admin/members/import', { method: 'POST', body: fd });
      renderImportResult(r, dryRun);
      if (!dryRun) {
        toast(`นำเข้าสำเร็จ: เพิ่ม ${r.created} คน, อัปเดต ${r.updated} คน`, 'success', 6000);
        loadMembers();
        if (r.credentials && r.credentials.length) {
          setTimeout(() => { mo.close(); showCredentials(r.credentials); }, 900);
        }
      }
    } catch (ex) {
      const box = $('#impResult', form);
      box.innerHTML = '';
      box.appendChild(el('div', { class: 'alert alert-error' }, [ex.message]));
    } finally { busy(btn, false); }
  }

  function renderImportResult(r, dryRun) {
    const box = $('#impResult', form);
    box.innerHTML = '';
    box.appendChild(el('div', { class: `alert ${r.errors.length ? 'alert-warn' : 'alert-success'}` }, [
      el('div', {}, [
        el('strong', { text: dryRun ? 'ผลการตรวจสอบ (ยังไม่บันทึก): ' : 'ผลการนำเข้า: ' }),
        `อ่านได้ ${r.total_rows} แถว • เพิ่มใหม่ ${r.created} • อัปเดต ${r.updated} • ข้าม ${r.skipped}`,
        r.errors.length ? el('div', { class: 'small', style: 'margin-top:.3rem' }, [`มีข้อผิดพลาด ${r.errors.length} แถว`]) : null,
      ]),
    ]));

    if (r.errors.length) {
      box.appendChild(el('details', { style: 'margin-top:.5rem' }, [
        el('summary', { style: 'cursor:pointer;font-weight:700', text: `ดูข้อผิดพลาด (${r.errors.length})` }),
        el('ul', { class: 'small', style: 'margin:.4rem 0;padding-inline-start:1.2rem;max-height:160px;overflow-y:auto' },
          r.errors.slice(0, 80).map((x) => el('li', { text: `บรรทัดที่ ${x.line}: ${x.message}` }))),
      ]));
    }
    if (r.preview && r.preview.length) {
      box.appendChild(el('div', { class: 'table-wrap', style: 'max-height:280px;overflow-y:auto;margin-top:.5rem' }, [
        el('table', { class: 'data' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'บรรทัด' }), el('th', { text: 'การทำงาน' }),
            el('th', { text: 'รหัส' }), el('th', { text: 'ชื่อ-สกุล' }), el('th', { text: 'กลุ่ม' }),
          ])]),
          el('tbody', {}, r.preview.slice(0, 200).map((x) => el('tr', {}, [
            el('td', { class: 'mono', text: String(x.line) }),
            el('td', {}, [el('span', { class: `badge ${x.action === 'เพิ่มใหม่' ? 'badge-open' : x.action === 'อัปเดต' ? 'badge-partial' : 'badge-draft'}`, text: x.action })]),
            el('td', { class: 'mono', text: x.member_code || '-' }),
            el('td', { text: x.name }),
            el('td', { text: x.group || '-' }),
          ]))),
        ]),
      ]));
    }
  }

  previewBtn.addEventListener('click', () => doImport(true));
  form.addEventListener('submit', (e) => { e.preventDefault(); doImport(false); });
}

/* ============================ แสดงรหัส PIN ============================ */
function showCredentials(list) {
  const body = el('div', {}, [
    el('div', { class: 'alert alert-warn', style: 'margin-bottom:1rem' }, [
      el('div', {}, [
        el('strong', { text: 'กรุณาบันทึกหรือพิมพ์รหัสเหล่านี้ไว้ ' }),
        'เพื่อแจ้งให้สมาชิกใช้ยืนยันตัวตนตอนแจ้งชำระเงิน (ดูย้อนหลังได้ที่หน้าสมาชิก หากเปิดการแสดงรหัสไว้)',
      ]),
    ]),
    el('div', { class: 'table-wrap', style: 'max-height:400px;overflow-y:auto' }, [
      el('table', { class: 'data' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'รหัสสมาชิก' }), el('th', { text: 'ชื่อ-สกุล' }),
          el('th', { text: 'กลุ่ม' }), el('th', { class: 'mid', text: 'รหัส PIN' }),
        ])]),
        el('tbody', {}, list.map((c) => el('tr', {}, [
          el('td', { class: 'mono', text: c.member_code }),
          el('td', { text: c.full_name }),
          el('td', { class: 'small muted', text: c.group || '-' }),
          el('td', { class: 'mid mono bold', style: 'font-size:1.1rem;letter-spacing:.1em', text: c.pin }),
        ]))),
      ]),
    ]),
  ]);

  const m = modal({
    title: `รหัส PIN ของสมาชิก (${list.length} คน)`, body, size: 'modal-lg',
    footer: [
      el('button', { class: 'btn', type: 'button', text: '⬇ บันทึกเป็น CSV', onclick: () => {
        const csv = '﻿' + ['รหัสสมาชิก,ชื่อ-สกุล,กลุ่ม,รหัส PIN',
          ...list.map((c) => `"${c.member_code}","${c.full_name}","${c.group || ''}","${c.pin}"`)].join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = el('a', { href: url, download: `รหัสสมาชิก-${new Date().toISOString().slice(0, 10)}.csv` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } }),
      el('button', { class: 'btn', type: 'button', text: '🖨 พิมพ์', onclick: () => printElement(body) }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'เสร็จสิ้น', onclick: () => m.close() }),
    ],
  });
}

/* ============================== รีเซ็ตรหัส ============================== */
async function resetPin(m) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'รีเซ็ตรหัสสมาชิก',
    message: `ต้องการสร้างรหัส PIN ใหม่ให้ ${m.full_name} (${m.member_code}) ใช่หรือไม่? รหัสเดิมจะใช้ไม่ได้อีก`,
    confirmText: 'รีเซ็ตรหัส',
  }))) return;
  try {
    const r = await api(`/api/admin/members/${m.id}/reset-pin`, { method: 'POST', body: {} });
    showCredentials([{ member_code: r.member_code, full_name: r.full_name, pin: r.pin, group: m.group_name }]);
    loadMembers();
  } catch (e) { toast(e.message, 'error'); }
}

async function bulkResetPin(ids) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'รีเซ็ตรหัสหลายคน', message: `ต้องการสร้างรหัส PIN ใหม่ให้สมาชิก ${ids.length} คนใช่หรือไม่?`,
    confirmText: `รีเซ็ต ${ids.length} คน`,
  }))) return;
  try {
    const r = await api('/api/admin/members/bulk/reset-pin', { method: 'POST', body: { ids } });
    showCredentials(r.members);
    loadMembers();
  } catch (e) { toast(e.message, 'error'); }
}

async function bulkStatus(ids, active) {
  if (needWrite()) return;
  try {
    await api('/api/admin/members/bulk/status', { method: 'POST', body: { ids, is_active: active } });
    toast(`${active ? 'เปิด' : 'ปิด'}ใช้งานสมาชิก ${ids.length} คนแล้ว`, 'success');
    loadMembers();
  } catch (e) { toast(e.message, 'error'); }
}

async function bulkMoveGroup(ids, groups) {
  if (needWrite()) return;
  const sel = el('select', { id: 'bgSel' }, [
    el('option', { value: '', text: '— ไม่มีกลุ่ม —' }),
    ...groups.map((g) => el('option', { value: String(g.id), text: g.name })),
  ]);
  const body = el('div', {}, [el('div', { class: 'field' }, [el('label', { text: `ย้ายสมาชิก ${ids.length} คนไปยังกลุ่ม` }), sel])]);
  const m = modal({
    title: 'ย้ายกลุ่มสมาชิก', body, size: 'modal-sm',
    footer: [
      el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'ย้าย', onclick: async () => {
        try {
          await api('/api/admin/members/bulk/group', { method: 'POST', body: { ids, group_id: sel.value || null } });
          m.close();
          toast('ย้ายกลุ่มเรียบร้อย', 'success');
          loadMembers();
        } catch (e) { toast(e.message, 'error'); }
      } }),
    ],
  });
}

async function bulkDelete(ids) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'ลบสมาชิกหลายคน', danger: true, confirmText: `ลบ ${ids.length} คน`,
    message: `ต้องการลบสมาชิก ${ids.length} คนใช่หรือไม่? ข้อมูลการชำระเงินของสมาชิกเหล่านี้จะถูกลบไปด้วย`,
  }))) return;
  try {
    const r = await api('/api/admin/members/bulk/delete', { method: 'POST', body: { ids } });
    toast(`ลบสมาชิก ${r.count} คนแล้ว`, 'success');
    loadMembers();
  } catch (e) {
    if (e.status === 409) {
      if (!(await confirmDialog({ title: 'ยืนยันอีกครั้ง', danger: true, confirmText: 'ลบถาวร', message: e.message }))) return;
      try {
        const r2 = await api('/api/admin/members/bulk/delete', { method: 'POST', body: { ids, force: true } });
        toast(`ลบสมาชิก ${r2.count} คนแล้ว`, 'success');
        loadMembers();
      } catch (e2) { toast(e2.message, 'error'); }
    } else toast(e.message, 'error');
  }
}

async function deleteMember(m) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'ลบสมาชิก', danger: true, confirmText: 'ลบ',
    message: `ต้องการลบ ${m.full_name} (${m.member_code}) ใช่หรือไม่?`,
  }))) return;
  try {
    await api(`/api/admin/members/${m.id}`, { method: 'DELETE' });
    toast('ลบสมาชิกแล้ว', 'success');
    loadMembers();
  } catch (e) {
    if (e.status === 409) {
      if (!(await confirmDialog({ title: 'ยืนยันอีกครั้ง', danger: true, confirmText: 'ลบถาวร', message: e.message }))) return;
      try {
        await api(`/api/admin/members/${m.id}?force=1`, { method: 'DELETE' });
        toast('ลบสมาชิกแล้ว', 'success');
        loadMembers();
      } catch (e2) { toast(e2.message, 'error'); }
    } else toast(e.message, 'error');
  }
}

/* ============================ รายละเอียดสมาชิก ============================ */
async function renderMemberDetail(view, id) {
  const d = await api(`/api/admin/members/${id}`);
  const m = d.member;
  const t = d.totals;

  view.innerHTML = '';
  view.appendChild(pageHead(m.full_name, `${m.member_code}${m.group_name ? ' • ' + m.group_name : ''}`, [
    el('a', { class: 'btn btn-sm', href: '#/members', text: '← กลับ' }),
    el('button', { class: 'btn btn-sm', type: 'button', text: '⬇ รายงาน Excel', onclick: () => download(`/api/admin/reports/member/${m.id}/export?format=xlsx`, `รายงาน-${m.member_code}.xlsx`) }),
    canWrite() ? el('button', { class: 'btn btn-sm', type: 'button', text: '🔑 รีเซ็ตรหัส', onclick: () => resetPin(m) }) : null,
    canWrite() ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '✎ แก้ไข', onclick: () => openMemberForm(m) }) : null,
  ]));

  view.appendChild(el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
    statCard('รายการทั้งหมด', String(t.total_members), 'รายการ', ''),
    statCard('ยอดที่ต้องชำระ', money(t.total_due), 'บาท', 'is-blue'),
    statCard('ชำระแล้ว', money(t.total_paid), 'บาท', 'is-green'),
    statCard('คงค้าง', money(t.total_outstanding), 'บาท', t.total_outstanding > 0 ? 'is-red' : 'is-green'),
  ]));

  view.appendChild(el('div', { class: 'grid', style: 'grid-template-columns:minmax(260px,1fr) 2fr;gap:1rem' }, [
    el('section', { class: 'card' }, [
      el('h2', { style: 'font-size:1.05rem', text: 'ข้อมูลสมาชิก' }),
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'รหัสสมาชิก' }), el('dd', { class: 'mono', text: m.member_code }),
        el('dt', { text: 'ชื่อ-สกุล' }), el('dd', { text: m.full_name }),
        el('dt', { text: 'กลุ่ม/ชั้น' }), el('dd', { text: m.group_name || '-' }),
        el('dt', { text: 'เบอร์โทร' }), el('dd', { class: 'mono', text: m.phone || '-' }),
        el('dt', { text: 'อีเมล' }), el('dd', { text: m.email || '-' }),
        el('dt', { text: 'ผู้ปกครอง' }), el('dd', { text: m.guardian || '-' }),
        m.pin_plain ? el('dt', { text: 'รหัส PIN' }) : null,
        m.pin_plain ? el('dd', { class: 'mono bold', text: m.pin_plain }) : null,
        el('dt', { text: 'สถานะ' }),
        el('dd', {}, [el('span', { class: `badge ${m.is_active ? 'badge-open' : 'badge-closed'}`, text: m.is_active ? 'ใช้งาน' : 'ปิดใช้งาน' })]),
        m.note ? el('dt', { text: 'หมายเหตุ' }) : null,
        m.note ? el('dd', { text: m.note }) : null,
      ]),
    ]),
    el('section', { class: 'card card-pad-0' }, [
      el('div', { class: 'card-head' }, [el('h2', { style: 'font-size:1.05rem', text: 'ประวัติการชำระเงินทุกรอบ' })]),
      d.ledger.length ? el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data cards' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'รายการจัดเก็บ' }),
            el('th', { class: 'num', text: 'ต้องชำระ' }),
            el('th', { class: 'num', text: 'ชำระแล้ว' }),
            el('th', { class: 'num', text: 'คงเหลือ' }),
            el('th', { class: 'mid', text: 'สถานะ' }),
          ])]),
          el('tbody', {}, d.ledger.map((r) => el('tr', {}, [
            el('td', { 'data-label': 'รายการ' }, [
              el('a', { class: 'bold', href: `#/collections/${r.collection_id}`, text: r.collection_name }),
              el('div', { class: 'tiny muted mono', text: r.collection_code }),
            ]),
            el('td', { class: 'num', 'data-label': 'ต้องชำระ', text: money(r.net_due) }),
            el('td', { class: 'num', 'data-label': 'ชำระแล้ว', text: money(r.paid_amount) }),
            el('td', { class: 'num', 'data-label': 'คงเหลือ', text: money(r.outstanding) }),
            el('td', { class: 'mid', 'data-label': 'สถานะ' }, [statusBadge(r.status, r.status_label)]),
          ]))),
          el('tfoot', {}, [el('tr', {}, [
            el('td', { text: 'รวมทั้งสิ้น' }),
            el('td', { class: 'num', text: money(t.total_due) }),
            el('td', { class: 'num', text: money(t.total_paid) }),
            el('td', { class: 'num', text: money(t.total_outstanding) }),
            el('td'),
          ])]),
        ]),
      ]) : emptyState('📭', 'ยังไม่มีรายการที่ต้องชำระ'),
    ]),
  ]));
}

/* ================================ กลุ่ม ================================ */
route('groups', {
  async render(view) {
    const { groups } = await api('/api/admin/groups');
    view.innerHTML = '';
    view.appendChild(pageHead('กลุ่ม/ชั้นเรียน', 'ใช้จัดกลุ่มสมาชิกเพื่อกำหนดผู้ที่ต้องชำระแบบรายกลุ่ม', [
      canWrite() ? el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '+ เพิ่มกลุ่ม', onclick: () => openGroupForm() }) : null,
    ]));

    const card = el('section', { class: 'card card-pad-0' });
    if (!groups.length) {
      card.appendChild(emptyState('🏷️', 'ยังไม่มีกลุ่ม', 'เพิ่มกลุ่มหรือชั้นเรียน เช่น ม.1/1, ม.2/1, คณะครู'));
    } else {
      card.appendChild(el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data cards' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'ชื่อกลุ่ม' }), el('th', { text: 'รายละเอียด' }),
            el('th', { class: 'num', text: 'จำนวนสมาชิก' }), el('th', { class: 'mid', text: 'สถานะ' }),
            el('th', { class: 'mid', style: 'width:110px' }),
          ])]),
          el('tbody', {}, groups.map((g) => el('tr', {}, [
            el('td', { class: 'bold', 'data-label': 'ชื่อกลุ่ม', text: g.name }),
            el('td', { class: 'small muted', 'data-label': 'รายละเอียด', text: g.description || '-' }),
            el('td', { class: 'num', 'data-label': 'จำนวนสมาชิก' }, [
              el('a', { href: `#/members`, text: `${g.member_count} คน`, onclick: () => { memFilters.group = String(g.id); memFilters.page = 1; } }),
            ]),
            el('td', { class: 'mid', 'data-label': 'สถานะ' }, [
              el('span', { class: `badge ${g.is_active ? 'badge-open' : 'badge-closed'}`, text: g.is_active ? 'ใช้งาน' : 'ปิด' }),
            ]),
            el('td', { class: 'mid cell-full', 'data-label': '' }, [
              canWrite() ? el('div', { class: 'row', style: 'gap:.25rem;justify-content:center' }, [
                el('button', { class: 'btn btn-sm', type: 'button', text: '✎', onclick: () => openGroupForm(g) }),
                el('button', { class: 'btn btn-sm btn-red', type: 'button', text: '🗑', onclick: () => deleteGroup(g) }),
              ]) : null,
            ]),
          ]))),
        ]),
      ]));
    }
    view.appendChild(card);
  },
});

function openGroupForm(g) {
  if (needWrite()) return;
  const form = el('form', { id: 'gForm' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'gName', text: 'ชื่อกลุ่ม/ชั้นเรียน' }),
      el('input', { type: 'text', id: 'gName', required: true, maxlength: '120', value: g ? g.name : '', placeholder: 'เช่น ม.1/1' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'gDesc', text: 'รายละเอียด' }),
      el('input', { type: 'text', id: 'gDesc', maxlength: '255', value: g ? (g.description || '') : '' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'gSort', text: 'ลำดับการแสดง' }),
      el('input', { type: 'number', id: 'gSort', value: g ? String(g.sort_order) : '0' }),
    ]),
  ]);
  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'gForm', text: g ? 'บันทึก' : 'เพิ่มกลุ่ม' });
  const m = modal({
    title: g ? 'แก้ไขกลุ่ม' : 'เพิ่มกลุ่มใหม่', body: form, size: 'modal-sm',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ยกเลิก', onclick: () => m.close() }), btn],
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true);
    const payload = { name: $('#gName', form).value, description: $('#gDesc', form).value, sort_order: $('#gSort', form).value };
    try {
      if (g) await api(`/api/admin/groups/${g.id}`, { method: 'PUT', body: payload });
      else await api('/api/admin/groups', { method: 'POST', body: payload });
      m.close();
      toast('บันทึกเรียบร้อย', 'success');
      handleRoute();
    } catch (ex) { toast(ex.message, 'error'); busy(btn, false); }
  });
}

async function deleteGroup(g) {
  if (needWrite()) return;
  if (!(await confirmDialog({
    title: 'ลบกลุ่ม', danger: true, confirmText: 'ลบ',
    message: `ต้องการลบกลุ่ม "${g.name}" ใช่หรือไม่? สมาชิก ${g.member_count} คนในกลุ่มนี้จะถูกย้ายออกจากกลุ่ม (ไม่ถูกลบ)`,
  }))) return;
  try {
    await api(`/api/admin/groups/${g.id}`, { method: 'DELETE' });
    toast('ลบกลุ่มแล้ว', 'success');
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}
