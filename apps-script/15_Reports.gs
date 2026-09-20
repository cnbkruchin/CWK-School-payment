/**
 * ===========================================================================
 *  รายงานและการส่งออก
 *
 *  ข้อได้เปรียบของ Apps Script: ส่งออกเป็น Google Sheets ได้โดยตรง
 *  แล้วให้ลิงก์ดาวน์โหลดเป็น Excel / PDF / CSV จากไฟล์นั้นได้ทันที
 *  โดยไม่ต้องสร้างไฟล์เองให้ซับซ้อน
 * ===========================================================================
 */

/* ================================ แดชบอร์ด ================================ */

function apiDashboard(payload) {
  return apiCall_('dashboard', function () {
    payload = payload || {};
    requireAdmin_(payload.token);

    var stats = dashboardStats_();
    var ctx = paymentContext_();

    // การแจ้งชำระล่าสุด
    var recent = dbAll('Payments')
      .filter(function (p) { return p.status !== 'cancelled'; })
      .sort(function (a, b) {
        var ka = String(a.created_at || '') + padStart_(String(a.id), 10, '0');
        var kb = String(b.created_at || '') + padStart_(String(b.id), 10, '0');
        return ka < kb ? 1 : -1;
      })
      .slice(0, 12)
      .map(function (p) {
        var v = paymentView_(p, ctx);
        return {
          id: v.id, ref_code: v.ref_code, amount: v.amount, status: v.status,
          status_label: v.status_label, created_at: v.created_at,
          full_name: v.full_name, member_code: v.member_code, collection_name: v.collection_name
        };
      });

    // ความคืบหน้าแต่ละรายการจัดเก็บ
    var byCollection = dbAll('Collections')
      .filter(function (c) { return c.status !== 'draft'; })
      .sort(function (a, b) { return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1; })
      .slice(0, 8)
      .map(function (c) {
        return {
          id: c.id, code: c.code, name: c.name, status: c.status, due_date: c.due_date,
          summary: summarize_(boardOf_(c.id))
        };
      });

    // ยอดรับชำระย้อนหลัง 12 เดือน
    var trendMap = {};
    var cutoff = new Date(Date.now() - 365 * 86400000).toISOString();
    var payments = dbAll('Payments');
    for (var i = 0; i < payments.length; i++) {
      var p = payments[i];
      if (p.status !== 'approved' || !p.verified_at) continue;
      if (p.verified_at < cutoff) continue;
      var ym = String(p.verified_at).substring(0, 7);
      if (!trendMap[ym]) trendMap[ym] = { ym: ym, total: 0, cnt: 0 };
      trendMap[ym].total += Number(p.amount) || 0;
      trendMap[ym].cnt++;
    }
    var trend = [];
    for (var k in trendMap) if (Object.prototype.hasOwnProperty.call(trendMap, k)) trend.push(trendMap[k]);
    trend.sort(function (a, b) { return a.ym < b.ym ? -1 : 1; });

    // สรุปตามกลุ่ม
    var groupAgg = {};
    var collections = dbAll('Collections');
    for (var c2 = 0; c2 < collections.length; c2++) {
      if (collections[c2].status === 'draft') continue;
      var board = boardOf_(collections[c2].id);
      for (var b = 0; b < board.length; b++) {
        var row = board[b];
        var gid = row.group_id || 0;
        if (!groupAgg[gid]) {
          groupAgg[gid] = { id: gid, name: row.group_name || 'ไม่ระบุกลุ่ม', assignments: 0, due: 0, paid: 0 };
        }
        groupAgg[gid].assignments++;
        groupAgg[gid].due += row.waived ? 0 : row.net_due;
        groupAgg[gid].paid += row.paid_amount;
      }
    }
    var byGroup = [];
    for (var g in groupAgg) if (Object.prototype.hasOwnProperty.call(groupAgg, g)) byGroup.push(groupAgg[g]);
    byGroup.sort(function (a, b) { return String(a.name) < String(b.name) ? -1 : 1; });

    return { stats: stats, recent: recent, by_collection: byCollection, trend: trend, by_group: byGroup };
  });
}

/* =============================== รายงานต่าง ๆ =============================== */

