/**
 * ===========================================================================
 *  ตรรกะการคำนวณสถานะการชำระเงิน
 *
 *  จุดที่ต้องระวังเรื่องความเร็ว: การรวมข้อมูล 3 ตาราง (ผู้ต้องชำระ + สมาชิก +
 *  การชำระเงิน) หากวนลูปซ้อนกันจะช้ามาก จึงใช้ dbGroupBy สร้างดัชนีไว้ก่อน
 *  ทำให้การรวมข้อมูลเป็น O(n) แทนที่จะเป็น O(n²)
 * ===========================================================================
 */

/**
 * สรุปยอดการชำระของแต่ละ assignment ในครั้งเดียว
 * @return {Object} map: assignment_id -> { paid, pending, pendingCount, rejectedCount, ... }
 */
function paymentSummaryMap_() {
  var version = versionOf_('Payments');
  return memoGet_('paysum:' + version, function () {
    var map = {};
    var rows = dbAll('Payments');
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      if (p.status === 'cancelled') continue;
      var aid = p.assignment_id;
      if (!map[aid]) {
        map[aid] = {
          paid: 0, pending: 0, pendingCount: 0, rejectedCount: 0, count: 0,
          latestRef: null, latestStatus: null, latestAt: null,
          lastVerifiedAt: null, lastRejectReason: null, latestId: null
        };
      }
      var m = map[aid];
      m.count++;
      if (p.status === 'approved') {
        m.paid += Number(p.amount) || 0;
        if (!m.lastVerifiedAt || (p.verified_at && p.verified_at > m.lastVerifiedAt)) {
          m.lastVerifiedAt = p.verified_at;
        }
      } else if (p.status === 'pending') {
        m.pending += Number(p.amount) || 0;
        m.pendingCount++;
      } else if (p.status === 'rejected') {
        m.rejectedCount++;
      }
      // รายการล่าสุด (เรียงตามเวลาที่แจ้ง แล้วจึงตาม id)
      var key = (p.created_at || '') + '|' + padStart_(String(p.id), 10, '0');
      if (!m.latestAt || key > m.latestAt) {
        m.latestAt = key;
        m.latestRef = p.ref_code;
        m.latestStatus = p.status;
        m.latestId = p.id;
        m.latestCreatedAt = p.created_at;
      }
      if (p.status === 'rejected') {
        var rkey = (p.created_at || '') + '|' + padStart_(String(p.id), 10, '0');
        if (!m.lastRejectKey || rkey > m.lastRejectKey) {
          m.lastRejectKey = rkey;
          m.lastRejectReason = p.reject_reason;
        }
      }
    }
    return map;
  });
}

var EMPTY_SUMMARY = {
  paid: 0, pending: 0, pendingCount: 0, rejectedCount: 0, count: 0,
  latestRef: null, latestStatus: null, latestCreatedAt: null,
  lastVerifiedAt: null, lastRejectReason: null, latestId: null
};

/** ตัดสินสถานะจากยอดเงิน */
function decideStatus_(netDue, paid, pendingCount, rejectedCount, waived) {
  if (waived) return 'waived';
  if (netDue <= 0 || paid >= netDue - 0.005) return 'paid';
  if (paid > 0) return pendingCount > 0 ? 'pending' : 'partial';
  if (pendingCount > 0) return 'pending';
  if (rejectedCount > 0) return 'rejected';
  return 'unpaid';
}

