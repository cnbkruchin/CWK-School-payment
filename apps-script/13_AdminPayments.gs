/**
 * ===========================================================================
 *  API ผู้ดูแล: ตรวจสอบและอนุมัติการชำระเงิน
 * ===========================================================================
 */

function paymentView_(p, ctx) {
  var a = ctx.assignments[p.assignment_id];
  var m = a ? ctx.members[a.member_id] : null;
  var g = m ? ctx.groups[m.group_id] : null;
  var c = a ? ctx.collections[a.collection_id] : null;
  var verifier = p.verified_by ? ctx.admins[p.verified_by] : null;
  var bank = p.bank_account_id ? ctx.banks[p.bank_account_id] : null;

  return {
    id: p.id,
    ref_code: p.ref_code,
    assignment_id: p.assignment_id,
    amount: Number(p.amount) || 0,
    method: p.method,
    method_label: { cash: 'เงินสด', transfer: 'โอนเงิน', other: 'อื่น ๆ' }[p.method] || p.method,
    payer_name: p.payer_name,
    transferred_at: iso_(p.transferred_at),
    created_at: iso_(p.created_at),
    verified_at: iso_(p.verified_at),
    verified_by_name: verifier ? verifier.full_name : null,
    status: p.status,
    status_label: PAYMENT_STATUS_LABEL[p.status] || p.status,
    reject_reason: p.reject_reason || null,
    receipt_no: p.receipt_no || null,
    note: p.note || null,
    has_slip: !!p.slip_file_id,
    slip_mime: p.slip_mime,
    slip_size: Number(p.slip_size) || 0,
    slip_hash: p.slip_hash,
    member_id: m ? m.id : null,
    member_code: m ? m.member_code : '-',
    full_name: m ? String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim() : '(ไม่พบสมาชิก)',
    phone: m ? m.phone : '',
    group_name: g ? g.name : null,
    collection_id: c ? c.id : null,
    collection_code: c ? c.code : '-',
    collection_name: c ? c.name : '(ไม่พบรายการ)',
    allow_partial: c ? !!c.allow_partial : false,
    bank_name: bank ? bank.bank_name : null,
    account_number: bank ? bank.account_number : null
  };
}

function paymentContext_() {
  return {
    assignments: loadTable_('Assignments').index,
    members: loadTable_('Members').index,
    groups: loadTable_('Groups').index,
    collections: loadTable_('Collections').index,
    admins: loadTable_('Admins').index,
    banks: loadTable_('BankAccounts').index
  };
}

function paymentCounts_() {
  var rows = dbAll('Payments');
  var c = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (var i = 0; i < rows.length; i++) {
    if (c[rows[i].status] !== undefined) c[rows[i].status]++;
  }
  return c;
}

