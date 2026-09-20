/**
 * ===========================================================================
 *  API ผู้ดูแล: สมาชิกและกลุ่ม/ชั้นเรียน
 * ===========================================================================
 */

function memberView_(m, groupsIndex, showPin, assignCount) {
  var g = groupsIndex[m.group_id];
  return {
    id: m.id,
    member_code: m.member_code,
    prefix: m.prefix,
    first_name: m.first_name,
    last_name: m.last_name,
    full_name: String((m.prefix || '') + m.first_name + ' ' + m.last_name).trim(),
    nickname: m.nickname,
    group_id: m.group_id,
    group_name: g ? g.name : null,
    phone: m.phone,
    email: m.email,
    guardian: m.guardian,
    note: m.note,
    pin_plain: showPin ? m.pin_plain : null,
    is_active: !!m.is_active,
    sort_order: m.sort_order,
    assignment_count: assignCount || 0,
    created_at: iso_(m.created_at)
  };
}

function apiMembers(payload) {
  return apiCall_('members', function () {
    payload = payload || {};
    requireAdmin_(payload.token);

    var q = str_(payload.q, 100).toLowerCase();
    var groupId = id_(payload.group);
    var active = payload.active;
    var page = Math.max(1, num_(payload.page, 1));
    var perPage = Math.min(500, Math.max(10, num_(payload.per_page, 50)));

    var groupsIndex = loadTable_('Groups').index;
    var byMember = dbGroupBy('Assignments', 'member_id');
    var showPin = settingBool('show_pin_to_admin');

    var rows = dbAll('Members').filter(function (m) {
      if (groupId && Number(m.group_id) !== groupId) return false;
      if (active === '1' && !m.is_active) return false;
      if (active === '0' && m.is_active) return false;
      if (q) {
        var name = String((m.prefix || '') + m.first_name + ' ' + m.last_name).toLowerCase();
        if (name.indexOf(q) < 0 &&
            String(m.member_code || '').toLowerCase().indexOf(q) < 0 &&
            String(m.phone || '').toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });

    rows.sort(function (a, b) {
      var ga = groupsIndex[a.group_id] ? groupsIndex[a.group_id].name : '￿';
      var gb = groupsIndex[b.group_id] ? groupsIndex[b.group_id].name : '￿';
      if (ga !== gb) return ga < gb ? -1 : 1;
      return String(a.member_code) < String(b.member_code) ? -1 : 1;
    });

    var total = rows.length;
    var slice = rows.slice((page - 1) * perPage, page * perPage);

    return {
      members: slice.map(function (m) {
        return memberView_(m, groupsIndex, showPin, (byMember[m.id] || []).length);
      }),
      total: total, page: page, per_page: perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      show_pin: showPin
    };
  });
}

function apiMember(payload) {
  return apiCall_('member', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var mid = id_(payload.id);
    var m = dbGet('Members', mid);
    if (!m) fail_('ไม่พบสมาชิกรายนี้');

    var ledger = memberLedger_(mid, { includeDraft: true });
    return {
      member: memberView_(m, loadTable_('Groups').index, settingBool('show_pin_to_admin'), ledger.length),
      ledger: ledger,
      totals: summarize_(ledger)
    };
  });
}

/** หากลุ่มจากชื่อ หรือสร้างใหม่ถ้ายังไม่มี */
function resolveGroup_(name) {
  var n = str_(name, 120);
  if (!n) return null;
  var found = dbFind('Groups', function (g) { return String(g.name) === n; });
  if (found) return found.id;
  return dbInsert('Groups', { name: n, description: '', sort_order: 999, is_active: true }).id;
}

function apiSaveMember(payload) {
  return apiCall_('saveMember', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);

    return withLock_(function () {
      var mid = id_(payload.id);
      var first = str_(payload.first_name, 120);
      var last = str_(payload.last_name, 120);
      if (!first) fail_('กรุณากรอกชื่อ');
      if (!last) fail_('กรุณากรอกนามสกุล');

      var email = str_(payload.email, 160);
      if (email && !isEmail_(email)) fail_('รูปแบบอีเมลไม่ถูกต้อง');

      var groupId = payload.group_id !== undefined && payload.group_id !== ''
        ? id_(payload.group_id)
        : (payload.group_name ? resolveGroup_(payload.group_name) : null);

      if (mid) {
        var existing = dbGet('Members', mid);
        if (!existing) fail_('ไม่พบสมาชิกรายนี้');

        var code = str_(payload.member_code, 40) || existing.member_code;
        if (code !== existing.member_code) {
          var dup = dbFind('Members', function (x) { return x.member_code === code && x.id !== mid; });
          if (dup) fail_('รหัสสมาชิก "' + code + '" ถูกใช้ไปแล้ว');
        }

        dbUpdate('Members', mid, {
          member_code: code,
          prefix: str_(payload.prefix, 40),
          first_name: first,
          last_name: last,
          nickname: str_(payload.nickname, 60),
          group_id: groupId,
          phone: str_(payload.phone, 40),
          email: email,
          guardian: str_(payload.guardian, 160),
          note: str_(payload.note, 500),
          is_active: payload.is_active === undefined ? existing.is_active : bool_(payload.is_active)
        });
        audit_(admin, 'แก้ไขสมาชิก', { targetType: 'member', targetId: mid, detail: code });
        return { id: mid, member_code: code };
      }

      var newCode = str_(payload.member_code, 40);
      if (newCode) {
        var dup2 = dbFind('Members', function (x) { return x.member_code === newCode; });
        if (dup2) fail_('รหัสสมาชิก "' + newCode + '" ถูกใช้ไปแล้ว');
      } else {
        newCode = generateMemberCode_('M');
      }

      var pin = str_(payload.pin, 20) || generatePin_(6);
      var h = makePinHash_(pin);
      var created = dbInsert('Members', {
        member_code: newCode,
        prefix: str_(payload.prefix, 40),
        first_name: first,
        last_name: last,
        nickname: str_(payload.nickname, 60),
        group_id: groupId,
        phone: str_(payload.phone, 40),
        email: email,
        guardian: str_(payload.guardian, 160),
        note: str_(payload.note, 500),
        pin_hash: h.hash,
        pin_salt: h.salt,
        pin_plain: pin,
        is_active: true,
        sort_order: num_(payload.sort_order, 0)
      });

      audit_(admin, 'เพิ่มสมาชิก', { targetType: 'member', targetId: created.id, detail: newCode + ' ' + first + ' ' + last });
      return { id: created.id, member_code: newCode, pin: pin, full_name: String(str_(payload.prefix, 40) + first + ' ' + last).trim() };
    });
  });
}