function overviewData_(opts) {
  opts = opts || {};
  var status = str_(opts.status, 20);
  var from = dateOnly_(opts.from);
  var to = dateOnly_(opts.to);

  var rows = dbAll('Collections')
    .filter(function (c) {
      if (c.status === 'draft') return false;
      if (status && ['open', 'closed'].indexOf(status) >= 0 && c.status !== status) return false;
      var d = c.created_at ? String(c.created_at).substring(0, 10) : '';
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      return true;
    })
    .sort(function (a, b) { return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1; })
    .map(function (c) {
      var s = summarize_(boardOf_(c.id));
      return {
        id: c.id, code: c.code, name: c.name,
        fiscal_year: c.fiscal_year || '-', term: c.term || '-',
        due_date: c.due_date,
        status_label: COLLECTION_STATUS_LABEL[c.status] || c.status,
        members: s.total_members, total_due: s.total_due, total_paid: s.total_paid,
        outstanding: s.total_outstanding, paid_count: s.count_paid,
        pending_count: s.count_pending, unpaid_count: s.count_unpaid + s.count_rejected,
        percent: s.percent_paid
      };
    });

  var totals = { members: 0, total_due: 0, total_paid: 0, outstanding: 0, paid_count: 0, pending_count: 0, unpaid_count: 0 };
  for (var i = 0; i < rows.length; i++) {
    totals.members += rows[i].members;
    totals.total_due += rows[i].total_due;
    totals.total_paid += rows[i].total_paid;
    totals.outstanding += rows[i].outstanding;
    totals.paid_count += rows[i].paid_count;
    totals.pending_count += rows[i].pending_count;
    totals.unpaid_count += rows[i].unpaid_count;
  }
  totals.percent = totals.total_due > 0 ? Math.round((totals.total_paid / totals.total_due) * 1000) / 10 : 0;
  return { rows: rows, totals: totals, filters: { status: status, from: from, to: to } };
}

function collectionReportData_(cid, opts) {
  opts = opts || {};
  var c = dbGet('Collections', cid);
  if (!c) fail_('ไม่พบรายการจัดเก็บนี้');

  var board = boardOf_(cid);
  var filtered = filterBoard_(board, { q: opts.q, groupId: opts.group, status: opts.status_filter });

  var rows = filtered.map(function (r, i) {
    return {
      no: i + 1, member_code: r.member_code, full_name: r.full_name,
      group_name: r.group_name || '-', amount_due: r.net_due, paid_amount: r.paid_amount,
      outstanding: r.outstanding, status_label: r.status_label,
      ref_code: r.latest_ref || '-', submitted_at: r.latest_submitted_at,
      verified_at: r.last_verified_at, note: r.note || ''
    };
  });

  var items = (dbGroupBy('CollectionItems', 'collection_id')[cid] || []).slice();
  items.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

  return { collection: c, rows: rows, summary: summarize_(board), items: items };
}

function memberReportData_(mid, opts) {
  opts = opts || {};
  var m = dbGet('Members', mid);
  if (!m) fail_('ไม่พบสมาชิกรายนี้');
  var g = dbGet('Groups', m.group_id);

  var ledger = memberLedger_(mid, {
    collectionId: opts.collection, from: dateOnly_(opts.from), to: dateOnly_(opts.to)
  });

  var rows = ledger.map(function (r, i) {
    return {
      no: i + 1, collection_code: r.collection_code, collection_name: r.collection_name,
      due_date: r.due_date, amount_due: r.net_due, paid_amount: r.paid_amount,
      outstanding: r.outstanding, status_label: r.status_label,
      ref_code: r.latest_ref || '-', verified_at: r.last_verified_at
    };
  });

  // ประวัติการแจ้งชำระทั้งหมด
  var byMember = dbGroupBy('Assignments', 'member_id')[mid] || [];
  var aidSet = {};
  for (var a = 0; a < byMember.length; a++) aidSet[byMember[a].id] = true;
  var ctx = paymentContext_();
  var payments = dbAll('Payments')
    .filter(function (p) { return aidSet[p.assignment_id] && p.status !== 'cancelled'; })
    .sort(function (x, y) { return String(x.created_at || '') < String(y.created_at || '') ? 1 : -1; })
    .map(function (p) {
      var v = paymentView_(p, ctx);
      return {
        ref_code: v.ref_code, collection_code: v.collection_code, collection_name: v.collection_name,
        amount: v.amount, method_label: v.method_label, transferred_at: v.transferred_at,
        created_at: v.created_at, verified_at: v.verified_at,
        status_label: v.status_label, receipt_no: v.receipt_no || '-'
      };
    });

  return {
    member: {
      id: m.id, member_code: m.member_code,
      full_name: String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim(),
      group_name: g ? g.name : null, phone: m.phone, guardian: m.guardian
    },
    rows: rows, payments: payments, totals: summarize_(ledger)
  };
}

