/**
 * ===========================================================================
 *  API ผู้ดูแล: รายการจัดเก็บ กิจกรรมย่อย และการกำหนดผู้ที่ต้องชำระ
 * ===========================================================================
 */

var VALID_COLLECTION_STATUS = ['draft', 'open', 'closed'];
var COLLECTION_STATUS_LABEL = { draft: 'ฉบับร่าง', open: 'เปิดรับชำระ', closed: 'ปิดรับชำระ' };

/** ยอดรวมของกิจกรรมย่อยที่บังคับชำระ */
function baseAmount_(collectionId) {
  var items = dbGroupBy('CollectionItems', 'collection_id')[collectionId] || [];
  var sum = 0;
  for (var i = 0; i < items.length; i++) {
    if (!items[i].is_optional) sum += Number(items[i].amount) || 0;
  }
  return Math.round(sum * 100) / 100;
}

function apiCollections(payload) {
  return apiCall_('collections', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var status = str_(payload.status, 20);
    var q = str_(payload.q, 100).toLowerCase();

    var itemsByCol = dbGroupBy('CollectionItems', 'collection_id');
    var assignsByCol = dbGroupBy('Assignments', 'collection_id');
    var adminsIndex = loadTable_('Admins').index;

    var rows = dbAll('Collections').filter(function (c) {
      if (status && VALID_COLLECTION_STATUS.indexOf(status) >= 0 && c.status !== status) return false;
      if (q) {
        var hay = String(c.name + ' ' + c.code + ' ' + (c.description || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    var out = rows.map(function (c) {
      var creator = adminsIndex[c.created_by];
      return {
        id: c.id, code: c.code, name: c.name, description: c.description,
        fiscal_year: c.fiscal_year, term: c.term,
        default_amount: Number(c.default_amount) || 0,
        due_date: c.due_date, allow_partial: !!c.allow_partial,
        status: c.status, status_label: COLLECTION_STATUS_LABEL[c.status] || c.status,
        is_public: !!c.is_public,
        created_by_name: creator ? creator.full_name : null,
        created_at: iso_(c.created_at),
        item_count: (itemsByCol[c.id] || []).length,
        member_count: (assignsByCol[c.id] || []).length,
        base_amount: baseAmount_(c.id),
        summary: summarize_(boardOf_(c.id))
      };
    });

    out.sort(function (a, b) { return String(b.created_at || '') < String(a.created_at || '') ? -1 : 1; });
    return { collections: out };
  });
}

function apiCollection(payload) {
  return apiCall_('collection', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var cid = id_(payload.id);
    var c = dbGet('Collections', cid);
    if (!c) fail_('ไม่พบรายการจัดเก็บนี้');

    var items = (dbGroupBy('CollectionItems', 'collection_id')[cid] || []).slice();
    items.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    var board = boardOf_(cid);
    var filtered = filterBoard_(board, {
      q: str_(payload.q, 100), groupId: id_(payload.group), status: str_(payload.status_filter, 20)
    });

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
        fiscal_year: c.fiscal_year, term: c.term,
        default_amount: Number(c.default_amount) || 0,
        due_date: c.due_date, allow_partial: !!c.allow_partial,
        status: c.status, status_label: COLLECTION_STATUS_LABEL[c.status] || c.status,
        is_public: !!c.is_public, created_at: iso_(c.created_at),
        base_amount: baseAmount_(cid)
      },
      items: items.map(function (it) {
        return {
          id: it.id, name: it.name, description: it.description,
          amount: Number(it.amount) || 0, is_optional: !!it.is_optional, sort_order: it.sort_order
        };
      }),
      members: filtered,
      summary: summarize_(board),
      groups: groups
    };
  });
}

function apiSaveCollection(payload) {
  return apiCall_('saveCollection', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var name = str_(payload.name, 200);
    if (!name) fail_('กรุณาระบุชื่อ/วัตถุประสงค์ของการจัดเก็บ');

    return withLock_(function () {
      var cid = id_(payload.id);
      var code = str_(payload.code, 40);
      var status = VALID_COLLECTION_STATUS.indexOf(str_(payload.status, 20)) >= 0 ? str_(payload.status, 20) : null;

      if (cid) {
        var existing = dbGet('Collections', cid);
        if (!existing) fail_('ไม่พบรายการจัดเก็บนี้');
        code = code || existing.code;
        if (code !== existing.code) {
          var dup = dbFind('Collections', function (x) { return x.code === code && x.id !== cid; });
          if (dup) fail_('รหัสรายการ "' + code + '" ถูกใช้ไปแล้ว');
        }
        dbUpdate('Collections', cid, {
          code: code, name: name,
          description: str_(payload.description, 1000),
          fiscal_year: str_(payload.fiscal_year, 20),
          term: str_(payload.term, 20),
          default_amount: money_(payload.default_amount, existing.default_amount),
          due_date: dateOnly_(payload.due_date) || '',
          allow_partial: payload.allow_partial === undefined ? existing.allow_partial : bool_(payload.allow_partial),
          status: status || existing.status,
          is_public: payload.is_public === undefined ? existing.is_public : bool_(payload.is_public)
        });
        audit_(admin, 'แก้ไขรายการจัดเก็บ', { targetType: 'collection', targetId: cid, detail: code + ' — ' + name });
        return { id: cid, code: code };
      }

      if (code) {
        var dup2 = dbFind('Collections', function (x) { return x.code === code; });
        if (dup2) fail_('รหัสรายการ "' + code + '" ถูกใช้ไปแล้ว');
      } else {
        code = generateCollectionCode_();
      }

      var created = dbInsert('Collections', {
        code: code, name: name,
        description: str_(payload.description, 1000),
        fiscal_year: str_(payload.fiscal_year, 20),
        term: str_(payload.term, 20),
        default_amount: money_(payload.default_amount, 0),
        due_date: dateOnly_(payload.due_date) || '',
        allow_partial: bool_(payload.allow_partial),
        status: status || 'draft',
        is_public: payload.is_public === undefined ? true : bool_(payload.is_public),
        created_by: admin.id
      });

      // กิจกรรมย่อยที่ส่งมาพร้อมกัน
      var items = payload.items || [];
      var toInsert = [];
      for (var i = 0; i < items.length; i++) {
        var n = str_(items[i].name, 200);
        if (!n) continue;
        toInsert.push({
          collection_id: created.id, name: n,
          description: str_(items[i].description, 500),
          amount: money_(items[i].amount, 0),
          is_optional: bool_(items[i].is_optional),
          sort_order: num_(items[i].sort_order, i)
        });
      }
      if (toInsert.length) dbInsertMany('CollectionItems', toInsert);

      audit_(admin, 'สร้างรายการจัดเก็บ', { targetType: 'collection', targetId: created.id, detail: code + ' — ' + name });
      return { id: created.id, code: code };
    });
  });
}