function apiDeleteMembers(payload) {
  return apiCall_('deleteMembers', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var ids = (payload.ids || []).map(id_).filter(Boolean);
    if (!ids.length) fail_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');

    return withLock_(function () {
      var sums = paymentSummaryMap_();
      var byMember = dbGroupBy('Assignments', 'member_id');

      // ตรวจว่ามีประวัติการชำระที่อนุมัติแล้วหรือไม่
      var blocked = [];
      for (var i = 0; i < ids.length; i++) {
        var assigns = byMember[ids[i]] || [];
        for (var j = 0; j < assigns.length; j++) {
          if (sums[assigns[j].id] && sums[assigns[j].id].paid > 0) {
            var m = dbGet('Members', ids[i]);
            blocked.push(m ? m.member_code : ids[i]);
            break;
          }
        }
      }
      if (blocked.length && !bool_(payload.force)) {
        fail_('มีสมาชิก ' + blocked.length + ' คนที่มีประวัติการชำระเงินแล้ว (เช่น ' +
          blocked.slice(0, 3).join(', ') + ') ระบบแนะนำให้ปิดการใช้งานแทนการลบ เพื่อรักษาประวัติการเงิน');
      }

      // ลบข้อมูลที่เกี่ยวข้องตามลำดับ: การชำระ → กิจกรรมย่อย → รายการที่ต้องชำระ → สมาชิก
      var assignIds = [];
      for (var k = 0; k < ids.length; k++) {
        var list = byMember[ids[k]] || [];
        for (var n = 0; n < list.length; n++) assignIds.push(list[n].id);
      }
      cascadeDeleteAssignments_(assignIds);

      var deleted = dbDeleteMany('Members', ids);
      audit_(admin, 'ลบสมาชิก', { detail: 'จำนวน ' + deleted + ' คน' });
      return { count: deleted };
    });
  });
}

