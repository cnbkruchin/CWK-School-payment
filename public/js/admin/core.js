/* แกนหลักของส่วนผู้ดูแลระบบ: การเข้าสู่ระบบ โครงหน้า และเส้นทาง */
'use strict';

const ADMIN = {
  user: null,
  config: { school_name: 'โรงเรียนจุนวิทยาคม', school_logo: '' },
  pendingCount: 0,
  routes: {},
  current: '',
};

const ROLE_LABEL = { superadmin: 'ผู้ดูแลระบบสูงสุด', admin: 'ผู้ดูแลระบบ', viewer: 'ผู้ดูรายงาน' };

/* เส้นทางทั้งหมด (ลงทะเบียนโดยไฟล์โมดูลอื่น) */
function route(path, def) { ADMIN.routes[path] = def; }

/** ผู้ใช้ปัจจุบันมีสิทธิ์แก้ไขข้อมูลหรือไม่ */
function canWrite() { return ADMIN.user && ADMIN.user.role !== 'viewer'; }
function isSuper() { return ADMIN.user && ADMIN.user.role === 'superadmin'; }

/** แจ้งเตือนเมื่อไม่มีสิทธิ์ */
function needWrite() {
  if (canWrite()) return false;
  toast('บัญชีของท่านเป็น "ผู้ดูรายงาน" จึงแก้ไขข้อมูลไม่ได้', 'warn');
  return true;
}

/* ============================ หน้าเข้าสู่ระบบ ============================ */
function renderLogin(message) {
  const root = $('#root');
  root.innerHTML = '';

  const form = el('form', { id: 'loginForm', autocomplete: 'on' }, [
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'u', text: 'ชื่อผู้ใช้ หรืออีเมล' }),
      el('input', { type: 'text', id: 'u', name: 'username', required: true, autocomplete: 'username', autocapitalize: 'none' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'p', text: 'รหัสผ่าน' }),
      el('input', { type: 'password', id: 'p', name: 'password', required: true, autocomplete: 'current-password' }),
    ]),
    el('div', { id: 'loginErr', class: 'hidden' }),
    el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit', id: 'loginBtn', text: 'เข้าสู่ระบบ' }),
  ]);

  root.appendChild(el('div', { class: 'login-page' }, [
    el('div', { class: 'login-card' }, [
      el('div', { class: 'login-logo', id: 'loginLogo', text: '🏫' }),
      el('h1', { class: 'center', style: 'font-size:1.25rem;margin-bottom:.1rem', text: ADMIN.config.school_name }),
      el('p', { class: 'center muted small', style: 'margin-bottom:1.25rem', text: 'ระบบผู้ดูแล — แจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ' }),
      message ? el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' }, [message]) : null,
      form,
      el('div', { class: 'center', style: 'margin-top:1rem' }, [
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'ลืมรหัสผ่าน?', onclick: openForgot }),
        el('a', { class: 'btn btn-ghost btn-sm', href: '/', text: 'กลับหน้าผู้ใช้' }),
      ]),
    ]),
  ]));

  if (ADMIN.config.school_logo) {
    $('#loginLogo').innerHTML = '';
    $('#loginLogo').appendChild(el('img', { src: ADMIN.config.school_logo, alt: 'ตราโรงเรียน' }));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginErr');
    err.className = 'hidden';
    busy($('#loginBtn'), true, 'กำลังเข้าสู่ระบบ...');
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { username: $('#u').value, password: $('#p').value } });
      setCsrf(r.csrfToken);
      ADMIN.user = r.admin;
      location.hash = r.admin.must_change_pw ? '#/profile' : '#/dashboard';
      await renderShell();
      if (r.admin.must_change_pw) toast('กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน', 'warn', 6000);
    } catch (ex) {
      err.className = 'alert alert-error';
      err.textContent = ex.message;
      busy($('#loginBtn'), false);
    }
  });
}