function apiPayments(payload) {
  return apiCall_('payments', function () {
    payload = payload || {};
    requireAdmin_(payload.token);

    var status = str_(payload.status, 20);
    var collectionId = id_(payload.collection);
    var groupId = id_(payload.group);
    var q = str_(payload.q, 100).toLowerCase();
    var page = Math.max(1, num_(payload.page, 1));
    var perPage = Math.min(200, Math.max(10, num_(payload.per_page, 50)));

    var ctx = paymentContext_();
    var rows = dbAll('Payments').filter(function (p) {
      if (status && PAYMENT_STATUS_LABEL[status]) { if (p.status !== status) return false; }
      else if (p.status === 'cancelled') return false;

      var a = ctx.assignments[p.assignment_id];
      if (collectionId && (!a || Number(a.collection_id) !== collectionId)) return false;
      if (groupId) {
        var m = a ? ctx.members[a.member_id] : null;
        if (!m || Number(m.group_id) !== groupId) return false;
      }
      if (q) {
        var mm = a ? ctx.members[a.member_id] : null;
        var name = mm ? String((mm.prefix || '') + mm.first_name + ' ' + mm.last_name).toLowerCase() : '';
        var hay = String(p.ref_code) + ' ' + (mm ? mm.member_code : '') + ' ' + name + ' ' + String(p.payer_name || '');
        if (hay.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });

    // รอตรวจสอบขึ้นก่อน แล้วเรียงตามเวลาที่แจ้งล่าสุด
    rows.sort(function (a, b) {
      var pa = a.status === 'pending' ? 0 : 1;
      var pb = b.status === 'pending' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      var ka = String(a.created_at || '') + padStart_(String(a.id), 10, '0');
      var kb = String(b.created_at || '') + padStart_(String(b.id), 10, '0');
      return ka < kb ? 1 : -1;
    });

    var total = rows.length;
    var slice = rows.slice((page - 1) * perPage, page * perPage);

    return {
      payments: slice.map(function (p) { return paymentView_(p, ctx); }),
      total: total, page: page, per_page: perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      counts: paymentCounts_()
    };
  });
}

function apiPayment(payload) {
  return apiCall_('payment', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var pid = id_(payload.id);
    var p = dbGet('Payments', pid);
    if (!p) fail_('ไม่พบรายการแจ้งชำระนี้');

    var ctx = paymentContext_();
    var view = paymentView_(p, ctx);
    var assignment = assignmentView_(p.assignment_id);

    var history = paymentsOf_(p.assignment_id).map(function (x) {
      return {
        id: x.id, ref_code: x.ref_code, amount: Number(x.amount) || 0, status: x.status,
        status_label: PAYMENT_STATUS_LABEL[x.status] || x.status,
        created_at: iso_(x.created_at), verified_at: iso_(x.verified_at)
      };
    });

    // ตรวจหาสลิปที่ซ้ำกับรายการอื่น
    var duplicates = [];
    if (p.slip_hash) {
      var dups = dbWhere('Payments', function (x) {
        return x.slip_hash === p.slip_hash && x.id !== pid && x.status !== 'cancelled';
      });
      duplicates = dups.map(function (d) {
        var da = ctx.assignments[d.assignment_id];
        var dm = da ? ctx.members[da.member_id] : null;
        return {
          id: d.id, ref_code: d.ref_code, status: d.status,
          created_at: iso_(d.created_at), member_code: dm ? dm.member_code : '-'
        };
      });
    }

    return {
      payment: view,
      assignment: assignment,
      items: assignmentItems_(p.assignment_id),
      history: history,
      duplicates: duplicates
    };
  });
}

/** ดูไฟล์สลิป (ผู้ดูแลเท่านั้น) */
function apiPaymentSlip(payload) {
  return apiCall_('paymentSlip', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var p = dbGet('Payments', id_(payload.id));
    if (!p || !p.slip_file_id) fail_('ไม่พบไฟล์สลิป');
    var file = readSlipDataUrl_(p.slip_file_id);
    if (!file) fail_('ไม่พบไฟล์สลิปในระบบ (อาจถูกลบออกจาก Google Drive)');
    return { data_url: file.data_url, mime: file.mime, name: file.name, size: file.size, ref_code: p.ref_code };
  });
}

/* -------------------------------- อนุมัติ -------------------------------- */

function apiApprovePayment(payload) {
  return apiCall_('approvePayment', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var pid = id_(payload.id);

    return withLock_(function () {
      var p = dbGet('Payments', pid);
      if (!p) fail_('ไม่พบรายการแจ้งชำระนี้');
      if (p.status === 'approved') fail_('รายการนี้ได้รับการอนุมัติไปแล้ว');
      if (p.status === 'cancelled') fail_('รายการนี้ถูกยกเลิกแล้ว');

      var amount = payload.amount === undefined ? Number(p.amount) : money_(payload.amount, Number(p.amount));
      if (amount <= 0) fail_('จำนวนเงินต้องมากกว่า 0');

      var a = assignmentView_(p.assignment_id);
      if (!a) fail_('ไม่พบรายการที่ต้องชำระ');
      if (a.paid_amount + amount > a.net_due + 0.005) {
        fail_('ยอดรวมหลังอนุมัติ (' + moneyStr_(a.paid_amount + amount) + ' บาท) เกินยอดที่ต้องชำระ (' + moneyStr_(a.net_due) + ' บาท)');
      }

      var receiptNo = p.receipt_no || nextReceiptNo_();
      dbUpdate('Payments', pid, {
        status: 'approved', amount: amount, verified_by: admin.id, verified_at: new Date(),
        reject_reason: '', receipt_no: receiptNo,
        note: payload.note ? str_(payload.note, 500) : p.note
      });

      var after = assignmentView_(p.assignment_id);
      audit_(admin, 'อนุมัติการชำระเงิน', {
        targetType: 'payment', targetId: pid,
        detail: 'เลขอ้างอิง ' + p.ref_code + ' ยอด ' + moneyStr_(amount) + ' บาท (' + a.member_code + ' ' + a.full_name + ') ใบเสร็จ ' + receiptNo
      });

      return {
        status: 'approved', receipt_no: receiptNo,
        assignment_status: after.status, assignment_status_label: after.status_label,
        message: 'อนุมัติเรียบร้อย สถานะของ ' + a.full_name + ' เปลี่ยนเป็น "' + after.status_label + '"'
      };
    });
  });
}