/** ลบรายการที่ต้องชำระพร้อมข้อมูลที่เกี่ยวข้องทั้งหมด */
function cascadeDeleteAssignments_(assignmentIds) {
  if (!assignmentIds || !assignmentIds.length) return;
  var set = {};
  for (var i = 0; i < assignmentIds.length; i++) set[assignmentIds[i]] = true;

  var payIds = [];
  var payments = dbAll('Payments');
  for (var p = 0; p < payments.length; p++) {
    if (set[payments[p].assignment_id]) {
      payIds.push(payments[p].id);
      deleteSlip_(payments[p].slip_file_id);
    }
  }
  if (payIds.length) dbDeleteMany('Payments', payIds);

  var itemIds = [];
  var aitems = dbAll('AssignmentItems');
  for (var a = 0; a < aitems.length; a++) {
    if (set[aitems[a].assignment_id]) itemIds.push(aitems[a].id);
  }
  if (itemIds.length) dbDeleteMany('AssignmentItems', itemIds);

  dbDeleteMany('Assignments', assignmentIds);
}

function apiBulkMemberStatus(payload) {
  return apiCall_('bulkMemberStatus', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var ids = (payload.ids || []).map(id_).filter(Boolean);
    if (!ids.length) fail_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
    var active = bool_(payload.is_active);

    return withLock_(function () {
      var patches = ids.map(function (i) { return { id: i, patch: { is_active: active } }; });
      var n = dbUpdateMany('Members', patches);
      audit_(admin, active ? 'เปิดใช้งานสมาชิก' : 'ปิดใช้งานสมาชิก', { detail: 'จำนวน ' + n + ' คน' });
      return { count: n };
    });
  });
}

function apiBulkMemberGroup(payload) {
  return apiCall_('bulkMemberGroup', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var ids = (payload.ids || []).map(id_).filter(Boolean);
    if (!ids.length) fail_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');

    return withLock_(function () {
      var groupId = payload.group_id ? id_(payload.group_id) : (payload.group_name ? resolveGroup_(payload.group_name) : null);
      var patches = ids.map(function (i) { return { id: i, patch: { group_id: groupId } }; });
      var n = dbUpdateMany('Members', patches);
      audit_(admin, 'ย้ายกลุ่มสมาชิก', { detail: 'จำนวน ' + n + ' คน' });
      return { count: n };
    });
  });
}

/* ------------------------------ รีเซ็ตรหัส PIN ------------------------------ */

function apiResetPin(payload) {
  return apiCall_('resetPin', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);

    return withLock_(function () {
      var targets = [];
      if (payload.ids && payload.ids.length) {
        var ids = payload.ids.map(id_).filter(Boolean);
        for (var i = 0; i < ids.length; i++) {
          var m = dbGet('Members', ids[i]);
          if (m) targets.push(m);
        }
      } else if (payload.group_id) {
        var gid = id_(payload.group_id);
        targets = dbWhere('Members', function (m) { return Number(m.group_id) === gid && m.is_active; });
      } else if (bool_(payload.all)) {
        targets = dbWhere('Members', function (m) { return m.is_active; });
      } else {
        fail_('กรุณาเลือกสมาชิก กลุ่ม หรือระบุว่าต้องการรีเซ็ตทั้งหมด');
      }
      if (!targets.length) fail_('ไม่พบสมาชิกที่ตรงกับเงื่อนไข');
      if (targets.length > 400) fail_('รีเซ็ตได้ครั้งละไม่เกิน 400 คน กรุณาแบ่งเป็นหลายครั้ง');

      var groupsIndex = loadTable_('Groups').index;
      var patches = [];
      var result = [];
      var now = new Date();
      var takenPins = {};

      for (var t = 0; t < targets.length; t++) {
        var pin = generatePin_(6, takenPins);
        var h = makePinHash_(pin);
        patches.push({ id: targets[t].id, patch: { pin_hash: h.hash, pin_salt: h.salt, pin_plain: pin, pin_reset_at: now } });
        var g = groupsIndex[targets[t].group_id];
        result.push({
          id: targets[t].id,
          member_code: targets[t].member_code,
          full_name: String((targets[t].prefix || '') + targets[t].first_name + ' ' + targets[t].last_name).trim(),
          group: g ? g.name : '',
          pin: pin
        });
      }

      dbUpdateMany('Members', patches);
      audit_(admin, 'รีเซ็ตรหัสสมาชิก', { detail: 'จำนวน ' + result.length + ' คน' });
      return { count: result.length, members: result };
    });
  });
}