function allMembersReportData_(opts) {
  opts = opts || {};
  var groupId = id_(opts.group);
  var collectionId = id_(opts.collection);
  var from = dateOnly_(opts.from);
  var to = dateOnly_(opts.to);

  var groupsIndex = loadTable_('Groups').index;
  var members = dbAll('Members')
    .filter(function (m) { return m.is_active && (!groupId || Number(m.group_id) === groupId); })
    .sort(function (a, b) {
      var ga = groupsIndex[a.group_id] ? groupsIndex[a.group_id].name : '￿';
      var gb = groupsIndex[b.group_id] ? groupsIndex[b.group_id].name : '￿';
      if (ga !== gb) return ga < gb ? -1 : 1;
      return String(a.member_code) < String(b.member_code) ? -1 : 1;
    });

  var rows = members.map(function (m, i) {
    var ledger = memberLedger_(m.id, { collectionId: collectionId, from: from, to: to });
    var t = summarize_(ledger);
    var g = groupsIndex[m.group_id];
    return {
      no: i + 1, member_id: m.id, member_code: m.member_code,
      full_name: String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim(),
      group_name: g ? g.name : '-',
      rounds: ledger.length, total_due: t.total_due, total_paid: t.total_paid,
      outstanding: t.total_outstanding, paid_rounds: t.count_paid,
      pending_rounds: t.count_pending, unpaid_rounds: t.count_unpaid + t.count_rejected,
      percent: t.total_due > 0 ? Math.round((t.total_paid / t.total_due) * 1000) / 10 : 0
    };
  });

  var totals = { total_due: 0, total_paid: 0, outstanding: 0, rounds: 0, paid_rounds: 0, unpaid_rounds: 0, pending_rounds: 0 };
  for (var i2 = 0; i2 < rows.length; i2++) {
    totals.total_due += rows[i2].total_due;
    totals.total_paid += rows[i2].total_paid;
    totals.outstanding += rows[i2].outstanding;
    totals.rounds += rows[i2].rounds;
    totals.paid_rounds += rows[i2].paid_rounds;
    totals.unpaid_rounds += rows[i2].unpaid_rounds;
    totals.pending_rounds += rows[i2].pending_rounds;
  }
  return { rows: rows, totals: totals };
}

function transactionReportData_(opts) {
  opts = opts || {};
  var from = dateOnly_(opts.from);
  var to = dateOnly_(opts.to);
  var status = str_(opts.status, 20) || 'approved';
  var collectionId = id_(opts.collection);
  var groupId = id_(opts.group);

  var ctx = paymentContext_();
  var rows = dbAll('Payments')
    .filter(function (p) {
      if (p.status === 'cancelled') return false;
      if (status !== 'all' && p.status !== status) return false;
      var a = ctx.assignments[p.assignment_id];
      if (collectionId && (!a || Number(a.collection_id) !== collectionId)) return false;
      if (groupId) {
        var m = a ? ctx.members[a.member_id] : null;
        if (!m || Number(m.group_id) !== groupId) return false;
      }
      var d = String(p.verified_at || p.created_at || '').substring(0, 10);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      return true;
    })
    .sort(function (a, b) {
      var ka = String(a.verified_at || a.created_at || '');
      var kb = String(b.verified_at || b.created_at || '');
      return ka < kb ? 1 : -1;
    })
    .map(function (p, i) {
      var v = paymentView_(p, ctx);
      v.no = i + 1;
      v.receipt_no = v.receipt_no || '-';
      v.verified_by_name = v.verified_by_name || '-';
      v.group_name = v.group_name || '-';
      return v;
    });

  var total = 0;
  for (var i2 = 0; i2 < rows.length; i2++) if (rows[i2].status === 'approved') total += rows[i2].amount;
  total = Math.round(total * 100) / 100;

  return { rows: rows, total: total, count: rows.length, baht_text: bahtText_(total), filters: { from: from, to: to, status: status } };
}

