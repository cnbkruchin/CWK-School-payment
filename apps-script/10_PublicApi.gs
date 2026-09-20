/**
 * ===========================================================================
 *  API สำหรับหน้าสาธารณะ (นักเรียน ผู้ปกครอง บุคลากร)
 *  ทุกฟังก์ชันในไฟล์นี้เรียกได้โดยไม่ต้องเข้าสู่ระบบ
 * ===========================================================================
 */

function publicConfig_() {
  var s = settingsAll();
  return {
    school_name: s.school_name,
    school_short: s.school_short,
    school_address: s.school_address,
    school_phone: s.school_phone,
    school_logo: s.school_logo,
    system_title: s.system_title,
    contact_note: s.contact_note,
    require_member_pin: s.require_member_pin === '1',
    allow_public_member_list: s.allow_public_member_list === '1',
    max_upload_mb: Math.min(Number(s.max_upload_mb) || 5, APP.MAX_SLIP_BYTES / 1024 / 1024),
    theme_color: s.theme_color,
    app_version: APP.VERSION,
    admin_url: adminUrl_()
  };
}

/** ลิงก์เข้าระบบผู้ดูแล (ว่างเมื่อยังไม่ได้เผยแพร่เว็บแอป) */
function adminUrl_() {
  var base = webAppUrl_();
  return base ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'page=admin' : '';
}

function apiPublicConfig() {
  return apiCall_('publicConfig', function () { return publicConfig_(); });
}

/** ชื่อที่แสดงบนหน้าสาธารณะ (ปิดบังนามสกุลได้ตามการตั้งค่า) */
function publicName_(row) {
  if (!settingBool('mask_member_name')) return row.full_name;
  return String((row.prefix || '') + row.first_name + ' ' + maskName_(row.last_name)).trim();
}

/* ----------------------- รายการจัดเก็บที่เปิดรับชำระ ----------------------- */

function apiPublicCollections() {
  return apiCall_('publicCollections', function () {
    var rows = dbWhere('Collections', function (c) {
      return c.is_public && (c.status === 'open' || c.status === 'closed');
    });

    var out = rows.map(function (c) {
      return {
        id: c.id, code: c.code, name: c.name, description: c.description,
        fiscal_year: c.fiscal_year, term: c.term, due_date: c.due_date,
        status: c.status, allow_partial: !!c.allow_partial, created_at: c.created_at,
        summary: summarize_(boardOf_(c.id))
      };
    });

    out.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      var da = a.due_date || '9999';
      var db2 = b.due_date || '9999';
      if (da !== db2) return da < db2 ? -1 : 1;
      return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1;
    });
    return { collections: out };
  });
}

/* ------------------- ตารางรายชื่อผู้ต้องชำระของรายการหนึ่ง ------------------- */