/* --------------------------- นำเข้าสมาชิกจากไฟล์ --------------------------- */

var IMPORT_COLUMNS = {
  member_code: ['รหัสสมาชิก', 'รหัส', 'เลขประจำตัว', 'เลขประจำตัวนักเรียน', 'membercode', 'code', 'id', 'studentid'],
  prefix: ['คำนำหน้า', 'คํานําหน้า', 'prefix', 'title'],
  first_name: ['ชื่อ', 'ชื่อจริง', 'firstname', 'fname', 'givenname'],
  last_name: ['นามสกุล', 'สกุล', 'lastname', 'lname', 'surname', 'familyname'],
  full_name: ['ชื่อสกุล', 'ชื่อนามสกุล', 'fullname', 'name'],
  group_name: ['กลุ่ม', 'ชั้น', 'ชั้นเรียน', 'ห้อง', 'ระดับชั้น', 'กลุ่มชั้น', 'group', 'class', 'room', 'level'],
  phone: ['เบอร์โทร', 'โทรศัพท์', 'เบอร์โทรศัพท์', 'เบอร์', 'phone', 'tel', 'mobile'],
  email: ['อีเมล', 'email', 'mail'],
  guardian: ['ผู้ปกครอง', 'ชื่อผู้ปกครอง', 'guardian', 'parent'],
  note: ['หมายเหตุ', 'note', 'remark', 'comment']
};

function normalizeHeader_(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s._\-\/]/g, '');
}

var NAME_PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'นางสาว', 'นาย', 'นาง', 'ด.ช.', 'ด.ญ.', 'น.ส.', 'ดช.', 'ดญ.'];

function splitFullName_(full) {
  var s = String(full || '').trim().replace(/\s+/g, ' ');
  var prefix = '';
  for (var i = 0; i < NAME_PREFIXES.length; i++) {
    if (s.indexOf(NAME_PREFIXES[i]) === 0) {
      prefix = NAME_PREFIXES[i];
      s = s.substring(NAME_PREFIXES[i].length).trim();
      break;
    }
  }
  var parts = s.split(' ');
  var first = parts.shift() || '';
  return { prefix: prefix, first_name: first, last_name: parts.join(' ') };
}

/**
 * นำเข้าสมาชิกจากตารางข้อมูล (array ของ array)
 * ฝั่งเบราว์เซอร์จะอ่านไฟล์ CSV/Excel แล้วส่งมาเป็นตารางแล้ว
 * จึงรองรับได้ทั้ง .csv, .xlsx และการคัดลอกวางจากตาราง
 */