function apiRejectPayment(payload) {
  return apiCall_('rejectPayment', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var pid = id_(payload.id);
    var reason = str_(payload.reason, 500);
    if (!reason) fail_('กรุณาระบุเหตุผลที่ไม่อนุมัติ เพื่อให้สมาชิกทราบและแจ้งใหม่ได้ถูกต้อง');

    return withLock_(function () {
      var p = dbGet('Payments', pid);
      if (!p) fail_('ไม่พบรายการแจ้งชำระนี้');
      if (p.status === 'cancelled') fail_('รายการนี้ถูกยกเลิกแล้ว');

      dbUpdate('Payments', pid, {
        status: 'rejected', reject_reason: reason,
        verified_by: admin.id, verified_at: new Date(), receipt_no: ''
      });

      var a = assignmentView_(p.assignment_id);
      audit_(admin, 'ไม่อนุมัติการชำระเงิน', {
        targetType: 'payment', targetId: pid, detail: 'เลขอ้างอิง ' + p.ref_code + ': ' + reason
      });
      return {
        status: 'rejected',
        assignment_status: a ? a.status : null,
        assignment_status_label: a ? a.status_label : null
      };
    });
  });
}

function apiRevertPayment(payload) {
  return apiCall_('revertPayment', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var pid = id_(payload.id);

    return withLock_(function () {
      var p = dbGet('Payments', pid);
      if (!p) fail_('ไม่พบรายการแจ้งชำระนี้');
      if (p.status === 'pending') fail_('รายการนี้อยู่ในสถานะรอตรวจสอบอยู่แล้ว');

      dbUpdate('Payments', pid, {
        status: 'pending', verified_by: '', verified_at: '', reject_reason: '', receipt_no: ''
      });
      audit_(admin, 'คืนสถานะการชำระเงินเป็นรอตรวจสอบ', {
        targetType: 'payment', targetId: pid, detail: 'เลขอ้างอิง ' + p.ref_code
      });
      return { status: 'pending' };
    });
  });
}

function apiCancelPayment(payload) {
  return apiCall_('cancelPayment', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var pid = id_(payload.id);

    return withLock_(function () {
      var p = dbGet('Payments', pid);
      if (!p) fail_('ไม่พบรายการแจ้งชำระนี้');
      dbUpdate('Payments', pid, {
        status: 'cancelled',
        reject_reason: str_(payload.reason, 500) || 'ยกเลิกโดยผู้ดูแลระบบ',
        verified_by: admin.id, verified_at: new Date(), receipt_no: ''
      });
      audit_(admin, 'ยกเลิกรายการแจ้งชำระ', {
        targetType: 'payment', targetId: pid, detail: 'เลขอ้างอิง ' + p.ref_code
      });
      return { status: 'cancelled' };
    });
  });
}

/** อนุมัติหลายรายการพร้อมกัน */
function apiBulkApprove(payload) {
  return apiCall_('bulkApprove', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var ids = (payload.ids || []).map(id_).filter(Boolean);
    if (!ids.length) fail_('กรุณาเลือกรายการอย่างน้อย 1 รายการ');
    if (ids.length > 200) fail_('อนุมัติได้ครั้งละไม่เกิน 200 รายการ');

    return withLock_(function () {
      var result = { approved: 0, failed: [] };
      var patches = [];
      var running = {};   // ยอดที่กำลังจะอนุมัติในรอบนี้ แยกตาม assignment

      for (var i = 0; i < ids.length; i++) {
        var p = dbGet('Payments', ids[i]);
        if (!p) { result.failed.push({ id: ids[i], reason: 'ไม่พบรายการ' }); continue; }
        if (p.status === 'approved') { result.failed.push({ id: ids[i], ref_code: p.ref_code, reason: 'อนุมัติไปแล้ว' }); continue; }
        if (p.status === 'cancelled') { result.failed.push({ id: ids[i], ref_code: p.ref_code, reason: 'ถูกยกเลิกแล้ว' }); continue; }

        var a = assignmentView_(p.assignment_id);
        if (!a) { result.failed.push({ id: ids[i], ref_code: p.ref_code, reason: 'ไม่พบรายการที่ต้องชำระ' }); continue; }

        var already = a.paid_amount + (running[p.assignment_id] || 0);
        if (already + Number(p.amount) > a.net_due + 0.005) {
          result.failed.push({ id: ids[i], ref_code: p.ref_code, reason: 'ยอดรวมเกินยอดที่ต้องชำระ' });
          continue;
        }
        running[p.assignment_id] = (running[p.assignment_id] || 0) + Number(p.amount);

        patches.push({
          id: p.id,
          patch: {
            status: 'approved', verified_by: admin.id, verified_at: new Date(),
            reject_reason: '', receipt_no: p.receipt_no || nextReceiptNo_()
          }
        });
        result.approved++;
      }

      if (patches.length) dbUpdateMany('Payments', patches);
      audit_(admin, 'อนุมัติการชำระเงินหลายรายการ', {
        detail: 'อนุมัติ ' + result.approved + ' รายการ, ไม่สำเร็จ ' + result.failed.length + ' รายการ'
      });
      return result;
    });
  });
}