/** เติมข้อมูลสถานะให้ assignment หนึ่งรายการ */
function decorate_(assignment, member, group, summary) {
  var s = summary || EMPTY_SUMMARY;
  var net = Math.max(0, (Number(assignment.amount_due) || 0) - (Number(assignment.discount) || 0));
  var paid = Math.round(s.paid * 100) / 100;
  var status = decideStatus_(net, paid, s.pendingCount, s.rejectedCount, assignment.waived);

  return {
    assignment_id: assignment.id,
    collection_id: assignment.collection_id,
    member_id: assignment.member_id,
    member_code: member ? member.member_code : '',
    prefix: member ? member.prefix : '',
    first_name: member ? member.first_name : '',
    last_name: member ? member.last_name : '',
    full_name: member ? String((member.prefix || '') + member.first_name + ' ' + member.last_name).trim() : '(ไม่พบสมาชิก)',
    group_id: member ? member.group_id : null,
    group_name: group ? group.name : null,
    member_active: member ? !!member.is_active : false,
    amount_due: Number(assignment.amount_due) || 0,
    discount: Number(assignment.discount) || 0,
    net_due: net,
    paid_amount: paid,
    pending_amount: Math.round(s.pending * 100) / 100,
    outstanding: status === 'waived' ? 0 : Math.round(Math.max(0, net - paid) * 100) / 100,
    waived: !!assignment.waived,
    note: assignment.note || '',
    status: status,
    status_label: STATUS_LABEL[status],
    payment_count: s.count,
    pending_count: s.pendingCount,
    rejected_count: s.rejectedCount,
    latest_ref: s.latestRef,
    latest_payment_status: s.latestStatus,
    latest_submitted_at: iso_(s.latestCreatedAt),
    last_verified_at: iso_(s.lastVerifiedAt),
    last_reject_reason: s.lastRejectReason || null
  };
}

/** รายชื่อผู้ต้องชำระของรายการจัดเก็บหนึ่ง ๆ พร้อมสถานะ */
function boardOf_(collectionId) {
  var version = versionOf_('Assignments') + '.' + versionOf_('Payments') + '.' +
                versionOf_('Members') + '.' + versionOf_('Groups');
  return memoGet_('board:' + collectionId + ':' + version, function () {
    var byCollection = dbGroupBy('Assignments', 'collection_id');
    var assignments = byCollection[collectionId] || [];
    var members = loadTable_('Members').index;
    var groups = loadTable_('Groups').index;
    var sums = paymentSummaryMap_();

    var out = [];
    for (var i = 0; i < assignments.length; i++) {
      var a = assignments[i];
      var m = members[a.member_id];
      var g = m ? groups[m.group_id] : null;
      out.push(decorate_(a, m, g, sums[a.id]));
    }

    out.sort(function (x, y) {
      var gx = x.group_name || '￿';
      var gy = y.group_name || '￿';
      if (gx !== gy) return gx < gy ? -1 : 1;
      return String(x.member_code) < String(y.member_code) ? -1 : 1;
    });
    return out;
  });
}

