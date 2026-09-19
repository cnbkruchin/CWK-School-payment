/* หน้าแรก: แสดงรายการจัดเก็บที่เปิดรับชำระ */
'use strict';

const STATUS_LABEL = { open: 'เปิดรับชำระ', closed: 'ปิดรับชำระ' };

async function loadConfig() {
  try {
    const cfg = await api('/api/public/config');
    document.title = `${cfg.system_title} — ${cfg.school_name}`;
    $('#schoolName').textContent = cfg.school_name;
    $('#systemTitle').textContent = cfg.system_title;
    $('#contactNote').textContent = cfg.contact_note || '';
    if (cfg.school_logo) {
      $('#brandLogo').innerHTML = '';
      $('#brandLogo').appendChild(el('img', { src: cfg.school_logo, alt: 'ตราโรงเรียน' }));
    }
  } catch { /* ใช้ค่าเริ่มต้นบนหน้าเว็บ */ }
}

function collectionCard(c) {
  const s = c.summary;
  const pct = s.percent_paid || 0;
  const overdue = c.due_date && new Date(c.due_date + 'T23:59:59') < new Date() && c.status === 'open';

  return el('a', {
    class: 'card', href: `/collection.html?id=${c.id}`,
    style: 'display:block;text-decoration:none;color:inherit',
  }, [
    el('div', { class: 'row-between', style: 'align-items:flex-start;margin-bottom:.6rem' }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'row', style: 'gap:.4rem;margin-bottom:.2rem' }, [
          el('span', { class: 'chip', text: c.code }),
          el('span', { class: `badge badge-${c.status}`, text: STATUS_LABEL[c.status] || c.status }),
          overdue ? el('span', { class: 'badge badge-unpaid', text: 'เลยกำหนดชำระ' }) : null,
        ]),
        el('h3', { style: 'margin:.25rem 0 .1rem', text: c.name }),
        c.description ? el('p', { class: 'small muted', style: 'margin:0', text: c.description }) : null,
      ]),
    ]),

    el('div', { class: 'grid grid-4', style: 'gap:.6rem;margin:.75rem 0' }, [
      miniStat('ผู้ต้องชำระ', `${s.total_members} คน`),
      miniStat('ชำระแล้ว', `${s.count_paid} คน`, 'var(--green-600)'),
      miniStat('รอตรวจสอบ', `${s.count_pending} คน`, 'var(--amber-600)'),
      miniStat('ยังไม่ชำระ', `${s.count_unpaid + s.count_rejected} คน`, 'var(--red-600)'),
    ]),

    el('div', { class: 'progress', title: `ชำระแล้ว ${pct}%` }, [el('span', { style: `width:${Math.min(100, pct)}%` })]),
    el('div', { class: 'row-between small muted', style: 'margin-top:.45rem' }, [
      el('span', { text: `เก็บได้ ${money(s.total_paid)} / ${money(s.total_due)} บาท (${pct}%)` }),
      el('span', { class: 'bold', style: 'color:var(--brand-600)', text: 'ดูรายชื่อและแจ้งชำระ →' }),
    ]),
    c.due_date ? el('div', { class: 'tiny muted', style: 'margin-top:.3rem', text: `กำหนดชำระภายใน ${thaiDate(c.due_date)}` }) : null,
  ]);
}

function miniStat(label, value, color) {
  return el('div', { style: 'text-align:center;padding:.4rem;background:var(--surface-2);border-radius:10px' }, [
    el('div', { class: 'tiny muted', text: label }),
    el('div', { class: 'bold', style: `font-size:1.05rem;${color ? `color:${color}` : ''}`, text: value }),
  ]);
}

async function load() {
  const box = $('#content');
  try {
    const { collections } = await api('/api/public/collections');
    box.innerHTML = '';

    if (!collections.length) {
      box.appendChild(el('div', { class: 'card empty' }, [
        el('span', { class: 'empty-icon', text: '📭' }),
        el('h3', { text: 'ยังไม่มีรายการที่เปิดรับชำระ' }),
        el('p', { class: 'muted', style: 'margin:0', text: 'กรุณาติดต่อฝ่ายการเงินของโรงเรียน หรือกลับมาตรวจสอบอีกครั้งภายหลัง' }),
      ]));
      return;
    }

    const open = collections.filter((c) => c.status === 'open');
    const closed = collections.filter((c) => c.status !== 'open');

    if (open.length) {
      box.appendChild(el('div', { class: 'grid grid-2' }, open.map(collectionCard)));
    }
    if (closed.length) {
      box.appendChild(el('h2', { style: 'margin:1.75rem 0 .5rem;font-size:1.15rem', text: 'รายการที่ปิดรับชำระแล้ว' }));
      box.appendChild(el('div', { class: 'grid grid-2' }, closed.map(collectionCard)));
    }
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'alert alert-error' }, [`ไม่สามารถโหลดข้อมูลได้: ${e.message}`]));
  }
}

$('#themeBtn').addEventListener('click', toggleTheme);
loadConfig();
load();
