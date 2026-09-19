/* ตัวช่วยที่ใช้ร่วมกันทุกหน้า */
'use strict';

/* --------------------------- เลือก element --------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* --------------------------- สร้าง element --------------------------- */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (val === null || val === undefined || val === false) continue;
    if (k === 'class') node.className = val;
    else if (k === 'html') node.innerHTML = val;
    else if (k === 'text') node.textContent = val;
    else if (k === 'dataset') Object.assign(node.dataset, val);
    else if (k.startsWith('on') && typeof val === 'function') node.addEventListener(k.slice(2).toLowerCase(), val);
    else node.setAttribute(k, val === true ? '' : String(val));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

/* ป้องกัน XSS เมื่อต้องใช้ innerHTML */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------ รูปแบบข้อมูล ------------------------------ */
const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00');
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) d = new Date(s.replace(' ', 'T') + 'Z');
  else d = new Date(s);
  return isNaN(d) ? null : d;
}

function thaiDate(v, opts = {}) {
  const d = toDate(v);
  if (!d) return '-';
  const M = opts.short ? TH_MONTHS_SHORT : TH_MONTHS;
  let out = `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear() + 543}`;
  if (opts.withTime) {
    out += ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} น.`;
  }
  return out;
}

function money(n, decimals = 2) {
  const v = Number(n) || 0;
  // money มักถูกใช้เป็น callback (เช่น fmt: money) ซึ่งจะได้อาร์กิวเมนต์ที่สองเป็น object
  // จึงต้องตรวจสอบให้แน่ใจว่าเป็นจำนวนเต็ม 0-20 ก่อนส่งให้ toLocaleString
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 20 ? decimals : 2;
  return v.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function relativeTime(v) {
  const d = toDate(v);
  if (!d) return '-';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'เมื่อสักครู่';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return thaiDate(v, { short: true });
}

function fileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

/* ------------------------------ เรียก API ------------------------------ */
let CSRF_TOKEN = '';
function setCsrf(t) { CSRF_TOKEN = t || ''; }
function getCsrf() { return CSRF_TOKEN; }

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  if (CSRF_TOKEN) headers['x-csrf-token'] = CSRF_TOKEN;

  const res = await fetch(path, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers, body, credentials: 'same-origin',
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError('เกิดข้อผิดพลาดในการเชื่อมต่อระบบ', res.status, null);
    return res;
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'เกิดข้อผิดพลาด', res.status, data);
  return data;
}

/* ดาวน์โหลดไฟล์จาก API พร้อมแนบคุกกี้/โทเคน */
async function download(path, fallbackName = 'download') {
  const headers = {};
  if (CSRF_TOKEN) headers['x-csrf-token'] = CSRF_TOKEN;
  const res = await fetch(path, { credentials: 'same-origin', headers });
  if (!res.ok) {
    let msg = 'ดาวน์โหลดไม่สำเร็จ';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status, null);
  }
  const disp = res.headers.get('content-disposition') || '';
  let name = fallbackName;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const plain = /filename="([^"]+)"/i.exec(disp);
  if (star) name = decodeURIComponent(star[1]);
  else if (plain) name = plain[1];

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------ ข้อความลอย ------------------------------ */
function toast(message, type = 'info', ms = 3800) {
  let box = $('#toasts');
  if (!box) { box = el('div', { id: 'toasts' }); document.body.appendChild(box); }
  const t = el('div', { class: `toast toast-${type}`, role: 'status', text: message });
  box.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 260);
  }, ms);
}

/* ------------------------------- ป๊อปอัป ------------------------------- */
let openModals = 0;
function modal({ title, body, footer, size = '', onClose, closeOnBackdrop = true }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const box = el('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });

  const close = () => {
    backdrop.remove();
    openModals = Math.max(0, openModals - 1);
    if (!openModals) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  if (title) {
    box.appendChild(el('div', { class: 'modal-head' }, [
      el('h3', { text: title }),
      el('button', { class: 'modal-close', type: 'button', 'aria-label': 'ปิด', onclick: close, html: '&times;' }),
    ]));
  }
  const bodyEl = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  box.appendChild(bodyEl);

  if (footer) {
    const f = el('div', { class: 'modal-foot' });
    [].concat(footer).forEach((b) => b && f.appendChild(b));
    box.appendChild(f);
  }

  backdrop.appendChild(box);
  if (closeOnBackdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  openModals++;

  const focusable = box.querySelector('input:not([type=hidden]), select, textarea, button.btn-primary, button');
  if (focusable) setTimeout(() => focusable.focus(), 60);

  return { close, box, body: bodyEl, backdrop };
}

function confirmDialog({ title = 'ยืนยันการทำรายการ', message, confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (done) return; done = true; m.close(); resolve(val); };
    const m = modal({
      title, size: 'modal-sm',
      body: el('div', {}, [typeof message === 'string' ? el('p', { text: message, style: 'margin:0' }) : message]),
      footer: [
        el('button', { class: 'btn', type: 'button', text: cancelText, onclick: () => finish(false) }),
        el('button', { class: `btn ${danger ? 'btn-red' : 'btn-primary'}`, type: 'button', text: confirmText, onclick: () => finish(true) }),
      ],
      onClose: () => finish(false),
    });
  });
}

/* --------------------------- สถานะปุ่มขณะทำงาน --------------------------- */
function busy(btn, on = true, labelWhenBusy = 'กำลังทำงาน...') {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.innerHTML;
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> ${esc(labelWhenBusy)}`;
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

/* -------------------------------- ธีม -------------------------------- */
function initTheme() {
  try {
    const saved = localStorage.getItem('cwk-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch { /* ไม่มีสิทธิ์เข้าถึง localStorage ก็ใช้ค่าตามระบบ */ }
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = cur ? (cur === 'dark' ? 'light' : 'dark') : (sysDark ? 'light' : 'dark');
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cwk-theme', next); } catch { /* ignore */ }
  return next;
}
initTheme();

/* ----------------------------- สถานะการชำระ ----------------------------- */
const STATUS_META = {
  unpaid:   { label: 'ยังไม่ชำระ',          badge: 'badge-unpaid',   btn: 'btn-red',   action: 'แจ้งชำระเงิน' },
  rejected: { label: 'ไม่ผ่านการตรวจสอบ',   badge: 'badge-rejected', btn: 'btn-red',   action: 'แจ้งชำระใหม่' },
  pending:  { label: 'รอตรวจสอบ',           badge: 'badge-pending',  btn: 'btn-amber', action: 'ดูสลิปที่แจ้ง' },
  partial:  { label: 'ชำระบางส่วน',         badge: 'badge-partial',  btn: 'btn-blue',  action: 'ชำระส่วนที่เหลือ' },
  paid:     { label: 'ชำระแล้ว',            badge: 'badge-paid',     btn: 'btn-green', action: 'ดูหลักฐาน' },
  waived:   { label: 'ยกเว้นการชำระ',       badge: 'badge-waived',   btn: 'btn',       action: 'ยกเว้น' },
};
function statusBadge(status, label) {
  const m = STATUS_META[status] || { label: label || status, badge: 'badge-draft' };
  return el('span', { class: `badge ${m.badge}`, text: label || m.label });
}

/* -------------------------------- อื่น ๆ -------------------------------- */
function debounce(fn, ms = 320) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* ใช้วิธีสำรองด้านล่าง */ }
  try {
    const ta = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function qs(name, def = null) {
  return new URLSearchParams(location.search).get(name) ?? def;
}