function apiSetCollectionStatus(payload) {
  return apiCall_('setCollectionStatus', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var cid = id_(payload.id);
    var status = str_(payload.status, 20);
    if (VALID_COLLECTION_STATUS.indexOf(status) < 0) fail_('สถานะไม่ถูกต้อง');

    return withLock_(function () {
      var c = dbGet('Collections', cid);
      if (!c) fail_('ไม่พบรายการจัดเก็บนี้');
      if (status === 'open') {
        var n = (dbGroupBy('Assignments', 'collection_id')[cid] || []).length;
        if (n === 0) fail_('ยังไม่ได้กำหนดผู้ที่ต้องชำระ กรุณาเพิ่มสมาชิกเข้ารายการนี้ก่อนเปิดรับชำระ');
      }
      dbUpdate('Collections', cid, { status: status });
      audit_(admin, 'เปลี่ยนสถานะรายการจัดเก็บ', {
        targetType: 'collection', targetId: cid,
        detail: c.code + ' → ' + COLLECTION_STATUS_LABEL[status]
      });
      return { status: status };
    });
  });
}

function apiDeleteCollection(payload) {
  return apiCall_('deleteCollection', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var cid = id_(payload.id);

    return withLock_(function () {
      var c = dbGet('Collections', cid);
      if (!c) fail_('ไม่พบรายการจัดเก็บนี้');

      var assigns = dbGroupBy('Assignments', 'collection_id')[cid] || [];
      var sums = paymentSummaryMap_();
      var paidCount = 0;
      for (var i = 0; i < assigns.length; i++) {
        if (sums[assigns[i].id] && sums[assigns[i].id].paid > 0) paidCount++;
      }
      if (paidCount > 0 && !bool_(payload.force)) {
        fail_('รายการนี้มีการชำระเงินที่อนุมัติแล้ว ' + paidCount + ' รายการ หากต้องการลบจริงกรุณายืนยันอีกครั้ง (ข้อมูลการเงินจะหายทั้งหมด)');
      }

      cascadeDeleteAssignments_(assigns.map(function (a) { return a.id; }));
      var items = dbGroupBy('CollectionItems', 'collection_id')[cid] || [];
      if (items.length) dbDeleteMany('CollectionItems', items.map(function (x) { return x.id; }));
      dbDelete('Collections', cid);

      audit_(admin, 'ลบรายการจัดเก็บ', { targetType: 'collection', targetId: cid, detail: c.code + ' — ' + c.name });
      return { ok: true };
    });
  });
}