/* --------------------------- ลืมรหัสผ่าน --------------------------- */
function openForgot() {
  const form = el('form', { id: 'forgotForm', autocomplete: 'off' }, [
    el('div', { class: 'alert alert-info', style: 'margin-bottom:1rem' }, [
      'ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยัง ',
      el('strong', { text: 'อีเมลของผู้ดูแลที่ลงทะเบียนไว้' }),
      ' เท่านั้น (ลิงก์มีอายุ 30 นาที)',
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'fu', text: 'ชื่อผู้ใช้' }),
      el('input', { type: 'text', id: 'fu', required: true, autocapitalize: 'none' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'req', for: 'fe', text: 'อีเมลของผู้ดูแลที่ลงทะเบียนไว้' }),
      el('input', { type: 'email', id: 'fe', required: true, autocapitalize: 'none' }),
    ]),
    el('div', { id: 'forgotMsg', class: 'hidden' }),
  ]);

  const btn = el('button', { class: 'btn btn-primary', type: 'submit', form: 'forgotForm', text: 'ส่งลิงก์รีเซ็ตรหัสผ่าน' });
  const m = modal({
    title: 'ลืมรหัสผ่านผู้ดูแลระบบ',
    body: form, size: 'modal-sm',
    footer: [el('button', { class: 'btn', type: 'button', text: 'ปิด', onclick: () => m.close() }), btn],
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    busy(btn, true, 'กำลังส่ง...');
    try {
      const r = await api('/api/admin/forgot-password', { method: 'POST', body: { username: $('#fu').value, email: $('#fe').value } });
      const msg = $('#forgotMsg');
      msg.className = 'alert alert-success';
      msg.textContent = r.message;
      btn.remove();
    } catch (ex) {
      const msg = $('#forgotMsg');
      msg.className = 'alert alert-error';
      msg.textContent = ex.message;
      busy(btn, false);
    }
  });
}

/* --------------------------- ตั้งรหัสผ่านใหม่ด้วยโทเคน --------------------------- */
async function renderResetPassword(token) {
  const root = $('#root');
  root.innerHTML = '';

  let valid = false;
  try { valid = (await api(`/api/admin/reset-password/check?token=${encodeURIComponent(token)}`)).valid; } catch { /* ignore */ }

  const card = el('div', { class: 'login-card' }, [
    el('div', { class: 'login-logo', text: '🔑' }),
    el('h1', { class: 'center', style: 'font-size:1.2rem', text: 'ตั้งรหัสผ่านใหม่' }),
  ]);

  if (!valid) {
    card.appendChild(el('div', { class: 'alert alert-error', style: 'margin:1rem 0' },
      ['ลิงก์ไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง']));
    card.appendChild(el('a', { class: 'btn btn-primary btn-block', href: '#/login', text: 'กลับหน้าเข้าสู่ระบบ', onclick: () => setTimeout(() => location.reload(), 30) }));
  } else {
    const form = el('form', { id: 'resetForm', autocomplete: 'off' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'req', for: 'np', text: 'รหัสผ่านใหม่' }),
        el('input', { type: 'password', id: 'np', required: true, minlength: '8', autocomplete: 'new-password' }),
        el('div', { class: 'hint', text: 'อย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'req', for: 'cp', text: 'ยืนยันรหัสผ่านใหม่' }),
        el('input', { type: 'password', id: 'cp', required: true, minlength: '8', autocomplete: 'new-password' }),
      ]),
      el('div', { id: 'resetErr', class: 'hidden' }),
      el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit', id: 'resetBtn', text: 'บันทึกรหัสผ่านใหม่' }),
    ]);
    card.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      busy($('#resetBtn'), true, 'กำลังบันทึก...');
      try {
        await api('/api/admin/reset-password', {
          method: 'POST',
          body: { token, password: $('#np').value, confirm_password: $('#cp').value },
        });
        location.hash = '#/login';
        renderLogin('ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
      } catch (ex) {
        const err = $('#resetErr');
        err.className = 'alert alert-error';
        err.textContent = ex.message;
        busy($('#resetBtn'), false);
      }
    });
  }
  root.appendChild(el('div', { class: 'login-page' }, [card]));
}

/* ============================== โครงหน้าหลัก ============================== */
const NAV = [
  { group: 'ภาพรวม', items: [
    { path: 'dashboard', icon: '📊', label: 'แดชบอร์ด' },
    { path: 'payments', icon: '🧾', label: 'ตรวจสอบการชำระ', badge: 'pending' },
  ]},
  { group: 'การจัดเก็บ', items: [
    { path: 'collections', icon: '📋', label: 'รายการจัดเก็บ' },
    { path: 'members', icon: '👥', label: 'สมาชิก' },
    { path: 'groups', icon: '🏷️', label: 'กลุ่ม/ชั้นเรียน' },
  ]},
  { group: 'รายงาน', items: [
    { path: 'reports', icon: '📈', label: 'รายงานและส่งออก' },
    { path: 'audit', icon: '📜', label: 'บันทึกกิจกรรม' },
  ]},
  { group: 'ตั้งค่า', items: [
    { path: 'settings', icon: '⚙️', label: 'ตั้งค่าระบบ' },
    { path: 'users', icon: '🔐', label: 'ผู้ดูแลระบบ', superOnly: true },
    { path: 'profile', icon: '👤', label: 'บัญชีของฉัน' },
  ]},
];