/** กรองรายชื่อตามเงื่อนไขค้นหา */
function filterBoard_(rows, opts) {
  opts = opts || {};
  var out = rows;
  if (opts.groupId) {
    var gid = Number(opts.groupId);
    out = out.filter(function (r) { return Number(r.group_id) === gid; });
  }
  if (opts.status) {
    out = out.filter(function (r) { return r.status === opts.status; });
  }
  if (opts.q) {
    var q = String(opts.q).trim().toLowerCase();
    out = out.filter(function (r) {
      return r.full_name.toLowerCase().indexOf(q) >= 0 ||
        String(r.member_code).toLowerCase().indexOf(q) >= 0 ||
        String(r.group_name || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  return out;
}

/** สรุปยอดรวมของรายการ */
function summarize_(rows) {
  var s = {
    total_members: rows.length, total_due: 0, total_paid: 0, total_pending: 0, total_outstanding: 0,
    count_paid: 0, count_pending: 0, count_unpaid: 0, count_partial: 0, count_waived: 0, count_rejected: 0
  };
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    s.total_due += r.waived ? 0 : r.net_due;
    s.total_paid += r.paid_amount;
    s.total_pending += r.pending_amount;
    s.total_outstanding += r.outstanding;
    if (r.status === 'paid') s.count_paid++;
    else if (r.status === 'pending') s.count_pending++;
    else if (r.status === 'partial') s.count_partial++;
    else if (r.status === 'waived') s.count_waived++;
    else if (r.status === 'rejected') s.count_rejected++;
    else s.count_unpaid++;
  }
  s.total_due = Math.round(s.total_due * 100) / 100;
  s.total_paid = Math.round(s.total_paid * 100) / 100;
  s.total_pending = Math.round(s.total_pending * 100) / 100;
  s.total_outstanding = Math.round(s.total_outstanding * 100) / 100;
  s.percent_paid = s.total_due > 0 ? Math.round((s.total_paid / s.total_due) * 1000) / 10 : 0;
  return s;
}

/** ข้อมูล assignment เดี่ยวพร้อมสถานะ */
function assignmentView_(assignmentId) {
  var a = dbGet('Assignments', assignmentId);
  if (!a) return null;
  var m = dbGet('Members', a.member_id);
  var g = m ? dbGet('Groups', m.group_id) : null;
  var view = decorate_(a, m, g, paymentSummaryMap_()[a.id]);
  var c = dbGet('Collections', a.collection_id);
  if (c) {
    view.collection_code = c.code;
    view.collection_name = c.name;
    view.collection_status = c.status;
    view.collection_description = c.description;
    view.due_date = c.due_date;
    view.allow_partial = !!c.allow_partial;
    view.is_public = !!c.is_public;
  }
  return view;
}

/** กิจกรรมย่อยที่สมาชิกรายนี้ต้องชำระ */
function assignmentItems_(assignmentId) {
  var byAssignment = dbGroupBy('AssignmentItems', 'assignment_id');
  var rows = byAssignment[assignmentId] || [];
  var items = loadTable_('CollectionItems').index;
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var ci = items[rows[i].collection_item_id];
    out.push({
      id: rows[i].id,
      name: ci ? ci.name : '(ถูกลบแล้ว)',
      description: ci ? ci.description : '',
      amount: Number(rows[i].amount) || 0,
      sort_order: ci ? ci.sort_order : 0
    });
  }
  out.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  return out;
}

/** ประวัติการแจ้งชำระของ assignment */
function paymentsOf_(assignmentId) {
  var byAssignment = dbGroupBy('Payments', 'assignment_id');
  var rows = (byAssignment[assignmentId] || []).slice();
  rows.sort(function (a, b) {
    var ka = (a.created_at || '') + padStart_(String(a.id), 10, '0');
    var kb = (b.created_at || '') + padStart_(String(b.id), 10, '0');
    return ka < kb ? 1 : -1;
  });
  return rows;
}

/** รายการทั้งหมดของสมาชิกหนึ่งคน (ทุกรอบการจัดเก็บ) */
function memberLedger_(memberId, opts) {
  opts = opts || {};
  var byMember = dbGroupBy('Assignments', 'member_id');
  var assignments = byMember[memberId] || [];
  var collections = loadTable_('Collections').index;
  var member = dbGet('Members', memberId);
  var group = member ? dbGet('Groups', member.group_id) : null;
  var sums = paymentSummaryMap_();

  var out = [];
  for (var i = 0; i < assignments.length; i++) {
    var a = assignments[i];
    var c = collections[a.collection_id];
    if (!c) continue;
    if (opts.includeDraft !== true && c.status === 'draft') continue;
    if (opts.collectionId && Number(a.collection_id) !== Number(opts.collectionId)) continue;
    if (opts.from && c.created_at && c.created_at.substring(0, 10) < opts.from) continue;
    if (opts.to && c.created_at && c.created_at.substring(0, 10) > opts.to) continue;

    var row = decorate_(a, member, group, sums[a.id]);
    row.collection_code = c.code;
    row.collection_name = c.name;
    row.collection_status = c.status;
    row.due_date = c.due_date;
    row.collection_created_at = c.created_at;
    out.push(row);
  }

  out.sort(function (x, y) {
    return String(y.collection_created_at || '') < String(x.collection_created_at || '') ? -1 : 1;
  });
  if (opts.status) out = out.filter(function (r) { return r.status === opts.status; });
  return out;
}

/** สถิติรวมทั้งระบบ (สำหรับแดชบอร์ด) */
function dashboardStats_() {
  var collections = dbAll('Collections');
  var all = [];
  for (var i = 0; i < collections.length; i++) {
    if (collections[i].status === 'draft') continue;
    all = all.concat(boardOf_(collections[i].id));
  }
  var s = summarize_(all);
  s.total_collections = collections.length;
  s.open_collections = collections.filter(function (c) { return c.status === 'open'; }).length;
  s.total_active_members = dbWhere('Members', function (m) { return m.is_active; }).length;
  s.pending_payments = dbWhere('Payments', function (p) { return p.status === 'pending'; }).length;
  return s;
}
