/**
 * ===========================================================================
 *  ระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ — โรงเรียนจุนวิทยาคม
 *  Google Apps Script + Google Sheets
 *
 *  ไฟล์นี้: ค่าคงที่และโครงสร้างตารางทั้งหมดของระบบ
 * ===========================================================================
 */

var APP = {
  NAME: 'ระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ',
  VERSION: '1.0.0',
  TZ: 'Asia/Bangkok',

  // อายุเซสชันผู้ดูแล (มิลลิวินาที) — 6 ชั่วโมง (เท่ากับอายุสูงสุดของ CacheService)
  SESSION_TTL_MS: 6 * 60 * 60 * 1000,

  // อายุลิงก์รีเซ็ตรหัสผ่าน (นาที)
  RESET_TTL_MIN: 30,

  // ความปลอดภัยการเข้าสู่ระบบ
  MAX_FAILED_LOGIN: 5,
  LOCK_MINUTES: 15,

  // จำนวนรอบการเข้ารหัสรหัสผ่าน (PBKDF2-HMAC-SHA256)
  // ค่าสูงขึ้น = ปลอดภัยขึ้นแต่ช้าลง — 6,000 รอบใช้เวลาราว 0.4-0.8 วินาทีบน Apps Script
  PBKDF2_ITERATIONS: 6000,
  PBKDF2_ITERATIONS_PIN: 2500,

  // ขนาดไฟล์สลิปสูงสุด (ไบต์) — 5 MB เพื่อให้ส่งผ่าน google.script.run ได้รวดเร็ว
  MAX_SLIP_BYTES: 5 * 1024 * 1024,

  // ชื่อโฟลเดอร์ใน Google Drive
  FOLDER_ROOT: 'ระบบแจ้งชำระเงิน - โรงเรียนจุนวิทยาคม',
  FOLDER_SLIPS: 'สลิปการโอนเงิน',
  FOLDER_REPORTS: 'รายงาน',
  FOLDER_BRANDING: 'ตราโรงเรียน',

  // เวลารอ LockService (มิลลิวินาที)
  LOCK_WAIT_MS: 25000,

  // อายุแคช (วินาที) — สูงสุดที่ CacheService รองรับคือ 21600
  CACHE_TTL_SEC: 21600,
  CACHE_CHUNK_BYTES: 90000
};

/** ชื่อคีย์ใน PropertiesService */
var PROP = {
  DATA_VERSION: 'DATA_VERSION',   // ตัวนับเวอร์ชันของแต่ละตาราง (JSON) ใช้ล้างแคชอัตโนมัติ
  SEQUENCES: 'SEQUENCES',         // ตัวนับ id ของแต่ละตาราง (JSON)
  PEPPER: 'PEPPER',               // กุญแจลับเสริมสำหรับการเข้ารหัสรหัสผ่าน
  FOLDER_IDS: 'FOLDER_IDS',       // id ของโฟลเดอร์ Drive (JSON)
  INSTALLED_AT: 'INSTALLED_AT'
};

/**
 * โครงสร้างตารางทั้งหมด
 *   type: 'number' | 'string' | 'bool' | 'date' | 'datetime'
 * ลำดับคอลัมน์ในนี้คือลำดับคอลัมน์จริงในชีต — ห้ามสลับตำแหน่งหลังติดตั้งแล้ว
 */
