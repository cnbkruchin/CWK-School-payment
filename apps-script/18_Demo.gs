/**
 * ===========================================================================
 *  สร้างข้อมูลตัวอย่างสำหรับทดลองใช้งาน
 *  เรียกจากเมนู "ระบบแจ้งชำระเงิน → สร้างข้อมูลตัวอย่าง"
 * ===========================================================================
 */

var DEMO_GROUPS = ['ม.1/1', 'ม.2/1', 'ม.3/1', 'ม.4/1', 'ม.5/1', 'ม.6/1', 'คณะครูและบุคลากร'];
var DEMO_FIRST_M = ['สมชาย', 'อนุชา', 'ธนกฤต', 'ภูวดล', 'กิตติพงษ์', 'ณัฐวุฒิ', 'วีรภัทร', 'ศุภกร', 'ปิยะ', 'ชัยวัฒน์'];
var DEMO_FIRST_F = ['สมหญิง', 'กนกวรรณ', 'ณัฐชา', 'พิมพ์ชนก', 'สุภาพร', 'ชนิดา', 'วรรณิษา', 'อรอุมา', 'ปาริชาติ', 'ธิดารัตน์'];
var DEMO_LAST = ['ใจดี', 'รักเรียน', 'ตั้งใจเรียน', 'ศรีสุข', 'บุญมี', 'ทองดี', 'แก้วมณี', 'พรหมมา', 'สุขสวัสดิ์', 'วงศ์คำ'];

function demoPick_(arr, i) { return arr[i % arr.length]; }

/** สร้างข้อมูลตัวอย่าง (ปลอดภัย: จะไม่ทำงานหากมีสมาชิกอยู่แล้ว) */
function seedDemoData() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { /* รันจากหน้าต่างสคริปต์ */ }

  if (dbAll('Members').length > 0) {
    var msg = 'ฐานข้อมูลมีข้อมูลสมาชิกอยู่แล้ว ระบบจึงไม่สร้างข้อมูลตัวอย่างทับ\n\n' +
      'หากต้องการเริ่มใหม่ กรุณาลบข้อมูลในชีต Members, Collections, Assignments และ Payments ก่อน';
    if (ui) ui.alert('ไม่ได้สร้างข้อมูลตัวอย่าง', msg, ui.ButtonSet.OK);
    else Logger.log(msg);
    return { created: false };
  }

  var result = seedDemoSilent_();
  var lines = [
    '✅ สร้างข้อมูลตัวอย่างเรียบร้อยแล้ว',
    '',
    'สมาชิก           : ' + result.members + ' คน',
    'รายการจัดเก็บ    : ' + result.collections + ' รายการ',
    'ผู้ที่ต้องชำระ   : ' + result.assignments + ' รายการ',
    'การแจ้งชำระ      : ' + result.payments + ' รายการ',
    '',
    'ตัวอย่างสำหรับทดลอง:',
    '  รหัสสมาชิก : ' + result.sample_code,
    '  รหัส PIN   : ' + result.sample_pin
  ];
  if (result.sample_ref) lines.push('  เลขอ้างอิง : ' + result.sample_ref);

  if (ui) ui.alert('สร้างข้อมูลตัวอย่าง', lines.join('\n'), ui.ButtonSet.OK);
  else Logger.log(lines.join('\n'));
  return result;
}