function apiImportMembers(payload) {
  return apiCall_('importMembers', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var table = payload.rows;
    if (!table || !table.length) fail_('ไม่พบข้อมูลในไฟล์');

    var dryRun = bool_(payload.dry_run);
    var updateExisting = bool_(payload.update_existing);
    var defaultGroupId = id_(payload.group_id);

    // หาแถวหัวตาราง (ภายใน 10 แถวแรก)
    var headerRow = -1;
    var idx = {};
    for (var r = 0; r < Math.min(10, table.length); r++) {
      var cand = {};
      for (var c = 0; c < table[r].length; c++) {
        var n = normalizeHeader_(table[r][c]);
        if (!n) continue;
        for (var field in IMPORT_COLUMNS) {
          if (!Object.prototype.hasOwnProperty.call(IMPORT_COLUMNS, field)) continue;
          if (cand[field] !== undefined) continue;
          var aliases = IMPORT_COLUMNS[field];
          for (var al = 0; al < aliases.length; al++) {
            if (normalizeHeader_(aliases[al]) === n) { cand[field] = c; break; }
          }
        }
      }
      var score = 0;
      ['first_name', 'last_name', 'full_name', 'member_code'].forEach(function (k) {
        if (cand[k] !== undefined) score++;
      });
      if (score >= 1) { headerRow = r; idx = cand; break; }
    }
    if (headerRow === -1) {
      fail_('ไม่พบหัวตารางที่ระบบรู้จัก กรุณาใช้หัวคอลัมน์ เช่น "รหัสสมาชิก, คำนำหน้า, ชื่อ, นามสกุล, กลุ่ม, เบอร์โทร" หรือดาวน์โหลดไฟล์ต้นแบบจากระบบ');
    }

    function cell(row, field) {
      return idx[field] === undefined ? '' : str_(row[idx[field]], 300);
    }

    return withLock_(function () {
      var existingByCode = {};
      var existingByName = {};
      var allMembers = dbAll('Members');
      for (var i = 0; i < allMembers.length; i++) {
        existingByCode[String(allMembers[i].member_code).toLowerCase()] = allMembers[i];
        existingByName[String(allMembers[i].first_name) + '|' + String(allMembers[i].last_name)] = allMembers[i];
      }

      var result = { created: 0, updated: 0, skipped: 0, errors: [], preview: [], credentials: [] };
      var seen = {};
      var toInsert = [];
      var toUpdate = [];
      var usedCodes = {};
      var usedPins = {};
      for (var uc in existingByCode) if (Object.prototype.hasOwnProperty.call(existingByCode, uc)) usedCodes[uc] = true;

      for (var rr = headerRow + 1; rr < table.length; rr++) {
        var row = table[rr];
        if (!row) continue;
        var isEmpty = true;
        for (var ec = 0; ec < row.length; ec++) if (str_(row[ec])) { isEmpty = false; break; }
        if (isEmpty) continue;

        var lineNo = rr + 1;
        var prefix = cell(row, 'prefix');
        var first = cell(row, 'first_name');
        var last = cell(row, 'last_name');
        var full = cell(row, 'full_name');

        if ((!first || !last) && full) {
          var sp = splitFullName_(full);
          prefix = prefix || sp.prefix;
          first = first || sp.first_name;
          last = last || sp.last_name;
        }
        if (!first || !last) {
          result.errors.push({ line: lineNo, message: 'ข้อมูลชื่อหรือนามสกุลไม่ครบ' });
          result.skipped++;
          continue;
        }

        var code = cell(row, 'member_code');
        var key = (code || (first + '|' + last)).toLowerCase();
        if (seen[key]) {
          result.errors.push({ line: lineNo, message: 'ข้อมูลซ้ำในไฟล์: ' + (code || first + ' ' + last) });
          result.skipped++;
          continue;
        }
        seen[key] = true;

        var groupName = cell(row, 'group_name');
        var groupId = groupName ? (dryRun ? -1 : resolveGroup_(groupName)) : defaultGroupId;

        var existing = code ? existingByCode[code.toLowerCase()] : existingByName[first + '|' + last];

        if (existing) {
          if (!updateExisting) {
            result.skipped++;
            result.preview.push({ line: lineNo, action: 'ข้าม (มีอยู่แล้ว)', member_code: existing.member_code, name: first + ' ' + last, group: groupName });
            continue;
          }
          toUpdate.push({
            id: existing.id,
            patch: {
              prefix: prefix || existing.prefix,
              first_name: first,
              last_name: last,
              group_id: groupId && groupId > 0 ? groupId : existing.group_id,
              phone: cell(row, 'phone') || existing.phone,
              email: cell(row, 'email') || existing.email,
              guardian: cell(row, 'guardian') || existing.guardian,
              note: cell(row, 'note') || existing.note
            }
          });
          result.updated++;
          result.preview.push({ line: lineNo, action: 'อัปเดต', member_code: existing.member_code, name: first + ' ' + last, group: groupName });
          continue;
        }

        var newCode = code;
        if (!newCode) {
          newCode = generateMemberCode_('M', usedCodes);
          // เผื่อรหัสชนกันภายในไฟล์เดียวกัน
          while (usedCodes[newCode.toLowerCase()]) {
            newCode = 'M' + padStart_(String(parseInt(newCode.substring(1), 10) + 1), 4, '0');
          }
        }
        usedCodes[newCode.toLowerCase()] = true;

        var pin = generatePin_(6, usedPins);
        var h = makePinHash_(pin);
        toInsert.push({
          member_code: newCode, prefix: prefix, first_name: first, last_name: last,
          group_id: groupId && groupId > 0 ? groupId : null,
          phone: cell(row, 'phone'), email: cell(row, 'email'),
          guardian: cell(row, 'guardian'), note: cell(row, 'note'),
          pin_hash: h.hash, pin_salt: h.salt, pin_plain: pin,
          is_active: true, sort_order: 0
        });
        result.credentials.push({
          member_code: newCode,
          full_name: String(prefix + first + ' ' + last).trim(),
          group: groupName || '', pin: pin
        });
        result.created++;
        result.preview.push({ line: lineNo, action: 'เพิ่มใหม่', member_code: newCode, name: first + ' ' + last, group: groupName });
      }

      if (dryRun) {
        result.credentials = [];
        return { dry_run: true, total_rows: table.length - headerRow - 1, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors, preview: result.preview.slice(0, 200), credentials: [] };
      }

      if (toInsert.length) dbInsertMany('Members', toInsert);
      if (toUpdate.length) dbUpdateMany('Members', toUpdate);

      audit_(admin, 'นำเข้าสมาชิกจากไฟล์', {
        detail: 'เพิ่ม ' + result.created + ', อัปเดต ' + result.updated + ', ข้าม ' + result.skipped
      });

      return {
        dry_run: false,
        total_rows: table.length - headerRow - 1,
        created: result.created, updated: result.updated, skipped: result.skipped,
        errors: result.errors, preview: result.preview.slice(0, 200),
        credentials: result.credentials
      };
    });
  });
}