async function renderShell() {
  const root = $('#root');
  root.innerHTML = '';

  const sidebar = el('aside', { class: 'sidebar', id: 'sidebar' }, [
    el('div', { class: 'sidebar-head' }, [
      el('div', { class: 'sidebar-logo', id: 'sbLogo', text: '🏫' }),
      el('div', { style: 'min-width:0;flex:1' }, [
        el('div', { class: 'sidebar-title', text: ADMIN.config.school_name }),
        el('div', { class: 'sidebar-sub', text: 'ระบบผู้ดูแล' }),
      ]),
      el('button', {
        class: 'sidebar-close', type: 'button', 'aria-label': 'ปิดเมนู',
        html: '&times;', onclick: closeSidebar,
      }),
    ]),
    el('nav', { class: 'sidebar-nav', id: 'sidebarNav' }),
    el('div', { class: 'sidebar-foot' }, [
      el('div', { class: 'user-chip' }, [
        el('div', { class: 'avatar', text: (ADMIN.user.full_name || ADMIN.user.username || '?').trim().charAt(0) }),
        el('div', { style: 'min-width:0;flex:1' }, [
          el('div', { class: 'small bold', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: ADMIN.user.full_name }),
          el('div', { class: 'tiny muted', text: ROLE_LABEL[ADMIN.user.role] || ADMIN.user.role }),
        ]),
      ]),
      el('div', { class: 'row', style: 'gap:.35rem' }, [
        el('button', { class: 'btn btn-sm grow', type: 'button', text: '🌗 ธีม', onclick: toggleTheme }),
        el('a', { class: 'btn btn-sm grow', href: '/', target: '_blank', rel: 'noopener', text: '🔗 หน้าผู้ใช้' }),
      ]),
      el('button', { class: 'btn btn-sm btn-block', style: 'margin-top:.35rem', type: 'button', text: '🚪 ออกจากระบบ', onclick: logout }),
    ]),
  ]);

  const main = el('div', { class: 'admin-main' }, [
    el('div', { class: 'topbar' }, [
      el('button', { class: 'hamburger', type: 'button', 'aria-label': 'เปิดเมนู', text: '☰', onclick: toggleSidebar }),
      el('div', { class: 'bold', style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', id: 'topTitle', text: 'ระบบผู้ดูแล' }),
    ]),
    el('div', { class: 'admin-content', id: 'view' }),
  ]);

  root.appendChild(el('div', { class: 'admin-shell' }, [
    el('div', { class: 'sidebar-backdrop', id: 'sbBackdrop', onclick: toggleSidebar }),
    sidebar, main,
  ]));

  if (ADMIN.config.school_logo) {
    $('#sbLogo').innerHTML = '';
    $('#sbLogo').appendChild(el('img', { src: ADMIN.config.school_logo, alt: 'ตราโรงเรียน' }));
  }

  buildNav();
  refreshPendingCount();
  await handleRoute();
}

function buildNav() {
  const nav = $('#sidebarNav');
  if (!nav) return;
  nav.innerHTML = '';
  for (const grp of NAV) {
    const items = grp.items.filter((i) => !i.superOnly || isSuper());
    if (!items.length) continue;
    nav.appendChild(el('div', { class: 'nav-group-label', text: grp.group }));
    for (const it of items) {
      nav.appendChild(el('a', {
        class: `nav-item${ADMIN.current === it.path ? ' active' : ''}`,
        href: `#/${it.path}`, dataset: { path: it.path },
        onclick: () => { if (window.innerWidth <= 1024) closeSidebar(); },
      }, [
        el('span', { class: 'nav-icon', text: it.icon }),
        el('span', { text: it.label }),
        it.badge === 'pending' && ADMIN.pendingCount > 0
          ? el('span', { class: 'nav-count', text: String(ADMIN.pendingCount) }) : null,
      ]));
    }
  }
}

function toggleSidebar() {
  const sb = $('#sidebar');
  const bd = $('#sbBackdrop');
  if (!sb) return;
  sb.classList.toggle('open');
  bd.classList.toggle('show', sb.classList.contains('open'));
}
function closeSidebar() {
  const sb = $('#sidebar');
  if (sb) { sb.classList.remove('open'); $('#sbBackdrop').classList.remove('show'); }
}

async function refreshPendingCount() {
  try {
    const r = await api('/api/admin/payments?status=pending&per_page=1');
    ADMIN.pendingCount = r.counts.pending;
    buildNav();
  } catch { /* ไม่สำคัญพอจะรบกวนผู้ใช้ */ }
}

async function logout() {
  if (!(await confirmDialog({ title: 'ออกจากระบบ', message: 'ต้องการออกจากระบบใช่หรือไม่?', confirmText: 'ออกจากระบบ' }))) return;
  try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
  ADMIN.user = null;
  setCsrf('');
  location.hash = '#/login';
  renderLogin('ออกจากระบบเรียบร้อยแล้ว');
}

/* ================================ เส้นทาง ================================ */
function parseHash() {
  const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  return { path: segs[0] || 'dashboard', params: segs.slice(1), query: new URLSearchParams(queryPart || '') };
}

async function handleRoute() {
  const { path, params, query } = parseHash();

  if (path === 'reset-password') return renderResetPassword(query.get('token') || '');
  if (!ADMIN.user) return renderLogin();
  if (path === 'login') { location.hash = '#/dashboard'; return; }

  const def = ADMIN.routes[path];
  const view = $('#view');
  if (!view) return renderShell();

  if (!def) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card empty' }, [
      el('span', { class: 'empty-icon', text: '🔍' }),
      el('h3', { text: 'ไม่พบหน้าที่ต้องการ' }),
      el('a', { class: 'btn btn-primary', href: '#/dashboard', text: 'กลับหน้าแดชบอร์ด' }),
    ]));
    return;
  }
  if (def.superOnly && !isSuper()) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card' }, [el('div', { class: 'alert alert-error' }, ['คุณไม่มีสิทธิ์เข้าถึงหน้านี้'])]));
    return;
  }

  ADMIN.current = path;
  buildNav();
  const title = (NAV.flatMap((g) => g.items).find((i) => i.path === path) || {}).label || 'ระบบผู้ดูแล';
  const topTitle = $('#topTitle');
  if (topTitle) topTitle.textContent = title;
  document.title = `${title} — ระบบผู้ดูแล`;

  view.innerHTML = '<div class="loading"><span class="spinner"></span> กำลังโหลด...</div>';
  try {
    await def.render(view, params, query);
  } catch (e) {
    if (e.status === 401) {
      ADMIN.user = null;
      return renderLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    }
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'alert alert-error' }, [e.message || 'เกิดข้อผิดพลาด']),
      el('button', { class: 'btn', style: 'margin-top:1rem', type: 'button', text: 'ลองใหม่', onclick: () => handleRoute() }),
    ]));
  }
}