var SCHEMA = {

  Settings: {
    sheet: 'Settings',
    title: 'ตั้งค่าระบบ',
    idField: null,
    columns: [
      { key: 'key',        header: 'คีย์',           type: 'string', width: 220 },
      { key: 'value',      header: 'ค่า',            type: 'string', width: 420 },
      { key: 'updated_at', header: 'แก้ไขล่าสุด',    type: 'datetime', width: 160 }
    ]
  },

  Admins: {
    sheet: 'Admins',
    title: 'ผู้ดูแลระบบ',
    columns: [
      { key: 'id',              header: 'ID',                type: 'number', width: 60 },
      { key: 'username',        header: 'ชื่อผู้ใช้',        type: 'string', width: 140 },
      { key: 'email',           header: 'อีเมล',             type: 'string', width: 220 },
      { key: 'full_name',       header: 'ชื่อ-สกุล',         type: 'string', width: 200 },
      { key: 'password_hash',   header: 'รหัสผ่าน (เข้ารหัส)', type: 'string', width: 150 },
      { key: 'password_salt',   header: 'salt',              type: 'string', width: 120 },
      { key: 'role',            header: 'สิทธิ์',            type: 'string', width: 110 },
      { key: 'phone',           header: 'เบอร์โทร',          type: 'string', width: 120 },
      { key: 'is_active',       header: 'ใช้งาน',            type: 'bool',   width: 80 },
      { key: 'must_change_pw',  header: 'ต้องเปลี่ยนรหัสผ่าน', type: 'bool', width: 100 },
      { key: 'failed_attempts', header: 'เข้าผิดกี่ครั้ง',   type: 'number', width: 100 },
      { key: 'locked_until',    header: 'ล็อกถึง',           type: 'datetime', width: 150 },
      { key: 'last_login_at',   header: 'เข้าใช้ล่าสุด',     type: 'datetime', width: 150 },
      { key: 'created_at',      header: 'สร้างเมื่อ',        type: 'datetime', width: 150 },
      { key: 'updated_at',      header: 'แก้ไขเมื่อ',        type: 'datetime', width: 150 }
    ]
  },

  Sessions: {
    sheet: 'Sessions',
    title: 'เซสชันผู้ดูแล',
    columns: [
      { key: 'id',         header: 'ID',          type: 'number', width: 60 },
      { key: 'token_hash', header: 'โทเคน',       type: 'string', width: 200 },
      { key: 'admin_id',   header: 'ผู้ดูแล',     type: 'number', width: 80 },
      { key: 'expires_at', header: 'หมดอายุ',     type: 'datetime', width: 160 },
      { key: 'created_at', header: 'สร้างเมื่อ',  type: 'datetime', width: 160 }
    ]
  },

  PasswordResets: {
    sheet: 'PasswordResets',
    title: 'คำขอรีเซ็ตรหัสผ่าน',
    columns: [
      { key: 'id',         header: 'ID',         type: 'number', width: 60 },
      { key: 'admin_id',   header: 'ผู้ดูแล',    type: 'number', width: 80 },
      { key: 'email',      header: 'อีเมล',      type: 'string', width: 220 },
      { key: 'token_hash', header: 'โทเคน',      type: 'string', width: 200 },
      { key: 'expires_at', header: 'หมดอายุ',    type: 'datetime', width: 160 },
      { key: 'used_at',    header: 'ใช้เมื่อ',   type: 'datetime', width: 160 },
      { key: 'created_at', header: 'สร้างเมื่อ', type: 'datetime', width: 160 }
    ]
  },

  Groups: {
    sheet: 'Groups',
    title: 'กลุ่ม/ชั้นเรียน',
    columns: [
      { key: 'id',          header: 'ID',           type: 'number', width: 60 },
      { key: 'name',        header: 'ชื่อกลุ่ม',    type: 'string', width: 180 },
      { key: 'description', header: 'รายละเอียด',   type: 'string', width: 260 },
      { key: 'sort_order',  header: 'ลำดับ',        type: 'number', width: 70 },
      { key: 'is_active',   header: 'ใช้งาน',       type: 'bool',   width: 80 },
      { key: 'created_at',  header: 'สร้างเมื่อ',   type: 'datetime', width: 150 }
    ]
  },

  Members: {
    sheet: 'Members',
    title: 'สมาชิก',
    columns: [
      { key: 'id',           header: 'ID',              type: 'number', width: 60 },
      { key: 'member_code',  header: 'รหัสสมาชิก',      type: 'string', width: 120 },
      { key: 'prefix',       header: 'คำนำหน้า',        type: 'string', width: 100 },
      { key: 'first_name',   header: 'ชื่อ',            type: 'string', width: 140 },
      { key: 'last_name',    header: 'นามสกุล',         type: 'string', width: 160 },
      { key: 'nickname',     header: 'ชื่อเล่น',        type: 'string', width: 100 },
      { key: 'group_id',     header: 'กลุ่ม',           type: 'number', width: 80 },
      { key: 'phone',        header: 'เบอร์โทร',        type: 'string', width: 120 },
      { key: 'email',        header: 'อีเมล',           type: 'string', width: 200 },
      { key: 'guardian',     header: 'ผู้ปกครอง',       type: 'string', width: 180 },
      { key: 'note',         header: 'หมายเหตุ',        type: 'string', width: 200 },
      { key: 'pin_hash',     header: 'PIN (เข้ารหัส)',  type: 'string', width: 150 },
      { key: 'pin_salt',     header: 'salt',            type: 'string', width: 120 },
      { key: 'pin_plain',    header: 'PIN',             type: 'string', width: 90 },
      { key: 'pin_reset_at', header: 'รีเซ็ต PIN เมื่อ', type: 'datetime', width: 150 },
      { key: 'is_active',    header: 'ใช้งาน',          type: 'bool',   width: 80 },
      { key: 'sort_order',   header: 'ลำดับ',           type: 'number', width: 70 },
      { key: 'created_at',   header: 'สร้างเมื่อ',      type: 'datetime', width: 150 },
      { key: 'updated_at',   header: 'แก้ไขเมื่อ',      type: 'datetime', width: 150 }
    ]
  },

  Collections: {
    sheet: 'Collections',
    title: 'รายการจัดเก็บ',
    columns: [
      { key: 'id',             header: 'ID',                    type: 'number', width: 60 },
      { key: 'code',           header: 'รหัสรายการ',            type: 'string', width: 130 },
      { key: 'name',           header: 'วัตถุประสงค์การจัดเก็บ', type: 'string', width: 320 },
      { key: 'description',    header: 'รายละเอียด',            type: 'string', width: 320 },
      { key: 'fiscal_year',    header: 'ปีการศึกษา',            type: 'string', width: 100 },
      { key: 'term',           header: 'ภาคเรียน',              type: 'string', width: 90 },
      { key: 'default_amount', header: 'ยอดตั้งต้น',            type: 'number', width: 110 },
      { key: 'due_date',       header: 'กำหนดชำระ',             type: 'date',   width: 120 },
      { key: 'allow_partial',  header: 'ผ่อนชำระได้',           type: 'bool',   width: 100 },
      { key: 'status',         header: 'สถานะ',                 type: 'string', width: 100 },
      { key: 'is_public',      header: 'แสดงสาธารณะ',           type: 'bool',   width: 100 },
      { key: 'created_by',     header: 'ผู้สร้าง',              type: 'number', width: 80 },
      { key: 'created_at',     header: 'สร้างเมื่อ',            type: 'datetime', width: 150 },
      { key: 'updated_at',     header: 'แก้ไขเมื่อ',            type: 'datetime', width: 150 }
    ]
  },

  CollectionItems: {
    sheet: 'CollectionItems',
    title: 'กิจกรรมย่อย',
    columns: [
      { key: 'id',            header: 'ID',            type: 'number', width: 60 },
      { key: 'collection_id', header: 'รายการจัดเก็บ', type: 'number', width: 110 },
      { key: 'name',          header: 'ชื่อกิจกรรมย่อย', type: 'string', width: 280 },
      { key: 'description',   header: 'รายละเอียด',    type: 'string', width: 260 },
      { key: 'amount',        header: 'จำนวนเงิน',     type: 'number', width: 110 },
      { key: 'is_optional',   header: 'เลือกได้',      type: 'bool',   width: 90 },
      { key: 'sort_order',    header: 'ลำดับ',         type: 'number', width: 70 },
      { key: 'created_at',    header: 'สร้างเมื่อ',    type: 'datetime', width: 150 }
    ]
  },

  Assignments: {
    sheet: 'Assignments',
    title: 'ผู้ที่ต้องชำระ',
    columns: [
      { key: 'id',            header: 'ID',            type: 'number', width: 60 },
      { key: 'collection_id', header: 'รายการจัดเก็บ', type: 'number', width: 110 },
      { key: 'member_id',     header: 'สมาชิก',        type: 'number', width: 90 },
      { key: 'amount_due',    header: 'ยอดที่ต้องชำระ', type: 'number', width: 120 },
      { key: 'discount',      header: 'ส่วนลด',        type: 'number', width: 100 },
      { key: 'waived',        header: 'ยกเว้น',        type: 'bool',   width: 80 },
      { key: 'note',          header: 'หมายเหตุ',      type: 'string', width: 200 },
      { key: 'created_by',    header: 'ผู้สร้าง',      type: 'number', width: 80 },
      { key: 'created_at',    header: 'สร้างเมื่อ',    type: 'datetime', width: 150 },
      { key: 'updated_at',    header: 'แก้ไขเมื่อ',    type: 'datetime', width: 150 }
    ]
  },

  AssignmentItems: {
    sheet: 'AssignmentItems',
    title: 'กิจกรรมย่อยรายบุคคล',
    columns: [
      { key: 'id',                 header: 'ID',           type: 'number', width: 60 },
      { key: 'assignment_id',      header: 'รายการที่ต้องชำระ', type: 'number', width: 130 },
      { key: 'collection_item_id', header: 'กิจกรรมย่อย',  type: 'number', width: 110 },
      { key: 'amount',             header: 'จำนวนเงิน',    type: 'number', width: 110 }
    ]
  },

  Payments: {
    sheet: 'Payments',
    title: 'การแจ้งชำระเงิน',
    columns: [
      { key: 'id',              header: 'ID',              type: 'number', width: 60 },
      { key: 'ref_code',        header: 'เลขอ้างอิง',      type: 'string', width: 100 },
      { key: 'assignment_id',   header: 'รายการที่ต้องชำระ', type: 'number', width: 130 },
      { key: 'amount',          header: 'จำนวนเงิน',       type: 'number', width: 110 },
      { key: 'method',          header: 'ช่องทาง',         type: 'string', width: 90 },
      { key: 'payer_name',      header: 'ชื่อผู้โอน',      type: 'string', width: 180 },
      { key: 'transferred_at',  header: 'วัน-เวลาที่โอน',  type: 'datetime', width: 160 },
      { key: 'bank_account_id', header: 'บัญชีรับโอน',     type: 'number', width: 100 },
      { key: 'slip_file_id',    header: 'ไฟล์สลิป (Drive)', type: 'string', width: 200 },
      { key: 'slip_mime',       header: 'ชนิดไฟล์',        type: 'string', width: 110 },
      { key: 'slip_size',       header: 'ขนาดไฟล์',        type: 'number', width: 90 },
      { key: 'slip_hash',       header: 'ลายนิ้วมือไฟล์',  type: 'string', width: 150 },
      { key: 'note',            header: 'หมายเหตุ',        type: 'string', width: 200 },
      { key: 'status',          header: 'สถานะ',           type: 'string', width: 100 },
      { key: 'reject_reason',   header: 'เหตุผลที่ไม่ผ่าน', type: 'string', width: 240 },
      { key: 'verified_by',     header: 'ผู้ตรวจสอบ',      type: 'number', width: 90 },
      { key: 'verified_at',     header: 'ตรวจสอบเมื่อ',    type: 'datetime', width: 160 },
      { key: 'receipt_no',      header: 'เลขที่ใบเสร็จ',   type: 'string', width: 130 },
      { key: 'created_at',      header: 'แจ้งเมื่อ',       type: 'datetime', width: 160 },
      { key: 'updated_at',      header: 'แก้ไขเมื่อ',      type: 'datetime', width: 160 }
    ]
  },

  BankAccounts: {
    sheet: 'BankAccounts',
    title: 'บัญชีรับโอน',
    columns: [
      { key: 'id',             header: 'ID',            type: 'number', width: 60 },
      { key: 'bank_name',      header: 'ธนาคาร',        type: 'string', width: 180 },
      { key: 'account_name',   header: 'ชื่อบัญชี',     type: 'string', width: 220 },
      { key: 'account_number', header: 'เลขที่บัญชี',   type: 'string', width: 150 },
      { key: 'branch',         header: 'สาขา',          type: 'string', width: 140 },
      { key: 'promptpay_id',   header: 'พร้อมเพย์',     type: 'string', width: 150 },
      { key: 'note',           header: 'หมายเหตุ',      type: 'string', width: 200 },
      { key: 'is_default',     header: 'บัญชีหลัก',     type: 'bool',   width: 90 },
      { key: 'is_active',      header: 'ใช้งาน',        type: 'bool',   width: 80 },
      { key: 'sort_order',     header: 'ลำดับ',         type: 'number', width: 70 },
      { key: 'created_at',     header: 'สร้างเมื่อ',    type: 'datetime', width: 150 }
    ]
  },

  AuditLogs: {
    sheet: 'AuditLogs',
    title: 'บันทึกกิจกรรม',
    columns: [
      { key: 'id',          header: 'ID',          type: 'number', width: 60 },
      { key: 'created_at',  header: 'เวลา',        type: 'datetime', width: 160 },
      { key: 'actor_type',  header: 'ประเภทผู้ใช้', type: 'string', width: 100 },
      { key: 'actor_id',    header: 'ผู้ใช้',      type: 'number', width: 80 },
      { key: 'actor_name',  header: 'ชื่อผู้ใช้',  type: 'string', width: 180 },
      { key: 'action',      header: 'การกระทำ',    type: 'string', width: 240 },
      { key: 'target_type', header: 'เป้าหมาย',    type: 'string', width: 110 },
      { key: 'target_id',   header: 'รหัสเป้าหมาย', type: 'number', width: 100 },
      { key: 'detail',      header: 'รายละเอียด',  type: 'string', width: 400 }
    ]
  }
};

