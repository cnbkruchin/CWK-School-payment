/* แดชบอร์ดภาพรวม */
'use strict';

route('dashboard', {
  async render(view) {
    const d = await api('/api/admin/reports/dashboard');
    const s = d.stats;
    view.innerHTML = '';

    view.appendChild(pageHead(
      'แดชบอร์ด',
      `ภาพรวมการรับชำระเงินทั้งระบบ • ข้อมูล ณ ${thaiDate(new Date(), { withTime: true })}`,
      [el('button', { class: 'btn btn-sm', type: 'button', text: '🔄 รีเฟรช', onclick: () => handleRoute() })]
    ));

    /* ---- แถบเตือนรายการรอตรวจสอบ ---- */
    if (s.pending_payments > 0) {
      view.appendChild(el('div', { class: 'alert alert-warn', style: 'margin-bottom:1rem' }, [
        el('div', { class: 'grow' }, [
          el('strong', { text: `มี ${s.pending_payments} รายการรอการตรวจสอบ ` }),
          'กรุณาตรวจสอบสลิปและยืนยันการชำระเงิน',
        ]),
        el('a', { class: 'btn btn-sm btn-amber', href: '#/payments', text: 'ไปตรวจสอบ' }),
      ]));
    }

    /* ---- สถิติหลัก ---- */
    view.appendChild(el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
      statCard('ยอดที่ต้องจัดเก็บ', money(s.total_due), 'บาท', 'is-blue', `${s.total_members} รายการ`),
      statCard('ยอดที่เก็บได้แล้ว', money(s.total_paid), 'บาท', 'is-green', `${s.percent_paid}% ของยอดทั้งหมด`),
      statCard('ยอดค้างชำระ', money(s.total_outstanding), 'บาท', 'is-red', `${s.count_unpaid + s.count_rejected} รายการ`),
      statCard('รอตรวจสอบ', String(s.pending_payments), 'รายการ', 'is-amber', `${money(s.total_pending)} บาท`),
    ]));

    view.appendChild(el('div', { class: 'grid grid-4', style: 'margin-bottom:1rem' }, [
      statCard('สมาชิกทั้งหมด', String(s.total_active_members), 'คน', ''),
      statCard('รายการจัดเก็บ', String(s.total_collections), 'รายการ', '', `เปิดรับชำระ ${s.open_collections} รายการ`),
      statCard('ชำระครบแล้ว', String(s.count_paid), 'รายการ', 'is-green'),
      statCard('ยกเว้นการชำระ', String(s.count_waived), 'รายการ', ''),
    ]));

    /* ---- ความคืบหน้าแต่ละรายการจัดเก็บ ---- */
    const left = el('section', { class: 'card card-pad-0' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { style: 'font-size:1.05rem', text: 'ความคืบหน้ารายการจัดเก็บ' }),
        el('a', { class: 'btn btn-sm', href: '#/collections', text: 'ดูทั้งหมด' }),
      ]),
    ]);
    if (!d.by_collection.length) {
      left.appendChild(emptyState('📋', 'ยังไม่มีรายการจัดเก็บ', 'เริ่มต้นด้วยการสร้างรายการจัดเก็บแรกของท่าน',
        el('a', { class: 'btn btn-primary', href: '#/collections', text: '+ สร้างรายการจัดเก็บ' })));
    } else {
      const body = el('div', { class: 'card-body', style: 'display:grid;gap:.9rem' });
      for (const c of d.by_collection) {
        const cs = c.summary;
        body.appendChild(el('a', { href: `#/collections/${c.id}`, style: 'text-decoration:none;color:inherit;display:block' }, [
          el('div', { class: 'row-between', style: 'margin-bottom:.25rem' }, [
            el('span', { class: 'bold small', text: c.name }),
            el('span', { class: `badge badge-${c.status}`, text: c.status === 'open' ? 'เปิดรับชำระ' : 'ปิดรับชำระ' }),
          ]),
          el('div', { class: 'progress' }, [el('span', { style: `width:${Math.min(100, cs.percent_paid)}%` })]),
          el('div', { class: 'row-between tiny muted', style: 'margin-top:.22rem' }, [
            el('span', { text: `${money(cs.total_paid)} / ${money(cs.total_due)} บาท` }),
            el('span', { text: `ชำระแล้ว ${cs.count_paid}/${cs.total_members} คน (${cs.percent_paid}%)` }),
          ]),
        ]));
      }
      left.appendChild(body);
    }

    /* ---- การแจ้งชำระล่าสุด ---- */
    const right = el('section', { class: 'card card-pad-0' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { style: 'font-size:1.05rem', text: 'การแจ้งชำระล่าสุด' }),
        el('a', { class: 'btn btn-sm', href: '#/payments', text: 'ดูทั้งหมด' }),
      ]),
    ]);
    if (!d.recent.length) {
      right.appendChild(emptyState('🧾', 'ยังไม่มีการแจ้งชำระเงิน'));
    } else {
      right.appendChild(el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('tbody', {}, d.recent.map((p) =>
            el('tr', { style: 'cursor:pointer', onclick: () => { location.hash = `#/payments/${p.id}`; } }, [
              el('td', {}, [
                el('div', { class: 'bold small', text: p.full_name }),
                el('div', { class: 'tiny muted', text: p.collection_name }),
              ]),
              el('td', { class: 'num small', text: money(p.amount) }),
              el('td', { class: 'mid' }, [
                statusBadge(p.status === 'approved' ? 'paid' : p.status === 'rejected' ? 'rejected' : 'pending',
                  { pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่าน' }[p.status]),
                el('div', { class: 'tiny muted', text: relativeTime(p.created_at) }),
              ]),
            ]))),
        ]),
      ]));
    }

    view.appendChild(el('div', { class: 'grid grid-2' }, [left, right]));

    /* ---- กราฟยอดรับชำระรายเดือน ---- */
    if (d.trend.length) {
      view.appendChild(el('section', { class: 'card', style: 'margin-top:1rem' }, [
        el('h2', { style: 'font-size:1.05rem', text: 'ยอดรับชำระย้อนหลัง 12 เดือน' }),
        barChart(d.trend),
      ]));
    }

    /* ---- สรุปตามกลุ่ม ---- */
    const groups = d.by_group.filter((g) => g.assignments > 0);
    if (groups.length) {
      view.appendChild(el('section', { class: 'card card-pad-0', style: 'margin-top:1rem' }, [
        el('div', { class: 'card-head' }, [el('h2', { style: 'font-size:1.05rem', text: 'สรุปตามกลุ่ม/ชั้นเรียน' })]),
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'data cards' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { text: 'กลุ่ม/ชั้น' }),
              el('th', { class: 'num', text: 'รายการ' }),
              el('th', { class: 'num', text: 'ยอดที่ต้องเก็บ' }),
              el('th', { class: 'num', text: 'เก็บได้' }),
              el('th', { class: 'num', text: 'คงค้าง' }),
              el('th', { style: 'min-width:120px', text: 'ความคืบหน้า' }),
            ])]),
            el('tbody', {}, groups.map((g) => {
              const pct = g.due > 0 ? Math.round((g.paid / g.due) * 1000) / 10 : 0;
              return el('tr', {}, [
                el('td', { 'data-label': 'กลุ่ม/ชั้น', class: 'bold', text: g.name }),
                el('td', { class: 'num', 'data-label': 'รายการ', text: String(g.assignments) }),
                el('td', { class: 'num', 'data-label': 'ยอดที่ต้องเก็บ', text: money(g.due) }),
                el('td', { class: 'num', 'data-label': 'เก็บได้', text: money(g.paid) }),
                el('td', { class: 'num', 'data-label': 'คงค้าง', text: money(Math.max(0, g.due - g.paid)) }),
                el('td', { 'data-label': 'ความคืบหน้า' }, [
                  el('div', { class: 'progress' }, [el('span', { style: `width:${Math.min(100, pct)}%` })]),
                  el('div', { class: 'tiny muted', text: `${pct}%` }),
                ]),
              ]);
            })),
          ]),
        ]),
      ]));
    }
  },
});