function outstandingReportData_(opts) {
  opts = opts || {};
  var collectionId = id_(opts.collection);
  var groupId = id_(opts.group);

  var collections = collectionId
    ? dbAll('Collections').filter(function (c) { return c.id === collectionId && c.status !== 'draft'; })
    : dbAll('Collections').filter(function (c) { return c.status === 'open'; });

  var rows = [];
  var now = Date.now();
  for (var i = 0; i < collections.length; i++) {
    var c = collections[i];
    var board = filterBoard_(boardOf_(c.id), { groupId: groupId });
    for (var b = 0; b < board.length; b++) {
      var r = board[b];
      if (['unpaid', 'rejected', 'partial'].indexOf(r.status) < 0) continue;
      var overdue = 0;
      if (c.due_date) {
        var due = new Date(String(c.due_date).substring(0, 10) + 'T23:59:59').getTime();
        overdue = Math.max(0, Math.floor((now - due) / 86400000));
      }
      rows.push({
        member_code: r.member_code, full_name: r.full_name, group_name: r.group_name || '-',
        collection_code: c.code, collection_name: c.name, due_date: c.due_date,
        amount_due: r.net_due, paid_amount: r.paid_amount, outstanding: r.outstanding,
        status_label: r.status_label, overdue_days: overdue
      });
    }
  }
  rows.sort(function (a, b) {
    if (b.overdue_days !== a.overdue_days) return b.overdue_days - a.overdue_days;
    return b.outstanding - a.outstanding;
  });
  var total = 0;
  for (var t = 0; t < rows.length; t++) total += rows[t].outstanding;
  return { rows: rows, total: Math.round(total * 100) / 100, count: rows.length };
}

/* ------------------------------ API ของรายงาน ------------------------------ */

function apiReport(payload) {
  return apiCall_('report', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var kind = str_(payload.kind, 30);

    if (kind === 'overview') return overviewData_(payload);
    if (kind === 'collection') return collectionReportData_(id_(payload.collection), payload);
    if (kind === 'member') return memberReportData_(id_(payload.member), payload);
    if (kind === 'members') return allMembersReportData_(payload);
    if (kind === 'transactions') return transactionReportData_(payload);
    if (kind === 'outstanding') return outstandingReportData_(payload);
    fail_('ไม่รู้จักรายงานที่ต้องการ');
  });
}

