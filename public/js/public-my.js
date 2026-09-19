/* ประวัติการชำระเงินรายบุคคล (สมาชิกดูด้วยรหัสของตนเอง) */
'use strict';

api('/api/public/config').then((cfg) => {
  $('#schoolName').textContent = cfg.school_name;
  $('#contactNote').textContent = cfg.contact_note || '';
  if (!cfg.require_member_pin) {
    $('#pinField').classList.add('hidden');
  }
  if (cfg.school_logo) {
    $('#brandLogo').innerHTML = '';
    $('#brandLogo').appendChild(el('img', { src: cfg.school_logo, alt: 'ตราโรงเรียน' }));
  }
}).catch(() => {});

function render(d) {
  const box = $('#result');
  box.innerHTML = '';
  const t = d.totals;

  box.appendChild(el('section', { class: 'card' }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('h2', { style: 'margin:0', text: d.member.name }),
        el('div', { class: 'small muted' }, [
          el('span', { class: 'mono', text: d.member.member_code }),
          d.member.group_name ? el('span', { text: ` • ${d.member.group_name}` }) : null,
        ]),
      ]),
      el('button', { class: 'btn btn-sm no-print', type: 'button', text: '🖨 พิมพ์', onclick: () => window.print() }),
    ]),
  ]));

  box.appendChild(el('div', { class: 'grid grid-4' }, [
    stat('รายการทั้งหมด', `${t.total_members}`, 'รายการ', ''),
    stat('ยอดที่ต้องชำระรวม', money(t.total_due), 'บาท', 'is-blue'),
    stat('ชำระแล้ว', money(t.total_paid), 'บาท', 'is-green'),
    stat('คงค้าง', money(t.total_outstanding), 'บาท', t.total_outstanding > 0 ? 'is-red' : 'is-green'),
  ]));

  const card = el('section', { class: 'card card-pad-0' });
  card.appendChild(el('div', { class: 'card-head' }, [el('h3', { style: 'font-size:1.05rem', text: 'รายการทั้งหมด' })]));

  if (!d.items.length) {
    card.appendChild(el('div', { class: 'empty' }, [
      el('span', { class: 'empty-icon', text: '📭' }),
      el('div', { text: 'ยังไม่มีรายการที่ต้องชำระ' }),
    ]));
  } else {
    card.appendChild(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data cards' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'รายการจัดเก็บ' }),
          el('th', { class: 'mid', text: 'กำหนดชำระ' }),
          el('th', { class: 'num', text: 'ยอดที่ต้องชำระ' }),
          el('th', { class: 'num', text: 'ชำระแล้ว' }),
          el('th', { class: 'mid', text: 'สถานะ' }),
          el('th', { class: 'mid no-print', text: '' }),
        ])]),
        el('tbody', {}, d.items.map((r) =>
          el('tr', {}, [
            el('td', { 'data-label': 'รายการ' }, [
              el('div', { class: 'bold', text: r.collection_name }),
              el('div', { class: 'tiny muted mono', text: r.collection_code }),
            ]),
            el('td', { class: 'mid small', 'data-label': 'กำหนดชำระ', text: r.due_date ? thaiDate(r.due_date, { short: true }) : '-' }),
            el('td', { class: 'num', 'data-label': 'ยอดที่ต้องชำระ', text: money(r.amount_due) }),
            el('td', { class: 'num', 'data-label': 'ชำระแล้ว', text: money(r.paid_amount) }),
            el('td', { class: 'mid', 'data-label': 'สถานะ' }, [statusBadge(r.status, r.status_label)]),
            el('td', { class: 'mid no-print cell-full', 'data-label': '' }, [
              ['unpaid', 'rejected', 'partial'].includes(r.status)
                ? el('a', { class: 'btn btn-sm btn-red', href: `/collection.html?id=${r.collection_id}`, text: 'ไปแจ้งชำระ' })
                : r.latest_ref
                  ? el('a', { class: 'btn btn-sm', href: `/check.html?ref=${r.latest_ref}`, text: `ดูสลิป (${r.latest_ref})` })
                  : null,
            ]),
          ]))),
        el('tfoot', {}, [el('tr', {}, [
          el('td', { colspan: '2', text: 'รวมทั้งสิ้น' }),
          el('td', { class: 'num', text: money(t.total_due) }),
          el('td', { class: 'num', text: money(t.total_paid) }),
          el('td', { colspan: '2', class: 'mid', text: `คงค้าง ${money(t.total_outstanding)} บาท` }),
        ])]),
      ]),
    ]));
  }
  box.appendChild(card);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stat(label, value, unit, cls) {
  return el('div', { class: `stat ${cls}` }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value' }, [value, el('span', { style: 'font-size:.85rem;font-weight:600;color:var(--muted)', text: ' ' + unit })]),
  ]);
}

$('#myForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#myBtn');
  busy(btn, true, 'กำลังค้นหา...');
  try {
    const d = await api('/api/public/member/history', {
      method: 'POST',
      body: { member_code: $('#codeInput').value.trim(), pin: $('#pinInput').value },
    });
    render(d);
    $('#pinInput').value = '';
  } catch (err) {
    toast(err.message, 'error');
    $('#result').innerHTML = '';
  } finally {
    busy(btn, false);
  }
});