function statCard(label, value, unit, cls, sub) {
  return el('div', { class: `stat ${cls || ''}` }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value' }, [
      value, el('span', { style: 'font-size:.8rem;font-weight:600;color:var(--muted)', text: ' ' + unit }),
    ]),
    sub ? el('div', { class: 'stat-sub', text: sub }) : null,
  ]);
}

/** กราฟแท่ง SVG อย่างง่าย (ไม่ต้องพึ่งไลบรารีภายนอก) */
function barChart(trend) {
  const W = 760, H = 240, padL = 62, padR = 12, padT = 16, padB = 42;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...trend.map((t) => Number(t.total) || 0));
  const niceMax = Math.ceil(max / 1000) * 1000 || max;
  const bw = Math.min(56, (innerW / trend.length) * 0.62);
  const step = innerW / trend.length;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'กราฟยอดรับชำระรายเดือน');

  const mk = (tag, attrs, text) => {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // เส้นกริดและแกน Y
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH / 4) * i;
    svg.appendChild(mk('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'grid-line' }));
    svg.appendChild(mk('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end' },
      money(niceMax - (niceMax / 4) * i, 0)));
  }

  trend.forEach((t, i) => {
    const val = Number(t.total) || 0;
    const h = Math.max(2, (val / niceMax) * innerH);
    const x = padL + step * i + (step - bw) / 2;
    const y = padT + innerH - h;
    const bar = mk('rect', { x, y, width: bw, height: h, rx: 4, class: 'bar' });
    bar.appendChild(mk('title', {}, `${monthLabel(t.ym)}: ${money(val)} บาท (${t.cnt} รายการ)`));
    svg.appendChild(bar);
    svg.appendChild(mk('text', { x: x + bw / 2, y: H - padB + 18, 'text-anchor': 'middle' }, monthLabel(t.ym)));
  });

  return svg;
}

function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${TH_MONTHS_SHORT[(m || 1) - 1]} ${String((y + 543) % 100).padStart(2, '0')}`;
}