/* ------------------- บันทึกการชำระด้วยเงินสด (โดยผู้ดูแล) ------------------- */

function apiManualPayment(payload) {
  return apiCall_('manualPayment', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var aid = id_(payload.assignment_id);
    if (!aid) fail_('กรุณาระบุรายการที่ต้องชำระ');

    return withLock_(function () {
      var a = assignmentView_(aid);
      if (!a) fail_('ไม่พบรายการที่ต้องชำระ');
      if (a.waived) fail_('รายการนี้ได้รับการยกเว้นการชำระ');
      if (a.outstanding <= 0) fail_('รายการนี้ชำระครบแล้ว');

      var amount = money_(payload.amount, a.outstanding) || a.outstanding;
      if (amount > a.outstanding + 0.005) {
        fail_('จำนวนเงินเกินยอดคงเหลือ (' + moneyStr_(a.outstanding) + ' บาท)');
      }

      var method = ['cash', 'transfer', 'other'].indexOf(str_(payload.method, 20)) >= 0 ? str_(payload.method, 20) : 'cash';
      var refCode = generateRefCode_();
      var receiptNo = nextReceiptNo_();
      var now = new Date();

      var created = dbInsert('Payments', {
        ref_code: refCode, assignment_id: aid, amount: amount, method: method,
        payer_name: str_(payload.payer_name, 120) || a.full_name,
        transferred_at: dateTime_(payload.transferred_at) || now,
        slip_file_id: '', slip_mime: '', slip_size: 0, slip_hash: '',
        note: str_(payload.note, 500) || 'บันทึกโดยผู้ดูแลระบบ',
        status: 'approved', reject_reason: '',
        verified_by: admin.id, verified_at: now, receipt_no: receiptNo
      });

      var after = assignmentView_(aid);
      audit_(admin, 'บันทึกการชำระเงินโดยผู้ดูแล', {
        targetType: 'payment', targetId: created.id,
        detail: a.member_code + ' ' + a.full_name + ' ยอด ' + moneyStr_(amount) + ' บาท (' +
          (method === 'cash' ? 'เงินสด' : method === 'transfer' ? 'โอนเงิน' : 'อื่น ๆ') + ')'
      });

      return {
        id: created.id, ref_code: refCode, receipt_no: receiptNo,
        assignment_status: after.status, assignment_status_label: after.status_label
      };
    });
  });
}

/* -------------------------------- ใบเสร็จรับเงิน -------------------------------- */

function apiReceipt(payload) {
  return apiCall_('receipt', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var p = dbGet('Payments', id_(payload.id));
    if (!p) fail_('ไม่พบรายการแจ้งชำระนี้');
    if (p.status !== 'approved') fail_('ออกใบเสร็จได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น');

    var ctx = paymentContext_();
    var view = paymentView_(p, ctx);
    var s = settingsAll();

    return {
      receipt: {
        receipt_no: p.receipt_no,
        ref_code: p.ref_code,
        amount: Number(p.amount) || 0,
        amount_text: bahtText_(Number(p.amount) || 0),
        method: p.method,
        method_label: view.method_label,
        payer_name: p.payer_name,
        paid_at: iso_(p.verified_at),
        transferred_at: iso_(p.transferred_at),
        member: { member_code: view.member_code, full_name: view.full_name, group_name: view.group_name },
        collection: { code: view.collection_code, name: view.collection_name },
        items: assignmentItems_(p.assignment_id),
        verified_by_name: view.verified_by_name,
        school: {
          name: s.school_name, address: s.school_address,
          phone: s.school_phone, logo: s.school_logo
        }
      }
    };
  });
}