function apiDuplicateCollection(payload) {
  return apiCall_('duplicateCollection', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var cid = id_(payload.id);

    return withLock_(function () {
      var c = dbGet('Collections', cid);
      if (!c) fail_('ไม่พบรายการจัดเก็บนี้');

      var created = dbInsert('Collections', {
        code: generateCollectionCode_(),
        name: c.name + ' (สำเนา)',
        description: c.description, fiscal_year: c.fiscal_year, term: c.term,
        default_amount: c.default_amount, due_date: c.due_date,
        allow_partial: c.allow_partial, status: 'draft', is_public: c.is_public,
        created_by: admin.id
      });

      var items = (dbGroupBy('CollectionItems', 'collection_id')[cid] || []).slice();
      items.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      if (items.length) {
        dbInsertMany('CollectionItems', items.map(function (it) {
          return {
            collection_id: created.id, name: it.name, description: it.description,
            amount: it.amount, is_optional: it.is_optional, sort_order: it.sort_order
          };
        }));
      }

      if (bool_(payload.with_members)) {
        var assigns = dbGroupBy('Assignments', 'collection_id')[cid] || [];
        if (assigns.length) {
          dbInsertMany('Assignments', assigns.map(function (a) {
            return {
              collection_id: created.id, member_id: a.member_id, amount_due: a.amount_due,
              discount: a.discount, waived: a.waived, note: a.note, created_by: admin.id
            };
          }));
        }
      }

      audit_(admin, 'ทำสำเนารายการจัดเก็บ', { targetType: 'collection', targetId: created.id, detail: 'จาก ' + c.code });
      return { id: created.id };
    });
  });
}

/* ============================== กิจกรรมย่อย ============================== */

function apiSaveCollectionItem(payload) {
  return apiCall_('saveCollectionItem', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var cid = id_(payload.collection_id);
    var name = str_(payload.name, 200);
    if (!dbGet('Collections', cid)) fail_('ไม่พบรายการจัดเก็บนี้');
    if (!name) fail_('กรุณาระบุชื่อกิจกรรมย่อย');

    return withLock_(function () {
      var itemId = id_(payload.id);

      if (itemId) {
        var it = dbGet('CollectionItems', itemId);
        if (!it || Number(it.collection_id) !== cid) fail_('ไม่พบกิจกรรมย่อยนี้');
        var newAmount = payload.amount === undefined ? it.amount : money_(payload.amount, 0);

        dbUpdate('CollectionItems', itemId, {
          name: name,
          description: str_(payload.description, 500),
          amount: newAmount,
          is_optional: payload.is_optional === undefined ? it.is_optional : bool_(payload.is_optional),
          sort_order: num_(payload.sort_order, it.sort_order)
        });

        // ปรับยอดของสมาชิกที่ผูกกับกิจกรรมย่อยนี้ไว้
        if (Number(newAmount) !== Number(it.amount)) {
          var links = dbWhere('AssignmentItems', function (x) { return Number(x.collection_item_id) === itemId; });
          if (links.length) {
            dbUpdateMany('AssignmentItems', links.map(function (l) { return { id: l.id, patch: { amount: newAmount } }; }));
            recalcAssignments_(links.map(function (l) { return l.assignment_id; }));
          }
        }
        audit_(admin, 'แก้ไขกิจกรรมย่อย', { targetType: 'collection', targetId: cid, detail: name });
        return { id: itemId, base_amount: baseAmount_(cid) };
      }

      var existing = dbGroupBy('CollectionItems', 'collection_id')[cid] || [];
      var maxOrder = -1;
      for (var i = 0; i < existing.length; i++) maxOrder = Math.max(maxOrder, Number(existing[i].sort_order) || 0);

      var created = dbInsert('CollectionItems', {
        collection_id: cid, name: name,
        description: str_(payload.description, 500),
        amount: money_(payload.amount, 0),
        is_optional: bool_(payload.is_optional),
        sort_order: num_(payload.sort_order, maxOrder + 1)
      });
      audit_(admin, 'เพิ่มกิจกรรมย่อย', {
        targetType: 'collection', targetId: cid,
        detail: name + ' (' + moneyStr_(money_(payload.amount, 0)) + ' บาท)'
      });
      return { id: created.id, base_amount: baseAmount_(cid) };
    });
  });
}