/* ---------------------------- ตัวช่วยหน้าเพจ ---------------------------- */
function pageHead(title, sub, actions = []) {
  return el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { text: title }), sub ? el('div', { class: 'sub', text: sub }) : null]),
    actions.length ? el('div', { class: 'row no-print', style: 'gap:.5rem' }, actions) : null,
  ]);
}

function emptyState(icon, title, sub, action) {
  return el('div', { class: 'empty' }, [
    el('span', { class: 'empty-icon', text: icon }),
    el('h3', { style: 'margin:.2rem 0', text: title }),
    sub ? el('p', { class: 'muted small', style: 'margin:0 0 1rem', text: sub }) : null,
    action || null,
  ]);
}

function pager(info, onGo) {
  if (!info || info.pages <= 1) return null;
  const box = el('div', { class: 'pager' });
  const mk = (label, page, disabled, active) =>
    el('button', {
      class: `btn btn-sm${active ? ' btn-primary' : ''}`, type: 'button', text: label,
      disabled: disabled || false, onclick: () => onGo(page),
    });

  box.appendChild(mk('« แรก', 1, info.page === 1));
  box.appendChild(mk('‹ ก่อน', info.page - 1, info.page === 1));
  const from = Math.max(1, info.page - 2);
  const to = Math.min(info.pages, from + 4);
  for (let p = from; p <= to; p++) box.appendChild(mk(String(p), p, false, p === info.page));
  box.appendChild(mk('ถัดไป ›', info.page + 1, info.page === info.pages));
  box.appendChild(mk('สุดท้าย »', info.pages, info.page === info.pages));
  box.appendChild(el('span', { class: 'small muted', style: 'margin-inline-start:.5rem', text: `ทั้งหมด ${info.total} รายการ` }));
  return box;
}