function seedDemoSilent_(opts) {
  opts = opts || {};
  var perGroup = opts.perGroup || 8;
  var admin = dbAll('Admins')[0];
  if (!admin) fail_('ยังไม่มีบัญชีผู้ดูแลระบบ กรุณาติดตั้งระบบก่อน');

  return withLock_(function () {
    settingsSet({
      school_address: '123 หมู่ 4 อำเภอจุน จังหวัดพะเยา',
      school_phone: '054-123456'
    });

    if (!dbAll('BankAccounts').length) {
      dbInsertMany('BankAccounts', [
        { bank_name: 'ธนาคารกรุงไทย', account_name: 'โรงเรียนจุนวิทยาคม', account_number: '123-4-56789-0',
          branch: 'สาขาจุน', promptpay_id: '0812345678', is_default: true, is_active: true, sort_order: 0 },
        { bank_name: 'ธนาคารออมสิน', account_name: 'โรงเรียนจุนวิทยาคม (กิจกรรม)', account_number: '020-1-23456-7',
          branch: 'สาขาจุน', promptpay_id: '', is_default: false, is_active: true, sort_order: 1 }
      ]);
    }

    // กลุ่ม
    var existingGroups = {};
    dbAll('Groups').forEach(function (g) { existingGroups[g.name] = g.id; });
    var newGroups = [];
    DEMO_GROUPS.forEach(function (n, i) {
      if (!existingGroups[n]) newGroups.push({ name: n, description: '', sort_order: i, is_active: true });
    });
    if (newGroups.length) {
      dbInsertMany('Groups', newGroups).forEach(function (g) { existingGroups[g.name] = g.id; });
    }

    // สมาชิก
    var members = [];
    var seq = 1;
    DEMO_GROUPS.forEach(function (gname, gi) {
      var isStaff = gname.indexOf('ครู') >= 0;
      var count = isStaff ? 5 : perGroup;
      for (var i = 0; i < count; i++) {
        var male = (seq % 2) === 0;
        var prefix = isStaff ? (male ? 'นาย' : 'นาง') : (gi >= 3 ? (male ? 'นาย' : 'นางสาว') : (male ? 'เด็กชาย' : 'เด็กหญิง'));
        var first = male ? demoPick_(DEMO_FIRST_M, seq) : demoPick_(DEMO_FIRST_F, seq);
        var last = demoPick_(DEMO_LAST, seq * 3 + gi);
        var pin = generatePin_(6);
        var h = makePinHash_(pin);
        members.push({
          member_code: 'M' + padStart_(String(seq), 4, '0'),
          prefix: prefix, first_name: first, last_name: last,
          group_id: existingGroups[gname],
          phone: '08' + padStart_(String((seq * 1234567) % 100000000), 8, '0'),
          guardian: isStaff ? '' : (male ? 'นาย' : 'นาง') + demoPick_(DEMO_FIRST_M, seq + 3) + ' ' + last,
          pin_hash: h.hash, pin_salt: h.salt, pin_plain: pin,
          is_active: true, sort_order: i
        });
        seq++;
      }
    });
    var createdMembers = dbInsertMany('Members', members);

    function daysFromNow(n) {
      return Utilities.formatDate(new Date(Date.now() + n * 86400000), APP.TZ, 'yyyy-MM-dd');
    }

    // รายการจัดเก็บ
    var defs = [
      { name: 'เงินบำรุงการศึกษา ภาคเรียนที่ 1/2569', desc: 'ค่าบำรุงการศึกษาและกิจกรรมพัฒนาผู้เรียน',
        term: '1', due: daysFromNow(20), status: 'open', partial: true, target: 'all',
        items: [['ค่าบำรุงการศึกษา', 1200, false], ['ค่าประกันอุบัติเหตุนักเรียน', 300, false],
                ['ค่าสาธารณูปโภค', 200, false], ['ค่าเรียนเสริมพิเศษวันเสาร์', 500, true]] },
      { name: 'เงินค่าเครื่องแบบและอุปกรณ์การเรียน', desc: 'ชุดนักเรียน ชุดพละ และอุปกรณ์การเรียนประจำปี',
        term: '1', due: daysFromNow(5), status: 'open', partial: false, target: 'students',
        items: [['ชุดนักเรียน 2 ชุด', 700, false], ['ชุดพลศึกษา', 350, false], ['กระเป๋านักเรียน', 250, false]] },
      { name: 'เงินกิจกรรมทัศนศึกษา ม.ปลาย', desc: 'ทัศนศึกษาแหล่งเรียนรู้ สำหรับนักเรียนชั้น ม.4-ม.6',
        term: '1', due: daysFromNow(-8), status: 'open', partial: false, target: 'upper',
        items: [['ค่ารถโดยสาร', 450, false], ['ค่าอาหารและที่พัก', 800, false], ['ค่าเข้าชมสถานที่', 150, false]] },
      { name: 'เงินสนับสนุนกิจกรรมกีฬาสี (ฉบับร่าง)', desc: 'ยังไม่เปิดรับชำระ — อยู่ระหว่างเตรียมการ',
        term: '1', due: daysFromNow(45), status: 'draft', partial: false, target: 'none',
        items: [['ค่าเสื้อกีฬาสี', 180, false], ['ค่าอุปกรณ์กีฬา', 120, false]] }
    ];

    var totalAssignments = 0;
    var sampleRef = null;
    var payCount = 0;

    defs.forEach(function (def, di) {
      var base = 0;
      def.items.forEach(function (it) { if (!it[2]) base += it[1]; });

      var col = dbInsert('Collections', {
        code: generateCollectionCode_(), name: def.name, description: def.desc,
        fiscal_year: '2569', term: def.term, default_amount: base, due_date: def.due,
        allow_partial: def.partial, status: 'draft', is_public: true, created_by: admin.id
      });

      dbInsertMany('CollectionItems', def.items.map(function (it, i) {
        return { collection_id: col.id, name: it[0], description: '', amount: it[1], is_optional: it[2], sort_order: i };
      }));

      if (def.target === 'none') return;

      var targets = createdMembers.filter(function (m) {
        if (def.target === 'all') return true;
        var gname = null;
        for (var k in existingGroups) if (existingGroups[k] === m.group_id) gname = k;
        if (def.target === 'students') return gname && gname.indexOf('ครู') < 0;
        if (def.target === 'upper') return gname && ['ม.4/1', 'ม.5/1', 'ม.6/1'].indexOf(gname) >= 0;
        return false;
      });

      var assigns = dbInsertMany('Assignments', targets.map(function (m, i) {
        return {
          collection_id: col.id, member_id: m.id, amount_due: base, discount: 0,
          waived: (i % 29 === 7), note: '', created_by: admin.id
        };
      }));
      totalAssignments += assigns.length;

      // สร้างการแจ้งชำระให้หลากหลายสถานะ
      var payments = [];
      assigns.forEach(function (a, i) {
        if (a.waived) return;
        var kind = (i + di) % 5;   // 0,1=อนุมัติ 2=รอตรวจสอบ 3=ไม่ผ่าน 4=ยังไม่ชำระ
        if (kind === 4) return;
        var created = new Date(Date.now() - ((i % 20) + 1) * 86400000);
        var status = kind <= 1 ? 'approved' : kind === 2 ? 'pending' : 'rejected';
        var ref = generateRefCode_() + '';
        // เลขอ้างอิงต้องไม่ซ้ำ — ตรวจกับรายการที่กำลังจะเพิ่มด้วย
        var dup = false;
        for (var pz = 0; pz < payments.length; pz++) if (payments[pz].ref_code === ref) dup = true;
        if (dup) return;

        payments.push({
          ref_code: ref, assignment_id: a.id, amount: base, method: 'transfer',
          payer_name: '', transferred_at: created, bank_account_id: '',
          slip_file_id: '', slip_mime: '', slip_size: 0, slip_hash: '',
          note: 'ข้อมูลตัวอย่าง (ไม่มีไฟล์สลิป)',
          status: status,
          reject_reason: status === 'rejected' ? 'สลิปไม่ชัดเจน อ่านไม่ออก' : '',
          verified_by: status === 'pending' ? '' : admin.id,
          verified_at: status === 'pending' ? '' : created,
          receipt_no: status === 'approved' ? nextReceiptNo_() : '',
          created_at: created, updated_at: created
        });
        if (status === 'approved' && !sampleRef) sampleRef = ref;
      });
      if (payments.length) {
        dbInsertMany('Payments', payments);
        payCount += payments.length;
      }

      dbUpdate('Collections', col.id, { status: def.status });
    });

    audit_(null, 'สร้างข้อมูลตัวอย่าง', {
      actorType: 'system', actorName: 'ระบบ',
      detail: 'สมาชิก ' + createdMembers.length + ' คน • รายการจัดเก็บ ' + defs.length + ' รายการ'
    });

    return {
      created: true,
      members: createdMembers.length,
      collections: defs.length,
      assignments: totalAssignments,
      payments: payCount,
      sample_code: createdMembers[0].member_code,
      sample_pin: createdMembers[0].pin_plain,
      sample_ref: sampleRef
    };
  });
}
