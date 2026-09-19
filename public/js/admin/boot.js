/* จุดเริ่มต้นของแอปผู้ดูแลระบบ */
'use strict';

(async function boot() {
  try {
    ADMIN.config = await api('/api/public/config');
  } catch { /* ใช้ค่าเริ่มต้น */ }

  // เส้นทางตั้งรหัสผ่านใหม่ใช้งานได้โดยไม่ต้องเข้าสู่ระบบ
  if ((location.hash || '').startsWith('#/reset-password')) {
    const token = new URLSearchParams((location.hash.split('?')[1] || '')).get('token') || '';
    window.addEventListener('hashchange', handleRoute);
    return renderResetPassword(token);
  }

  try {
    const me = await api('/api/admin/me');
    ADMIN.user = me.admin;
    setCsrf(me.csrfToken);
    if (!location.hash || location.hash === '#/' || location.hash === '#/login') location.hash = '#/dashboard';
    await renderShell();
  } catch (e) {
    if (e.status === 401) renderLogin();
    else {
      $('#root').innerHTML = '';
      $('#root').appendChild(el('div', { class: 'login-page' }, [
        el('div', { class: 'login-card' }, [
          el('div', { class: 'alert alert-error' }, [`ไม่สามารถเชื่อมต่อระบบได้: ${e.message}`]),
          el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:1rem', type: 'button', text: 'ลองใหม่', onclick: () => location.reload() }),
        ]),
      ]));
    }
  }

  window.addEventListener('hashchange', handleRoute);
})();