/** ลำดับการสร้างชีต (ให้ชีตที่ใช้บ่อยอยู่ข้างหน้า) */
var SHEET_ORDER = [
  'Settings', 'Groups', 'Members', 'Collections', 'CollectionItems',
  'Assignments', 'AssignmentItems', 'Payments', 'BankAccounts',
  'Admins', 'Sessions', 'PasswordResets', 'AuditLogs'
];

/** ค่าตั้งต้นของระบบ */
var DEFAULT_SETTINGS = {
  school_name: 'โรงเรียนจุนวิทยาคม',
  school_short: 'จุนวิทยาคม',
  school_address: '',
  school_phone: '',
  school_logo: '',
  system_title: 'ระบบแจ้งชำระเงินตามวัตถุประสงค์การจัดเก็บ',
  contact_note: 'หากมีข้อสงสัยกรุณาติดต่อฝ่ายการเงินของโรงเรียน',
  require_member_pin: '1',
  show_pin_to_admin: '1',
  allow_public_member_list: '1',
  mask_member_name: '0',
  detect_duplicate_slip: '1',
  max_upload_mb: '5',
  receipt_prefix: 'RC',
  receipt_running: '0',
  auto_approve: '0',
  theme_color: 'indigo'
};

/** สถานะการชำระเงินและข้อความภาษาไทย */
var STATUS_LABEL = {
  unpaid:   'ยังไม่ชำระ',
  rejected: 'ไม่ผ่านการตรวจสอบ',
  pending:  'รอตรวจสอบ',
  partial:  'ชำระบางส่วน',
  paid:     'ชำระแล้ว',
  waived:   'ยกเว้นการชำระ'
};

var PAYMENT_STATUS_LABEL = {
  pending:   'รอตรวจสอบ',
  approved:  'ชำระแล้ว',
  rejected:  'ไม่ผ่านการตรวจสอบ',
  cancelled: 'ยกเลิก'
};

var ROLE_LABEL = {
  superadmin: 'ผู้ดูแลระบบสูงสุด',
  admin:      'ผู้ดูแลระบบ',
  viewer:     'ผู้ดูรายงาน'
};

var ROLE_RANK = { viewer: 1, admin: 2, superadmin: 3 };