function apiAuditLogs(payload) {
  return apiCall_('auditLogs', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var page = Math.max(1, num_(payload.page, 1));
    var perPage = Math.min(200, Math.max(10, num_(payload.per_page, 50)));
    var q = str_(payload.q, 100).toLowerCase();

    var rows = dbAll('AuditLogs').filter(function (l) {
      if (!q) return true;
      var hay = String(l.action + ' ' + l.actor_name + ' ' + (l.detail || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      var ka = String(a.created_at || '') + padStart_(String(a.id), 10, '0');
      var kb = String(b.created_at || '') + padStart_(String(b.id), 10, '0');
      return ka < kb ? 1 : -1;
    });

    var total = rows.length;
    return {
      logs: rows.slice((page - 1) * perPage, page * perPage).map(function (l) {
        return {
          id: l.id, created_at: iso_(l.created_at), actor_type: l.actor_type,
          actor_name: l.actor_name, action: l.action, detail: l.detail
        };
      }),
      total: total, page: page, per_page: perPage,
      pages: Math.max(1, Math.ceil(total / perPage))
    };
  });
}

/* ================================ ส่งออกไฟล์ ================================ */

var REPORT_COLUMNS = {
  overview: [
    { header: 'รหัสรายการ', key: 'code', width: 130 },
    { header: 'วัตถุประสงค์การจัดเก็บ', key: 'name', width: 300 },
    { header: 'ปีการศึกษา', key: 'fiscal_year', width: 90 },
    { header: 'ภาคเรียน', key: 'term', width: 80 },
    { header: 'กำหนดชำระ', key: 'due_date', width: 120, type: 'date' },
    { header: 'สถานะ', key: 'status_label', width: 110 },
    { header: 'ผู้ต้องชำระ (คน)', key: 'members', width: 110, type: 'int' },
    { header: 'ยอดที่ต้องเก็บ', key: 'total_due', width: 130, type: 'money' },
    { header: 'ยอดที่เก็บได้', key: 'total_paid', width: 130, type: 'money' },
    { header: 'ยอดค้างชำระ', key: 'outstanding', width: 130, type: 'money' },
    { header: 'ชำระแล้ว (คน)', key: 'paid_count', width: 110, type: 'int' },
    { header: 'รอตรวจสอบ (คน)', key: 'pending_count', width: 120, type: 'int' },
    { header: 'ยังไม่ชำระ (คน)', key: 'unpaid_count', width: 115, type: 'int' },
    { header: 'ร้อยละที่เก็บได้', key: 'percent', width: 110, type: 'int' }
  ],
  collection: [
    { header: 'ลำดับ', key: 'no', width: 60, type: 'int' },
    { header: 'รหัสสมาชิก', key: 'member_code', width: 110 },
    { header: 'ชื่อ-สกุล', key: 'full_name', width: 220 },
    { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 110 },
    { header: 'ยอดที่ต้องชำระ', key: 'amount_due', width: 130, type: 'money' },
    { header: 'ยอดที่ชำระแล้ว', key: 'paid_amount', width: 130, type: 'money' },
    { header: 'คงเหลือ', key: 'outstanding', width: 110, type: 'money' },
    { header: 'สถานะ', key: 'status_label', width: 140 },
    { header: 'เลขอ้างอิง', key: 'ref_code', width: 100 },
    { header: 'วันที่แจ้ง', key: 'submitted_at', width: 140, type: 'date' },
    { header: 'วันที่อนุมัติ', key: 'verified_at', width: 140, type: 'date' },
    { header: 'หมายเหตุ', key: 'note', width: 180 }
  ],
  member: [
    { header: 'ลำดับ', key: 'no', width: 60, type: 'int' },
    { header: 'รหัสรายการ', key: 'collection_code', width: 130 },
    { header: 'วัตถุประสงค์การจัดเก็บ', key: 'collection_name', width: 300 },
    { header: 'กำหนดชำระ', key: 'due_date', width: 120, type: 'date' },
    { header: 'ยอดที่ต้องชำระ', key: 'amount_due', width: 130, type: 'money' },
    { header: 'ยอดที่ชำระแล้ว', key: 'paid_amount', width: 130, type: 'money' },
    { header: 'คงเหลือ', key: 'outstanding', width: 110, type: 'money' },
    { header: 'สถานะ', key: 'status_label', width: 140 },
    { header: 'เลขอ้างอิง', key: 'ref_code', width: 100 },
    { header: 'วันที่อนุมัติ', key: 'verified_at', width: 140, type: 'date' }
  ],
  members: [
    { header: 'ลำดับ', key: 'no', width: 60, type: 'int' },
    { header: 'รหัสสมาชิก', key: 'member_code', width: 110 },
    { header: 'ชื่อ-สกุล', key: 'full_name', width: 220 },
    { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 110 },
    { header: 'จำนวนรอบ', key: 'rounds', width: 90, type: 'int' },
    { header: 'ยอดที่ต้องชำระรวม', key: 'total_due', width: 150, type: 'money' },
    { header: 'ยอดที่ชำระแล้วรวม', key: 'total_paid', width: 150, type: 'money' },
    { header: 'ยอดค้างชำระ', key: 'outstanding', width: 130, type: 'money' },
    { header: 'รอบที่ชำระครบ', key: 'paid_rounds', width: 110, type: 'int' },
    { header: 'รอบที่รอตรวจสอบ', key: 'pending_rounds', width: 120, type: 'int' },
    { header: 'รอบที่ค้างชำระ', key: 'unpaid_rounds', width: 110, type: 'int' },
    { header: 'ร้อยละที่ชำระ', key: 'percent', width: 100, type: 'int' }
  ],
  transactions: [
    { header: 'ลำดับ', key: 'no', width: 60, type: 'int' },
    { header: 'เลขอ้างอิง', key: 'ref_code', width: 100 },
    { header: 'เลขที่ใบเสร็จ', key: 'receipt_no', width: 140 },
    { header: 'รหัสสมาชิก', key: 'member_code', width: 110 },
    { header: 'ชื่อ-สกุล', key: 'full_name', width: 200 },
    { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 110 },
    { header: 'รายการจัดเก็บ', key: 'collection_name', width: 250 },
    { header: 'จำนวนเงิน', key: 'amount', width: 120, type: 'money' },
    { header: 'ช่องทาง', key: 'method_label', width: 90 },
    { header: 'วันที่โอน', key: 'transferred_at', width: 140, type: 'date' },
    { header: 'วันที่อนุมัติ', key: 'verified_at', width: 140, type: 'date' },
    { header: 'ผู้ตรวจสอบ', key: 'verified_by_name', width: 160 },
    { header: 'สถานะ', key: 'status_label', width: 120 }
  ],
  outstanding: [
    { header: 'รหัสสมาชิก', key: 'member_code', width: 110 },
    { header: 'ชื่อ-สกุล', key: 'full_name', width: 220 },
    { header: 'กลุ่ม/ชั้น', key: 'group_name', width: 110 },
    { header: 'รายการจัดเก็บ', key: 'collection_name', width: 250 },
    { header: 'กำหนดชำระ', key: 'due_date', width: 120, type: 'date' },
    { header: 'เลยกำหนด (วัน)', key: 'overdue_days', width: 120, type: 'int' },
    { header: 'ยอดที่ต้องชำระ', key: 'amount_due', width: 130, type: 'money' },
    { header: 'ยอดที่ชำระแล้ว', key: 'paid_amount', width: 130, type: 'money' },
    { header: 'คงค้าง', key: 'outstanding', width: 110, type: 'money' },
    { header: 'สถานะ', key: 'status_label', width: 140 }
  ]
};

/**
 * ส่งออกรายงานเป็นไฟล์ Google Sheets ใหม่ในโฟลเดอร์ "รายงาน"
 * แล้วคืนลิงก์สำหรับเปิดดู ดาวน์โหลด Excel และ PDF
 */
function apiExportReport(payload) {
  return apiCall_('exportReport', function () {
    payload = payload || {};
    var admin = requireAdmin_(payload.token);
    var kind = str_(payload.kind, 30);
    var columns = REPORT_COLUMNS[kind];
    if (!columns) fail_('ไม่รู้จักรายงานที่ต้องการส่งออก');

    var school = setting('school_name');
    var data, title, subtitle, meta = [], totals = null, extraSheets = [];

    if (kind === 'overview') {
      data = overviewData_(payload);
      title = 'รายงานภาพรวมการรับชำระเงิน — ' + school;
      subtitle = 'สรุปทุกรายการจัดเก็บ';
      totals = { __label: 'รวมทั้งสิ้น', total_due: data.totals.total_due, total_paid: data.totals.total_paid, outstanding: data.totals.outstanding };

    } else if (kind === 'collection') {
      data = collectionReportData_(id_(payload.collection), payload);
      var c = data.collection;
      title = c.name + ' — ' + school;
      subtitle = 'รายงานการรับชำระเงินรายชุด';
      meta = [
        'รหัสรายการ ' + c.code + (c.fiscal_year ? ' • ปีการศึกษา ' + c.fiscal_year : '') + (c.term ? ' • ภาคเรียนที่ ' + c.term : ''),
        c.due_date ? 'กำหนดชำระภายใน ' + thaiDate_(c.due_date) : 'ไม่กำหนดวันครบกำหนด',
        'ผู้ต้องชำระ ' + data.summary.total_members + ' คน • ชำระแล้ว ' + data.summary.count_paid +
          ' คน • รอตรวจสอบ ' + data.summary.count_pending + ' คน • ยังไม่ชำระ ' + (data.summary.count_unpaid + data.summary.count_rejected) + ' คน',
        'ยอดที่ต้องเก็บ ' + moneyStr_(data.summary.total_due) + ' บาท • เก็บได้ ' + moneyStr_(data.summary.total_paid) +
          ' บาท • คงค้าง ' + moneyStr_(data.summary.total_outstanding) + ' บาท'
      ];
      totals = { __label: 'รวมทั้งสิ้น', amount_due: data.summary.total_due, paid_amount: data.summary.total_paid, outstanding: data.summary.total_outstanding };
      if (data.items.length) {
        extraSheets.push({
          name: 'กิจกรรมย่อย',
          columns: [
            { header: 'กิจกรรมย่อย', key: 'name', width: 320 },
            { header: 'จำนวนเงิน', key: 'amount', width: 130, type: 'money' },
            { header: 'ประเภท', key: 'kind', width: 120 }
          ],
          rows: data.items.map(function (it) {
            return { name: it.name, amount: Number(it.amount) || 0, kind: it.is_optional ? 'เลือกได้' : 'บังคับ' };
          })
        });
      }

    } else if (kind === 'member') {
      data = memberReportData_(id_(payload.member), payload);
      title = 'รายงานการชำระเงินรายบุคคล — ' + school;
      subtitle = data.member.full_name + ' (' + data.member.member_code + ')';
      meta = [
        data.member.group_name ? 'กลุ่ม/ชั้น ' + data.member.group_name : '',
        'รวมต้องชำระ ' + moneyStr_(data.totals.total_due) + ' บาท • ชำระแล้ว ' + moneyStr_(data.totals.total_paid) +
          ' บาท • คงค้าง ' + moneyStr_(data.totals.total_outstanding) + ' บาท',
        'คิดเป็นตัวอักษร (ยอดที่ชำระแล้ว): ' + bahtText_(data.totals.total_paid)
      ];
      totals = { __label: 'รวมทั้งสิ้น', amount_due: data.totals.total_due, paid_amount: data.totals.total_paid, outstanding: data.totals.total_outstanding };
      extraSheets.push({
        name: 'ประวัติการแจ้งชำระ',
        columns: [
          { header: 'เลขอ้างอิง', key: 'ref_code', width: 100 },
          { header: 'รายการจัดเก็บ', key: 'collection_name', width: 280 },
          { header: 'จำนวนเงิน', key: 'amount', width: 120, type: 'money' },
          { header: 'ช่องทาง', key: 'method_label', width: 90 },
          { header: 'วันที่โอน', key: 'transferred_at', width: 140, type: 'date' },
          { header: 'วันที่แจ้ง', key: 'created_at', width: 140, type: 'date' },
          { header: 'สถานะ', key: 'status_label', width: 120 },
          { header: 'เลขที่ใบเสร็จ', key: 'receipt_no', width: 140 }
        ],
        rows: data.payments
      });

    } else if (kind === 'members') {
      data = allMembersReportData_(payload);
      title = 'สรุปการชำระเงินรายบุคคล (ทุกคน) — ' + school;
      subtitle = 'รวมทุกรอบการจัดเก็บ';
      totals = { __label: 'รวมทั้งสิ้น', total_due: data.totals.total_due, total_paid: data.totals.total_paid, outstanding: data.totals.outstanding };

    } else if (kind === 'transactions') {
      data = transactionReportData_(payload);
      title = 'รายงานการรับชำระเงิน — ' + school;
      subtitle = 'รายการธุรกรรมทั้งหมด';
      meta = [
        data.filters.from || data.filters.to
          ? 'ช่วงวันที่ ' + (data.filters.from ? thaiDate_(data.filters.from) : 'เริ่มต้น') + ' ถึง ' + (data.filters.to ? thaiDate_(data.filters.to) : 'ปัจจุบัน')
          : 'ทุกช่วงเวลา',
        'จำนวน ' + data.count + ' รายการ • ยอดรวมที่อนุมัติแล้ว ' + moneyStr_(data.total) + ' บาท',
        '(' + data.baht_text + ')'
      ];
      totals = { __label: 'รวม', amount: data.total };

    } else {
      data = outstandingReportData_(payload);
      title = 'รายชื่อค้างชำระ — ' + school;
      subtitle = 'เรียงตามจำนวนวันที่เลยกำหนด';
      meta = ['จำนวน ' + data.count + ' รายการ • ยอดค้างรวม ' + moneyStr_(data.total) + ' บาท'];
      totals = { __label: 'รวม', outstanding: data.total };
    }

    meta.push('พิมพ์เมื่อ ' + thaiDate_(new Date(), { withTime: true }));
    meta = meta.filter(function (x) { return !!x; });

    var file = buildReportSpreadsheet_({
      title: title, subtitle: subtitle, meta: meta,
      sheets: [{ name: 'รายงาน', columns: columns, rows: data.rows, totals: totals }].concat(extraSheets)
    });

    audit_(admin, 'ออกรายงาน', { detail: kind + ' — ' + title });

    return {
      file_id: file.id,
      name: file.name,
      url: file.url,
      xlsx_url: file.xlsxUrl,
      pdf_url: file.pdfUrl,
      csv_url: file.csvUrl,
      row_count: data.rows.length
    };
  });
}

/**
 * สร้างไฟล์ Google Sheets สำหรับรายงาน พร้อมจัดรูปแบบให้อ่านง่าย
 * เขียนข้อมูลทั้งหมดในครั้งเดียวด้วย setValues เพื่อความเร็ว
 */
function buildReportSpreadsheet_(spec) {
  var stamp = Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd-HHmmss');
  var fileName = spec.title.replace(/[\\/:*?"<>|]/g, '-').substring(0, 80) + ' ' + stamp;

  var newSs = SpreadsheetApp.create(fileName);
  var created = [];

  for (var si = 0; si < spec.sheets.length; si++) {
    var def = spec.sheets[si];
    var sh;
    if (si === 0) {
      // ใช้ชีตเริ่มต้นที่มากับไฟล์ใหม่ หากไม่มีก็สร้างขึ้นเอง
      var firstSheets = newSs.getSheets();
      sh = firstSheets && firstSheets.length ? firstSheets[0] : newSs.insertSheet(def.name);
      sh.setName(def.name);
    } else {
      sh = newSs.insertSheet(def.name);
    }
    created.push(sh);

    var cols = def.columns;
    var nCols = cols.length;
    var block = [];

    // ส่วนหัวรายงาน
    block.push(fillRow_([spec.title], nCols));
    if (spec.subtitle) block.push(fillRow_([spec.subtitle], nCols));
    for (var m = 0; m < (spec.meta || []).length; m++) block.push(fillRow_([spec.meta[m]], nCols));
    block.push(fillRow_([''], nCols));

    var headerRowIndex = block.length + 1;
    block.push(cols.map(function (c) { return c.header; }));

    // ข้อมูล
    for (var r = 0; r < def.rows.length; r++) {
      var row = [];
      for (var c2 = 0; c2 < nCols; c2++) {
        var col = cols[c2];
        var v = def.rows[r][col.key];
        if (col.type === 'money' || col.type === 'int') {
          row.push(v === null || v === undefined || v === '' ? '' : Number(v));
        } else if (col.type === 'date') {
          row.push(v ? thaiDate_(v, { short: true }) : '');
        } else {
          row.push(v === null || v === undefined ? '' : String(v));
        }
      }
      block.push(row);
    }

    // แถวสรุป
    var totalsRowIndex = null;
    if (def.totals) {
      totalsRowIndex = block.length + 1;
      var trow = [];
      for (var c3 = 0; c3 < nCols; c3++) {
        var col3 = cols[c3];
        if (c3 === 0) trow.push(def.totals.__label || 'รวมทั้งสิ้น');
        else if (def.totals[col3.key] !== undefined) trow.push(Number(def.totals[col3.key]));
        else trow.push('');
      }
      block.push(trow);
    }

    // เขียนทั้งหมดในครั้งเดียว
    sh.getRange(1, 1, block.length, nCols).setValues(block);

    // จัดรูปแบบ
    sh.getRange(1, 1, 1, nCols).merge().setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center');
    if (spec.subtitle) {
      sh.getRange(2, 1, 1, nCols).merge().setFontSize(11).setFontColor('#475569').setHorizontalAlignment('center');
    }
    for (var mm = 0; mm < (spec.meta || []).length; mm++) {
      var rowNo = (spec.subtitle ? 3 : 2) + mm;
      sh.getRange(rowNo, 1, 1, nCols).merge().setFontSize(9).setFontColor('#64748b').setHorizontalAlignment('center');
    }

    var head = sh.getRange(headerRowIndex, 1, 1, nCols);
    head.setFontWeight('bold').setBackground('#4f46e5').setFontColor('#ffffff')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
    sh.setFrozenRows(headerRowIndex);

    // รูปแบบตัวเลข
    var dataRows = def.rows.length;
    if (dataRows > 0) {
      for (var c4 = 0; c4 < nCols; c4++) {
        if (cols[c4].type === 'money') {
          sh.getRange(headerRowIndex + 1, c4 + 1, dataRows, 1).setNumberFormat('#,##0.00');
        } else if (cols[c4].type === 'int') {
          sh.getRange(headerRowIndex + 1, c4 + 1, dataRows, 1).setNumberFormat('#,##0');
        }
      }
    }
    if (totalsRowIndex) {
      var trange = sh.getRange(totalsRowIndex, 1, 1, nCols);
      trange.setFontWeight('bold').setBackground('#eef2ff');
      for (var c5 = 0; c5 < nCols; c5++) {
        if (cols[c5].type === 'money') sh.getRange(totalsRowIndex, c5 + 1, 1, 1).setNumberFormat('#,##0.00');
        else if (cols[c5].type === 'int') sh.getRange(totalsRowIndex, c5 + 1, 1, 1).setNumberFormat('#,##0');
      }
    }

    for (var w = 0; w < nCols; w++) {
      sh.setColumnWidth(w + 1, cols[w].width || 140);
    }
  }

  // ย้ายไฟล์ไปยังโฟลเดอร์รายงาน
  var url = newSs.getUrl();
  var fileId = newSs.getId();
  try {
    DriveApp.getFileById(fileId).moveTo(folder_('reports'));
  } catch (e) {
    // ย้ายไม่สำเร็จไม่กระทบการใช้งาน — ไฟล์ยังอยู่ใน Drive และเปิดผ่านลิงก์ได้
    Logger.log('ย้ายไฟล์รายงานไปยังโฟลเดอร์ไม่สำเร็จ: ' + e.message);
  }

  var base = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?';
  return {
    id: fileId,
    name: fileName,
    url: url,
    xlsxUrl: base + 'format=xlsx',
    csvUrl: base + 'format=csv&gid=' + created[0].getSheetId(),
    pdfUrl: base + 'format=pdf&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&gid=' + created[0].getSheetId()
  };
}

function fillRow_(values, n) {
  var out = values.slice();
  while (out.length < n) out.push('');
  return out;
}
