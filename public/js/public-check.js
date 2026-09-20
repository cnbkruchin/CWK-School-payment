/* ตรวจสอบสถานะและดูสลิปด้วยรหัสสมาชิก + รหัส PIN ล่าสุด */
'use strict';

api('/api/public/config').then((cfg) => {
  $('#schoolName').textContent = cfg.school_name;
  $('#contactNote').textContent = cfg.contact_note || '';
  if (cfg.school_logo) {
    $('#brandLogo').innerHTML = '';
    $('#brandLogo').appendChild(el('img', { src: cfg.school_logo, alt: 'ตราโรงเรียน' }));
  }
}).catch(() => {});

const STATUS_MAP = {
  pending:  { key: 'pending',  icon: '⏳', color: 'var(--amber-600)', title: 'รอตรวจสอบ',
              desc: 'ผู้ดูแลระบบได้รับการแจ้งชำระของท่านแล้ว อยู่ระหว่างตรวจสอบสลิป' },
  approved: { key: 'paid',     icon: '✅', color: 'var(--green-600)', title: 'ชำระแล้ว',
              desc: 'ตรวจสอบและยืนยันการชำระเงินเรียบร้อยแล้ว' },
  rejected: { key: 'rejected', icon: '❌', color: 'var(--red-600)', title: 'ไม่ผ่านการตรวจสอบ',
              desc: 'กรุณาตรวจสอบเหตุผลและแจ้งชำระใหม่อีกครั้ง' },
};

/** ข้อมูลยืนยันตัวตนที่ใช้ค้นหาครั้งล่าสุด (ใช้ซ้ำตอนเรียกดูสลิป) */
let AUTH = null;

/** สร้าง query string สำหรับเรียก API ที่ต้องยืนยันตัวตน */
function authQuery() {
  return `member_code=${encodeURIComponent(AUTH.member_code)}&pin=${encodeURIComponent(AUTH.pin)}`;
}

async function check(memberCode, pin) {
  const box = $('#result');
  box.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังค้นหา...</div>';
  AUTH = { member_code: memberCode, pin };
  try {
    const p = await api(`/api/public/payments/lookup?${authQuery()}`);
    render(p);
    const url = new URL(location.href);
    url.searchParams.set('code', memberCode);
    url.searchParams.delete('ref');
    history.replaceState(null, '', url);
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'alert alert-error' }, [e.message]),
      el('p', { class: 'small muted', style: 'margin:1rem 0 0' },
        ['หากจำรหัส PIN ล่าสุดไม่ได้ กรุณาติดต่อฝ่ายการเงินของโรงเรียนเพื่อขอรหัสใหม่']),
    ]));
  }
}

function render(p) {
  const st = STATUS_MAP[p.status] || STATUS_MAP.pending;
  const box = $('#result');
  box.innerHTML = '';

  box.appendChild(el('section', { class: 'card stack' }, [
    el('div', { class: 'center' }, [
      el('div', { style: 'font-size:3.2rem;line-height:1', text: st.icon }),
      el('h2', { style: `margin:.3rem 0 .1rem;color:${st.color}`, text: st.title }),
      el('p', { class: 'muted small', style: 'margin:0', text: st.desc }),
      el('div', { style: 'margin-top:.7rem' }, [
        el('span', { class: 'chip', style: 'font-size:1rem', text: `เลขอ้างอิง ${p.ref_code}` }),
      ]),
    ]),

    el('hr', { class: 'divider' }),

    el('dl', { class: 'kv' }, [
      el('dt', { text: 'ผู้ชำระ' }), el('dd', { text: `${p.member.name} (${p.member.member_code})` }),
      p.member.group_name ? el('dt', { text: 'กลุ่ม/ชั้น' }) : null,
      p.member.group_name ? el('dd', { text: p.member.group_name }) : null,
      el('dt', { text: 'รายการจัดเก็บ' }), el('dd', { text: `${p.collection.name} (${p.collection.code})` }),
      el('dt', { text: 'จำนวนเงิน' }),
      el('dd', { style: 'font-size:1.15rem;font-weight:800', text: `${money(p.amount)} บาท` }),
      p.payer_name ? el('dt', { text: 'ชื่อผู้โอน' }) : null,
      p.payer_name ? el('dd', { text: p.payer_name }) : null,
      p.transferred_at ? el('dt', { text: 'วัน-เวลาที่โอน' }) : null,
      p.transferred_at ? el('dd', { text: thaiDate(p.transferred_at, { withTime: true }) }) : null,
      el('dt', { text: 'วันที่แจ้งชำระ' }), el('dd', { text: thaiDate(p.submitted_at, { withTime: true }) }),
      p.verified_at ? el('dt', { text: 'วันที่ตรวจสอบ' }) : null,
      p.verified_at ? el('dd', { text: thaiDate(p.verified_at, { withTime: true }) }) : null,
      p.verified_by_name ? el('dt', { text: 'ผู้ตรวจสอบ' }) : null,
      p.verified_by_name ? el('dd', { text: p.verified_by_name }) : null,
      p.receipt_no ? el('dt', { text: 'เลขที่ใบเสร็จ' }) : null,
      p.receipt_no ? el('dd', { class: 'mono', text: p.receipt_no }) : null,
      p.note ? el('dt', { text: 'หมายเหตุ' }) : null,
      p.note ? el('dd', { text: p.note }) : null,
    ]),

    p.reject_reason ? el('div', { class: 'alert alert-error' }, [
      el('div', {}, [el('strong', { text: 'เหตุผลที่ไม่ผ่าน: ' }), p.reject_reason]),
    ]) : null,

    p.has_slip ? el('div', {}, [
      el('div', { class: 'label', text: 'สลิปที่แนบไว้' }),
      p.slip_mime === 'application/pdf'
        ? el('a', { class: 'btn btn-block', href: `/api/public/payments/slip?${authQuery()}`, target: '_blank', rel: 'noopener', text: '📄 เปิดไฟล์ PDF สลิป' })
        : el('img', { src: `/api/public/payments/slip?${authQuery()}`, class: 'slip-frame', alt: `สลิปเลขอ้างอิง ${p.ref_code}`, loading: 'lazy' }),
    ]) : null,

    el('div', { class: 'row no-print', style: 'margin-top:.5rem' }, [
      el('button', { class: 'btn grow', type: 'button', text: '🖨 พิมพ์หลักฐาน', onclick: () => window.print() }),
      el('a', { class: 'btn grow', href: `/collection.html?id=${p.collection.id}`, text: 'ดูรายการจัดเก็บ' }),
    ]),
  ]));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#checkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#checkCode').value.trim();
  const ref = $('#refInput').value.replace(/\D/g, '');
  if (!code) return toast('กรุณากรอกรหัสสมาชิก', 'warn');
  if (ref.length < 4) return toast('กรุณากรอกรหัส PIN 6 หลักให้ครบถ้วน', 'warn');
  busy($('#checkBtn'), true, 'กำลังค้นหา...');
  await check(code, ref);
  busy($('#checkBtn'), false);
});

$('#refInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '');
});

const initialCode = qs('code');
const initialPin = qs('pin');
if (initialCode) $('#checkCode').value = initialCode;
if (initialCode && initialPin) {
  $('#refInput').value = initialPin.replace(/\D/g, '');
  check(initialCode, $('#refInput').value);
} else if (initialCode) {
  $('#refInput').focus();
}