function apiPublicCollection(payload) {
  return apiCall_('publicCollection', function () {
    payload = payload || {};
    var cid = id_(payload.id);
    if (!cid) fail_('รหัสรายการไม่ถูกต้อง');

    var c = dbGet('Collections', cid);
    if (!c || !c.is_public || c.status === 'draft') {
      fail_('ไม่พบรายการจัดเก็บนี้ หรือยังไม่เปิดให้แจ้งชำระ');
    }

    var items = (dbGroupBy('CollectionItems', 'collection_id')[cid] || []).slice();
    items.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    var banks = dbWhere('BankAccounts', function (b) { return b.is_active; });
    banks.sort(function (a, b) {
      if (!!a.is_default !== !!b.is_default) return a.is_default ? -1 : 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    var board = boardOf_(cid);
    var showList = settingBool('allow_public_member_list');

    // รายชื่อกลุ่มที่มีอยู่จริงในรายการนี้ (สำหรับตัวกรอง)
    var groupSeen = {};
    var groups = [];
    for (var i = 0; i < board.length; i++) {
      if (board[i].group_id && !groupSeen[board[i].group_id]) {
        groupSeen[board[i].group_id] = true;
        groups.push({ id: board[i].group_id, name: board[i].group_name });
      }
    }
    groups.sort(function (a, b) { return String(a.name) < String(b.name) ? -1 : 1; });

    return {
      collection: {
        id: c.id, code: c.code, name: c.name, description: c.description,
        fiscal_year: c.fiscal_year, term: c.term, due_date: c.due_date,
        status: c.status, allow_partial: !!c.allow_partial,
        default_amount: Number(c.default_amount) || 0
      },
      items: items.map(function (it) {
        return { id: it.id, name: it.name, description: it.description, amount: Number(it.amount) || 0, is_optional: !!it.is_optional };
      }),
      banks: banks.map(function (b) {
        return {
          id: b.id, bank_name: b.bank_name, account_name: b.account_name,
          account_number: b.account_number, branch: b.branch, note: b.note,
          is_default: !!b.is_default, has_promptpay: !!b.promptpay_id
        };
      }),
      groups: groups,
      summary: summarize_(board),
      list_hidden: !showList,
      members: showList ? board.map(function (r) {
        return {
          assignment_id: r.assignment_id,
          member_id: r.member_id,
          member_code: r.member_code,
          name: publicName_(r),
          group_name: r.group_name,
          amount_due: r.net_due,
          paid_amount: r.paid_amount,
          outstanding: r.outstanding,
          status: r.status,
          status_label: r.status_label,
          latest_ref: r.status === 'unpaid' ? null : r.latest_ref,
          latest_submitted_at: r.latest_submitted_at,
          last_verified_at: r.last_verified_at,
          last_reject_reason: r.status === 'rejected' ? r.last_reject_reason : null,
          payment_count: r.payment_count
        };
      }) : []
    };
  });
}

/* -------------------- ข้อมูลสำหรับฟอร์มแจ้งชำระรายบุคคล -------------------- */

function apiPublicAssignment(payload) {
  return apiCall_('publicAssignment', function () {
    payload = payload || {};
    var aid = id_(payload.assignment_id);
    if (!aid) fail_('รหัสรายการไม่ถูกต้อง');

    var a = assignmentView_(aid);
    if (!a) fail_('ไม่พบรายการที่ต้องชำระ');
    if (!a.is_public || a.collection_status === 'draft') fail_('รายการนี้ยังไม่เปิดให้แจ้งชำระ');

    var payments = paymentsOf_(aid).map(function (p) {
      return {
        ref_code: p.ref_code, amount: Number(p.amount) || 0, status: p.status,
        status_label: PAYMENT_STATUS_LABEL[p.status] || p.status,
        transferred_at: iso_(p.transferred_at), created_at: iso_(p.created_at),
        verified_at: iso_(p.verified_at), reject_reason: p.reject_reason,
        receipt_no: p.receipt_no, has_slip: !!p.slip_file_id
      };
    });

    // ไม่ส่งข้อมูลที่ไม่ควรเปิดเผย
    var safe = {};
    for (var k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      if (k === 'prefix' || k === 'first_name' || k === 'last_name') continue;
      safe[k] = a[k];
    }
    safe.name = publicName_(a);
    safe.full_name = publicName_(a);

    return {
      assignment: safe,
      items: assignmentItems_(aid),
      payments: payments,
      require_pin: settingBool('require_member_pin'),
      can_submit: a.collection_status === 'open' && !a.waived && a.outstanding > 0
    };
  });
}

/* -------------------------- QR พร้อมเพย์ตามยอดที่ต้องชำระ -------------------------- */

function apiPromptPay(payload) {
  return apiCall_('promptPay', function () {
    payload = payload || {};
    var bankId = id_(payload.bank_id);
    var amount = money_(payload.amount, 0);

    var bank = bankId ? dbGet('BankAccounts', bankId) : null;
    if (!bank || !bank.is_active) {
      bank = dbFind('BankAccounts', function (b) { return b.is_active && b.promptpay_id; });
    }
    if (!bank || !bank.promptpay_id) fail_('ยังไม่ได้ตั้งค่าพร้อมเพย์สำหรับบัญชีนี้');

    var qr = promptPayQr_(bank.promptpay_id, amount);
    if (!qr) fail_('เลขพร้อมเพย์ไม่ถูกต้อง');

    return {
      payload: qr.payload,
      amount: amount,
      bank: {
        id: bank.id, bank_name: bank.bank_name, account_name: bank.account_name,
        account_number: bank.account_number, promptpay_id: bank.promptpay_id
      }
    };
  });
}

/* ---------------------------- แจ้งชำระเงิน (แนบสลิป) ---------------------------- */

function apiSubmitPayment(payload) {
  return apiCall_('submitPayment', function () {
    payload = payload || {};
    var aid = id_(payload.assignment_id);
    if (!aid) fail_('ไม่พบรายการที่ต้องการแจ้งชำระ');
    if (!payload.slip_base64) fail_('กรุณาแนบสลิปการโอนเงิน');

    if (!rateLimit_('submit:' + aid, 12, 3600)) {
      fail_('แจ้งชำระเงินบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    }

    // ตรวจสอบข้อมูลก่อนเข้าล็อก เพื่อให้ล็อกถูกจับสั้นที่สุด
    var pre = assignmentView_(aid);
    if (!pre) fail_('ไม่พบรายการที่ต้องชำระ');
    if (pre.collection_status !== 'open') fail_('รายการจัดเก็บนี้ปิดรับการแจ้งชำระแล้ว');
    if (pre.waived) fail_('รายการนี้ได้รับการยกเว้นการชำระ ไม่ต้องแจ้งชำระเงิน');

    // ตรวจรหัสสมาชิก (ใช้เวลาประมวลผลพอสมควร จึงทำก่อนเข้าล็อก)
    if (settingBool('require_member_pin')) {
      var pin = str_(payload.pin, 20);
      if (!pin) fail_('กรุณากรอกรหัสสมาชิกเพื่อยืนยันตัวตน');
      var member = dbGet('Members', pre.member_id);
      if (!member || !verifyPin_(pin, member.pin_salt, member.pin_hash)) {
        audit_(null, 'แจ้งชำระเงิน: รหัสสมาชิกไม่ถูกต้อง', {
          actorType: 'member', actorId: pre.member_id, actorName: pre.full_name,
          targetType: 'assignment', targetId: aid
        });
        fail_('รหัสสมาชิกไม่ถูกต้อง หากลืมรหัสกรุณาติดต่อผู้ดูแลระบบเพื่อขอรหัสใหม่');
      }
    }

    // บันทึกไฟล์ก่อนเข้าล็อก (ขั้นตอนนี้ช้าที่สุด)
    var saved = saveSlip_(payload.slip_base64, payload.slip_name, null);

    try {
      return withLock_(function () {
        // อ่านข้อมูลใหม่หลังได้ล็อก เผื่อมีผู้อื่นแก้ไขระหว่างนั้น
        var a = assignmentView_(aid);
        if (!a) fail_('ไม่พบรายการที่ต้องชำระ');
        if (a.collection_status !== 'open') fail_('รายการจัดเก็บนี้ปิดรับการแจ้งชำระแล้ว');
        if (a.outstanding <= 0) fail_('รายการนี้ชำระครบแล้ว');
        if (a.pending_count > 0) fail_('มีรายการที่รอการตรวจสอบอยู่แล้ว กรุณารอผู้ดูแลตรวจสอบก่อน');

        // ตรวจจับสลิปซ้ำ
        if (settingBool('detect_duplicate_slip')) {
          var dup = dbFind('Payments', function (p) {
            return p.slip_hash === saved.hash && p.status !== 'cancelled';
          });
          if (dup) {
            fail_('สลิปนี้เคยถูกใช้แจ้งชำระแล้ว (เลขอ้างอิง ' + dup.ref_code + ') กรุณาแนบสลิปที่ถูกต้อง');
          }
        }

        var amountRaw = money_(payload.amount, a.outstanding);
        var amount = amountRaw > 0 ? amountRaw : a.outstanding;
        if (!a.allow_partial && amount + 0.005 < a.outstanding) {
          fail_('รายการนี้ต้องชำระเต็มจำนวน ' + moneyStr_(a.outstanding) + ' บาท');
        }
        if (amount > a.outstanding + 0.005) {
          fail_('จำนวนเงินเกินยอดที่ต้องชำระ (' + moneyStr_(a.outstanding) + ' บาท)');
        }

        var autoApprove = settingBool('auto_approve');
        var refCode = generateRefCode_();
        var now = new Date();

        var record = dbInsert('Payments', {
          ref_code: refCode,
          assignment_id: aid,
          amount: amount,
          method: 'transfer',
          payer_name: str_(payload.payer_name, 120) || a.full_name,
          transferred_at: dateTime_(payload.transferred_at) || now,
          bank_account_id: id_(payload.bank_account_id),
          slip_file_id: saved.fileId,
          slip_mime: saved.mime,
          slip_size: saved.size,
          slip_hash: saved.hash,
          note: str_(payload.note, 500),
          status: autoApprove ? 'approved' : 'pending',
          reject_reason: '',
          verified_by: autoApprove ? null : '',
          verified_at: autoApprove ? now : '',
          receipt_no: autoApprove ? nextReceiptNo_() : ''
        });

        audit_(null, 'แจ้งชำระเงิน', {
          actorType: 'member', actorId: a.member_id, actorName: a.full_name,
          targetType: 'payment', targetId: record.id,
          detail: 'เลขอ้างอิง ' + refCode + ' ยอด ' + moneyStr_(amount) + ' บาท (' + a.collection_name + ')'
        });

        return {
          ref_code: refCode,
          amount: amount,
          status: autoApprove ? 'approved' : 'pending',
          status_label: autoApprove ? 'ชำระแล้ว' : 'รอตรวจสอบ',
          member_name: publicName_(a),
          member_code: a.member_code,
          collection_name: a.collection_name,
          submitted_at: now.toISOString(),
          message: autoApprove
            ? 'บันทึกการชำระเงินเรียบร้อยแล้ว'
            : 'แจ้งชำระเงินเรียบร้อยแล้ว กรุณาเก็บเลขอ้างอิงไว้เพื่อตรวจสอบสถานะและดูสลิปภายหลัง'
        };
      });
    } catch (err) {
      deleteSlip_(saved.fileId);   // บันทึกไม่สำเร็จ — ลบไฟล์ที่อัปโหลดไว้ทิ้ง
      throw err;
    }
  });
}

/* ------------------------ ตรวจสอบสถานะด้วยเลขอ้างอิง ------------------------ */

function apiLookupPayment(payload) {
  return apiCall_('lookupPayment', function () {
    payload = payload || {};
    var ref = str_(payload.ref, 12).replace(/\D/g, '');
    if (!ref || ref.length < 4) fail_('กรุณากรอกเลขอ้างอิงให้ถูกต้อง');

    if (!rateLimit_('lookup:' + ref, 25, 600)) {
      fail_('ค้นหาบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    }

    var p = dbFind('Payments', function (x) { return x.ref_code === ref && x.status !== 'cancelled'; });
    if (!p) fail_('ไม่พบเลขอ้างอิงนี้ในระบบ กรุณาตรวจสอบอีกครั้ง');

    var a = dbGet('Assignments', p.assignment_id);
    var m = a ? dbGet('Members', a.member_id) : null;
    var g = m ? dbGet('Groups', m.group_id) : null;
    var c = a ? dbGet('Collections', a.collection_id) : null;
    var verifier = p.verified_by ? dbGet('Admins', p.verified_by) : null;

    var fullName = m ? String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim() : '-';
    var shownName = settingBool('mask_member_name') && m
      ? String((m.prefix || '') + m.first_name + ' ' + maskName_(m.last_name)).trim()
      : fullName;

    return {
      ref_code: p.ref_code,
      status: p.status,
      status_label: PAYMENT_STATUS_LABEL[p.status] || p.status,
      amount: Number(p.amount) || 0,
      payer_name: p.payer_name,
      transferred_at: iso_(p.transferred_at),
      submitted_at: iso_(p.created_at),
      verified_at: iso_(p.verified_at),
      verified_by_name: verifier ? verifier.full_name : null,
      reject_reason: p.reject_reason || null,
      receipt_no: p.receipt_no || null,
      note: p.note || null,
      has_slip: !!p.slip_file_id,
      slip_mime: p.slip_mime,
      member: { member_code: m ? m.member_code : '-', name: shownName, group_name: g ? g.name : null },
      collection: c ? { id: c.id, code: c.code, name: c.name } : null
    };
  });
}

/** ดูสลิปด้วยเลขอ้างอิง (ต้องรู้เลข 4 หลักจึงจะเปิดดูได้) */
function apiLookupSlip(payload) {
  return apiCall_('lookupSlip', function () {
    payload = payload || {};
    var ref = str_(payload.ref, 12).replace(/\D/g, '');
    if (!ref || ref.length < 4) fail_('เลขอ้างอิงไม่ถูกต้อง');

    if (!rateLimit_('slip:' + ref, 25, 600)) {
      fail_('เรียกดูบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    }

    var p = dbFind('Payments', function (x) { return x.ref_code === ref && x.status !== 'cancelled'; });
    if (!p || !p.slip_file_id) fail_('ไม่พบสลิปของเลขอ้างอิงนี้');

    var file = readSlipDataUrl_(p.slip_file_id);
    if (!file) fail_('ไม่พบไฟล์สลิปในระบบ');
    return { ref_code: ref, data_url: file.data_url, mime: file.mime, size: file.size };
  });
}

/* ----------------------- ประวัติการชำระของสมาชิก ----------------------- */

function apiMemberHistory(payload) {
  return apiCall_('memberHistory', function () {
    payload = payload || {};
    var code = str_(payload.member_code, 40);
    var pin = str_(payload.pin, 20);
    if (!code) fail_('กรุณากรอกรหัสสมาชิก');

    if (!rateLimit_('history:' + code.toLowerCase(), 20, 600)) {
      fail_('ค้นหาบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    }

    var m = dbFind('Members', function (x) {
      return String(x.member_code).toLowerCase() === code.toLowerCase() && x.is_active;
    });
    var needPin = settingBool('require_member_pin');
    if (!m || (needPin && (!pin || !verifyPin_(pin, m.pin_salt, m.pin_hash)))) {
      fail_('รหัสสมาชิกหรือรหัสยืนยันไม่ถูกต้อง');
    }

    var ledger = memberLedger_(m.id);
    var g = dbGet('Groups', m.group_id);

    return {
      member: {
        member_code: m.member_code,
        name: String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim(),
        group_name: g ? g.name : null
      },
      totals: summarize_(ledger),
      items: ledger.map(function (r) {
        return {
          assignment_id: r.assignment_id,
          collection_id: r.collection_id,
          collection_code: r.collection_code,
          collection_name: r.collection_name,
          due_date: r.due_date,
          amount_due: r.net_due,
          paid_amount: r.paid_amount,
          outstanding: r.outstanding,
          status: r.status,
          status_label: r.status_label,
          latest_ref: r.latest_ref,
          last_verified_at: r.last_verified_at
        };
      })
    };
  });
}