/* ================================ กลุ่ม ================================ */

function apiGroups(payload) {
  return apiCall_('groups', function () {
    payload = payload || {};
    requireAdmin_(payload.token);
    var byGroup = dbGroupBy('Members', 'group_id');
    var rows = dbAll('Groups').map(function (g) {
      var members = byGroup[g.id] || [];
      var active = 0;
      for (var i = 0; i < members.length; i++) if (members[i].is_active) active++;
      return {
        id: g.id, name: g.name, description: g.description,
        sort_order: g.sort_order, is_active: !!g.is_active,
        member_count: active, member_total: members.length
      };
    });
    rows.sort(function (a, b) {
      if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
      return String(a.name) < String(b.name) ? -1 : 1;
    });
    return { groups: rows };
  });
}

function apiSaveGroup(payload) {
  return apiCall_('saveGroup', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var name = str_(payload.name, 120);
    if (!name) fail_('กรุณาระบุชื่อกลุ่ม');

    return withLock_(function () {
      var gid = id_(payload.id);
      var dup = dbFind('Groups', function (g) { return String(g.name) === name && g.id !== gid; });
      if (dup) fail_('มีกลุ่มชื่อ "' + name + '" อยู่แล้ว');

      if (gid) {
        var existing = dbGet('Groups', gid);
        if (!existing) fail_('ไม่พบกลุ่มนี้');
        dbUpdate('Groups', gid, {
          name: name,
          description: str_(payload.description, 255),
          sort_order: num_(payload.sort_order, existing.sort_order),
          is_active: payload.is_active === undefined ? existing.is_active : bool_(payload.is_active)
        });
        audit_(admin, 'แก้ไขกลุ่ม', { targetType: 'group', targetId: gid, detail: name });
        return { id: gid };
      }

      var created = dbInsert('Groups', {
        name: name, description: str_(payload.description, 255),
        sort_order: num_(payload.sort_order, 0), is_active: true
      });
      audit_(admin, 'เพิ่มกลุ่ม', { targetType: 'group', targetId: created.id, detail: name });
      return { id: created.id };
    });
  });
}

function apiDeleteGroup(payload) {
  return apiCall_('deleteGroup', function () {
    payload = payload || {};
    var admin = requireWrite_(payload.token);
    var gid = id_(payload.id);

    return withLock_(function () {
      var g = dbGet('Groups', gid);
      if (!g) fail_('ไม่พบกลุ่มนี้');

      // ย้ายสมาชิกออกจากกลุ่ม (ไม่ลบสมาชิก)
      var members = dbWhere('Members', function (m) { return Number(m.group_id) === gid; });
      if (members.length) {
        dbUpdateMany('Members', members.map(function (m) { return { id: m.id, patch: { group_id: '' } }; }));
      }
      dbDelete('Groups', gid);
      audit_(admin, 'ลบกลุ่ม', { targetType: 'group', targetId: gid, detail: g.name + ' (ย้ายสมาชิกออก ' + members.length + ' คน)' });
      return { moved_members: members.length };
    });
  });
}