function apiDeleteCollectionItem(payload) {
  return apiCall_('deleteCollectionItem', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var cid = id_(payload.collection_id);
    var itemId = id_(payload.id);

    return withLock_(function () {
      var it = dbGet('CollectionItems', itemId);
      if (!it || Number(it.collection_id) !== cid) fail_('ไม่พบกิจกรรมย่อยนี้');

      var links = dbWhere('AssignmentItems', function (x) { return Number(x.collection_item_id) === itemId; });
      var affected = links.map(function (l) { return l.assignment_id; });
      if (links.length) dbDeleteMany('AssignmentItems', links.map(function (l) { return l.id; }));
      dbDelete('CollectionItems', itemId);
      recalcAssignments_(affected);

      audit_(admin, 'ลบกิจกรรมย่อย', { targetType: 'collection', targetId: cid, detail: it.name });
      return { base_amount: baseAmount_(cid) };
    });
  });
}

/** คำนวณยอดที่ต้องชำระใหม่จากกิจกรรมย่อยที่เลือกไว้ */
function recalcAssignments_(assignmentIds) {
  if (!assignmentIds || !assignmentIds.length) return;
  var unique = {};
  for (var i = 0; i < assignmentIds.length; i++) unique[assignmentIds[i]] = true;

  var byAssignment = dbGroupBy('AssignmentItems', 'assignment_id');
  var patches = [];
  for (var aid in unique) {
    if (!Object.prototype.hasOwnProperty.call(unique, aid)) continue;
    var items = byAssignment[aid] || [];
    if (!items.length) continue;   // ไม่มีกิจกรรมย่อยผูกไว้ = กำหนดยอดเอง ไม่ต้องคำนวณใหม่
    var sum = 0;
    for (var j = 0; j < items.length; j++) sum += Number(items[j].amount) || 0;
    patches.push({ id: Number(aid), patch: { amount_due: Math.round(sum * 100) / 100 } });
  }
  if (patches.length) dbUpdateMany('Assignments', patches);
}

/* ==================== กำหนดผู้ที่ต้องชำระ (กลุ่ม/รายบุคคล) ==================== */

function apiAssign(payload) {
  return apiCall_('assign', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var cid = id_(payload.collection_id);

    return withLock_(function () {
      var c = dbGet('Collections', cid);
      if (!c) fail_('ไม่พบรายการจัดเก็บนี้');

      var mode = str_(payload.mode, 20) || 'members';
      var memberIds = (payload.member_ids || []).map(id_).filter(Boolean);
      var groupIds = (payload.group_ids || []).map(id_).filter(Boolean);
      var itemIds = (payload.item_ids || []).map(id_).filter(Boolean);
      var overwrite = bool_(payload.overwrite);

      var targets = [];
      if (mode === 'all') {
        targets = dbWhere('Members', function (m) { return m.is_active; }).map(function (m) { return m.id; });
      } else if (mode === 'group') {
        if (!groupIds.length) fail_('กรุณาเลือกกลุ่มอย่างน้อย 1 กลุ่ม');
        var gset = {};
        for (var g = 0; g < groupIds.length; g++) gset[groupIds[g]] = true;
        targets = dbWhere('Members', function (m) { return m.is_active && gset[m.group_id]; }).map(function (m) { return m.id; });
      } else {
        if (!memberIds.length) fail_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
        targets = memberIds;
      }
      if (!targets.length) fail_('ไม่พบสมาชิกที่ตรงกับเงื่อนไขที่เลือก');
      if (targets.length > 800) fail_('กำหนดได้ครั้งละไม่เกิน 800 คน กรุณาแบ่งเป็นหลายครั้ง');

      // คำนวณยอด: จากกิจกรรมย่อยที่เลือก > ยอดที่ระบุ > ยอดรวมกิจกรรมบังคับ > ยอดตั้งต้น
      var chosenItems = [];
      var amount;
      if (itemIds.length) {
        var allItems = dbGroupBy('CollectionItems', 'collection_id')[cid] || [];
        var wanted = {};
        for (var w = 0; w < itemIds.length; w++) wanted[itemIds[w]] = true;
        for (var ai = 0; ai < allItems.length; ai++) {
          if (wanted[allItems[ai].id]) chosenItems.push(allItems[ai]);
        }
        amount = 0;
        for (var ci = 0; ci < chosenItems.length; ci++) amount += Number(chosenItems[ci].amount) || 0;
        amount = Math.round(amount * 100) / 100;
      } else if (payload.amount !== undefined && payload.amount !== '') {
        amount = money_(payload.amount, 0);
      } else {
        var base = baseAmount_(cid);
        amount = base > 0 ? base : (Number(c.default_amount) || 0);
      }

      var discount = money_(payload.discount, 0);
      var note = str_(payload.note, 500);
      var waived = bool_(payload.waived);

      var existingByMember = {};
      var existing = dbGroupBy('Assignments', 'collection_id')[cid] || [];
      for (var e = 0; e < existing.length; e++) existingByMember[existing[e].member_id] = existing[e];

      var sums = paymentSummaryMap_();
      var stats = { created: 0, updated: 0, skipped: 0 };
      var toInsert = [];
      var toUpdate = [];
      var itemsToClear = [];

      for (var t = 0; t < targets.length; t++) {
        var mid = targets[t];
        var ex = existingByMember[mid];
        if (ex) {
          if (!overwrite) { stats.skipped++; continue; }
          // ไม่แก้ไขรายการที่มีการแจ้งชำระแล้ว เพื่อไม่ให้กระทบข้อมูลการเงิน
          if (sums[ex.id] && sums[ex.id].count > 0) { stats.skipped++; continue; }
          toUpdate.push({ id: ex.id, patch: { amount_due: amount, discount: discount, waived: waived, note: note } });
          itemsToClear.push(ex.id);
          stats.updated++;
        } else {
          toInsert.push({
            collection_id: cid, member_id: mid, amount_due: amount,
            discount: discount, waived: waived, note: note, created_by: admin.id
          });
          stats.created++;
        }
      }

      if (toUpdate.length) dbUpdateMany('Assignments', toUpdate);
      var inserted = toInsert.length ? dbInsertMany('Assignments', toInsert) : [];

      // ผูกกิจกรรมย่อยที่เลือกไว้
      if (chosenItems.length) {
        if (itemsToClear.length) {
          var clearSet = {};
          for (var cs = 0; cs < itemsToClear.length; cs++) clearSet[itemsToClear[cs]] = true;
          var oldLinks = dbWhere('AssignmentItems', function (x) { return clearSet[x.assignment_id]; });
          if (oldLinks.length) dbDeleteMany('AssignmentItems', oldLinks.map(function (x) { return x.id; }));
        }
        var links = [];
        var allTargets = inserted.map(function (a) { return a.id; }).concat(itemsToClear);
        for (var at = 0; at < allTargets.length; at++) {
          for (var it2 = 0; it2 < chosenItems.length; it2++) {
            links.push({
              assignment_id: allTargets[at],
              collection_item_id: chosenItems[it2].id,
              amount: Number(chosenItems[it2].amount) || 0
            });
          }
        }
        if (links.length) dbInsertMany('AssignmentItems', links);
      }

      audit_(admin, 'กำหนดผู้ที่ต้องชำระ', {
        targetType: 'collection', targetId: cid,
        detail: c.code + ': เพิ่ม ' + stats.created + ', แก้ไข ' + stats.updated + ', ข้าม ' + stats.skipped +
          ' (ยอด ' + moneyStr_(amount) + ' บาท/คน)'
      });
      return { created: stats.created, updated: stats.updated, skipped: stats.skipped, amount: amount };
    });
  });
}

function apiUpdateAssignment(payload) {
  return apiCall_('updateAssignment', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var aid = id_(payload.assignment_id);

    return withLock_(function () {
      var a = dbGet('Assignments', aid);
      if (!a) fail_('ไม่พบรายการของสมาชิกรายนี้');

      var amount = payload.amount_due === undefined ? Number(a.amount_due) : money_(payload.amount_due, 0);
      var discount = payload.discount === undefined ? Number(a.discount) : money_(payload.discount, 0);
      var waived = payload.waived === undefined ? a.waived : bool_(payload.waived);

      var sum = paymentSummaryMap_()[aid];
      var approved = sum ? sum.paid : 0;
      if (amount - discount + 0.005 < approved) {
        fail_('ยอดใหม่ (' + moneyStr_(amount - discount) + ' บาท) น้อยกว่ายอดที่ชำระและอนุมัติแล้ว (' + moneyStr_(approved) + ' บาท)');
      }

      dbUpdate('Assignments', aid, {
        amount_due: amount, discount: discount, waived: waived,
        note: payload.note === undefined ? a.note : str_(payload.note, 500)
      });
      audit_(admin, 'แก้ไขยอดที่ต้องชำระ', {
        targetType: 'assignment', targetId: aid,
        detail: 'ยอด ' + moneyStr_(amount) + ' ส่วนลด ' + moneyStr_(discount)
      });
      return { ok: true };
    });
  });
}

function apiRemoveAssignments(payload) {
  return apiCall_('removeAssignments', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var ids = (payload.assignment_ids || []).map(id_).filter(Boolean);
    if (!ids.length) fail_('กรุณาเลือกอย่างน้อย 1 รายการ');

    return withLock_(function () {
      var sums = paymentSummaryMap_();
      var withPayments = 0;
      for (var i = 0; i < ids.length; i++) {
        if (sums[ids[i]] && sums[ids[i]].count > 0) withPayments++;
      }
      if (withPayments > 0 && !bool_(payload.force)) {
        fail_('มี ' + withPayments + ' รายการที่มีการแจ้งชำระแล้ว หากนำออกข้อมูลการชำระจะถูกลบด้วย กรุณายืนยันอีกครั้ง');
      }
      cascadeDeleteAssignments_(ids);
      audit_(admin, 'นำสมาชิกออกจากรายการจัดเก็บ', { detail: 'จำนวน ' + ids.length + ' รายการ' });
      return { count: ids.length };
    });
  });
}

/** รายชื่อสมาชิกที่ยังไม่อยู่ในรายการนี้ */
function apiAvailableMembers(payload) {
  return apiCall_('availableMembers', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var cid = id_(payload.collection_id);
    var q = str_(payload.q, 100).toLowerCase();
    var groupId = id_(payload.group);

    var taken = {};
    var assigns = dbGroupBy('Assignments', 'collection_id')[cid] || [];
    for (var i = 0; i < assigns.length; i++) taken[assigns[i].member_id] = true;

    var groupsIndex = loadTable_('Groups').index;
    var rows = dbAll('Members').filter(function (m) {
      if (!m.is_active || taken[m.id]) return false;
      if (groupId && Number(m.group_id) !== groupId) return false;
      if (q) {
        var name = String((m.prefix || '') + m.first_name + ' ' + m.last_name).toLowerCase();
        if (name.indexOf(q) < 0 && String(m.member_code || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });

    rows.sort(function (a, b) { return String(a.member_code) < String(b.member_code) ? -1 : 1; });

    return {
      members: rows.slice(0, 1000).map(function (m) {
        var g = groupsIndex[m.group_id];
        return {
          id: m.id, member_code: m.member_code,
          full_name: String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim(),
          group_name: g ? g.name : null
        };
      }),
      total: rows.length
    };
  });
}
