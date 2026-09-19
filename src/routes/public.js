'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

const { db, getAllSettings, getSetting, getSettingBool, UPLOAD_DIR, nextReceiptNo } = require('../db');
const finance = require('../services/finance');
const promptpay = require('../services/promptpay');
const audit = require('../services/audit');
const { slipUpload, inspectFile } = require('../middleware/upload');
const { generateRefCode } = require('../utils/codes');
const { maskName } = require('../utils/thai');
const v = require('../utils/validate');

module.exports = function publicRoutes({ lookupLimiter, submitLimiter }) {
  const router = express.Router();

  /** ตัดข้อมูลที่ไม่ควรเปิดเผยออกจาก object */
  const strip = (o, keys = ['pin_hash', 'pin_plain', 'slip_path', 'submitted_ip']) => {
    if (!o) return o;
    const c = { ...o };
    for (const k of keys) delete c[k];
    return c;
  };

  const publicName = (row) => {
    if (!getSettingBool('mask_member_name')) return row.full_name;
    return `${row.prefix || ''}${row.first_name} ${maskName(row.last_name)}`.trim();
  };

  /* --------------------------- ข้อมูลตั้งต้นของเว็บ --------------------------- */
  router.get('/config', v.wrap((req, res) => {
    const s = getAllSettings();
    res.json({
      school_name: s.school_name,
      school_short: s.school_short,
      school_address: s.school_address,
      school_phone: s.school_phone,
      school_logo: s.school_logo,
      system_title: s.system_title,
      contact_note: s.contact_note,
      require_member_pin: s.require_member_pin === '1',
      allow_public_member_list: s.allow_public_member_list === '1',
      max_upload_mb: Number(s.max_upload_mb) || 10,
      theme_color: s.theme_color,
    });
  }));

  /* ----------------------- รายการจัดเก็บที่เปิดรับชำระ ----------------------- */
  router.get('/collections', v.wrap((req, res) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.code, c.name, c.description, c.fiscal_year, c.term, c.due_date,
                c.status, c.allow_partial, c.created_at,
                (SELECT COUNT(*) FROM assignments a WHERE a.collection_id = c.id) AS member_count
           FROM collections c
          WHERE c.status IN ('open','closed') AND c.is_public = 1
       ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.due_date IS NULL, c.due_date, c.created_at DESC`
      )
      .all();

    const out = rows.map((c) => {
      const board = finance.getBoard(c.id);
      return { ...c, summary: finance.summarize(board) };
    });
    res.json({ collections: out });
  }));

  /* ------------------- ตารางรายชื่อผู้ต้องชำระของรายการหนึ่ง ------------------- */
  router.get('/collections/:id(\\d+)', v.wrap((req, res) => {
    const id = v.id(req.params.id);
    if (!id) v.fail(400, 'รหัสรายการไม่ถูกต้อง');

    const c = db
      .prepare(
        `SELECT id, code, name, description, fiscal_year, term, due_date, status,
                allow_partial, default_amount, is_public, created_at
           FROM collections WHERE id = ?`
      )
      .get(id);
    if (!c || !c.is_public || c.status === 'draft') v.fail(404, 'ไม่พบรายการจัดเก็บนี้ หรือยังไม่เปิดให้แจ้งชำระ');

    const items = db
      .prepare('SELECT id, name, description, amount, is_optional FROM collection_items WHERE collection_id = ? ORDER BY sort_order, id')
      .all(id);

    const banks = db
      .prepare(
        `SELECT id, bank_name, account_name, account_number, branch, promptpay_id, note, is_default
           FROM bank_accounts WHERE is_active = 1 ORDER BY is_default DESC, sort_order, id`
      )
      .all();

    const board = finance.getBoard(id, {
      search: v.str(req.query.q, 100),
      groupId: v.id(req.query.group),
      status: v.str(req.query.status, 20) || null,
    });

    const showList = getSettingBool('allow_public_member_list');
    const groups = db
      .prepare(
        `SELECT DISTINCT g.id, g.name FROM groups g
           JOIN members m ON m.group_id = g.id
           JOIN assignments a ON a.member_id = m.id
          WHERE a.collection_id = ? ORDER BY g.sort_order, g.name`
      )
      .all(id);

    res.json({
      collection: c,
      items,
      banks: banks.map((b) => ({ ...b, has_promptpay: !!b.promptpay_id })),
      groups,
      summary: finance.summarize(finance.getBoard(id)),
      members: showList
        ? board.map((r) => ({
            assignment_id: r.assignment_id,
            member_id: r.member_id,
            member_code: r.member_code,
            name: publicName(r),
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
            payment_count: r.payment_count,
          }))
        : [],
      list_hidden: !showList,
    });
  }));

  /* -------------------- ข้อมูลสำหรับฟอร์มแจ้งชำระรายบุคคล -------------------- */
  router.get('/assignments/:id(\\d+)', v.wrap((req, res) => {
    const id = v.id(req.params.id);
    if (!id) v.fail(400, 'รหัสรายการไม่ถูกต้อง');

    const a = finance.getAssignment(id);
    if (!a) v.fail(404, 'ไม่พบรายการที่ต้องชำระ');

    const col = db.prepare('SELECT is_public, status FROM collections WHERE id = ?').get(a.collection_id);
    if (!col || !col.is_public || col.status === 'draft') v.fail(404, 'รายการนี้ยังไม่เปิดให้แจ้งชำระ');

    const items = finance.getAssignmentItems(id);
    const payments = finance.getPayments(id).map((p) => ({
      ref_code: p.ref_code,
      amount: p.amount,
      status: p.status,
      transferred_at: p.transferred_at,
      created_at: p.created_at,
      verified_at: p.verified_at,
      reject_reason: p.reject_reason,
      receipt_no: p.receipt_no,
      has_slip: !!p.slip_path,
    }));

    res.json({
      assignment: {
        ...strip(a),
        name: publicName(a),
        full_name: publicName(a),
      },
      items,
      payments,
      require_pin: getSettingBool('require_member_pin'),
      can_submit: col.status === 'open' && !a.waived && a.outstanding > 0,
    });
  }));

  /* ------------------------- QR พร้อมเพย์ตามยอดที่ต้องชำระ ------------------------- */
  router.get('/promptpay-qr', v.wrap(async (req, res) => {
    const bankId = v.id(req.query.bank);
    const amount = v.money(req.query.amount, 0);
    const bank = bankId
      ? db.prepare('SELECT * FROM bank_accounts WHERE id = ? AND is_active = 1').get(bankId)
      : db.prepare('SELECT * FROM bank_accounts WHERE is_active = 1 AND promptpay_id IS NOT NULL AND promptpay_id <> \'\' ORDER BY is_default DESC, sort_order LIMIT 1').get();

    if (!bank || !bank.promptpay_id) v.fail(404, 'ยังไม่ได้ตั้งค่าพร้อมเพย์สำหรับบัญชีนี้');

    const dataUrl = await promptpay.buildQrDataUrl(bank.promptpay_id, amount);
    if (!dataUrl) v.fail(400, 'เลขพร้อมเพย์ไม่ถูกต้อง');
    res.json({
      qr: dataUrl,
      amount,
      bank: { id: bank.id, bank_name: bank.bank_name, account_name: bank.account_name, promptpay_id: bank.promptpay_id },
    });
  }));

  /* ---------------------------- แจ้งชำระเงิน (อัปโหลดสลิป) ---------------------------- */
  router.post('/payments', submitLimiter, slipUpload, v.wrap((req, res) => {
    const cleanupFile = () => {
      if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
    };

    try {
      const assignmentId = v.id(req.body.assignment_id);
      if (!assignmentId) v.fail(400, 'ไม่พบรายการที่ต้องการแจ้งชำระ');

      const a = finance.getAssignment(assignmentId);
      if (!a) v.fail(404, 'ไม่พบรายการที่ต้องชำระ');
      if (a.collection_status !== 'open') v.fail(400, 'รายการจัดเก็บนี้ปิดรับการแจ้งชำระแล้ว');
      if (a.waived) v.fail(400, 'รายการนี้ได้รับการยกเว้นการชำระ ไม่ต้องแจ้งชำระเงิน');
      if (a.outstanding <= 0) v.fail(400, 'รายการนี้ชำระครบแล้ว');
      if (a.pending_count > 0) v.fail(400, 'มีรายการที่รอการตรวจสอบอยู่แล้ว กรุณารอผู้ดูแลตรวจสอบก่อน');

      // ตรวจรหัสสมาชิก
      if (getSettingBool('require_member_pin')) {
        const pin = v.str(req.body.pin, 20);
        if (!pin) v.fail(400, 'กรุณากรอกรหัสสมาชิกเพื่อยืนยันตัวตน');
        if (!a.pin_hash || !bcrypt.compareSync(pin, a.pin_hash)) {
          audit.log(req, 'แจ้งชำระเงิน: รหัสสมาชิกไม่ถูกต้อง', {
            actorType: 'member', actorId: a.member_id, actorName: a.full_name,
            targetType: 'assignment', targetId: assignmentId,
          });
          v.fail(401, 'รหัสสมาชิกไม่ถูกต้อง หากลืมรหัสกรุณาติดต่อผู้ดูแลระบบเพื่อขอรหัสใหม่');
        }
      }

      if (!req.file) v.fail(400, 'กรุณาแนบสลิปการโอนเงิน');

      // ตรวจสอบไฟล์จริง
      const info = inspectFile(req.file.path);
      if (!info.detected) v.fail(400, 'ไฟล์ที่แนบไม่ใช่รูปภาพหรือ PDF ที่ถูกต้อง');

      // ตรวจจับสลิปซ้ำ
      if (getSettingBool('detect_duplicate_slip')) {
        const dup = db
          .prepare(
            `SELECT p.ref_code, p.created_at, m.member_code
               FROM payments p
               JOIN assignments a2 ON a2.id = p.assignment_id
               JOIN members m ON m.id = a2.member_id
              WHERE p.slip_hash = ? AND p.status <> 'cancelled' LIMIT 1`
          )
          .get(info.hash);
        if (dup) v.fail(409, `สลิปนี้เคยถูกใช้แจ้งชำระแล้ว (เลขอ้างอิง ${dup.ref_code}) กรุณาแนบสลิปที่ถูกต้อง`);
      }

      const amountRaw = v.money(req.body.amount, a.outstanding);
      const amount = amountRaw > 0 ? amountRaw : a.outstanding;
      if (!a.allow_partial && amount + 0.005 < a.outstanding) {
        v.fail(400, `รายการนี้ต้องชำระเต็มจำนวน ${a.outstanding.toFixed(2)} บาท`);
      }
      if (amount > a.outstanding + 0.005) {
        v.fail(400, `จำนวนเงินเกินยอดที่ต้องชำระ (${a.outstanding.toFixed(2)} บาท)`);
      }

      const relPath = path.relative(UPLOAD_DIR, req.file.path);
      const autoApprove = getSettingBool('auto_approve');

      const result = db.transaction(() => {
        const refCode = generateRefCode(db);
        const info2 = db
          .prepare(
            `INSERT INTO payments
               (ref_code, assignment_id, amount, method, payer_name, transferred_at,
                bank_account_id, slip_path, slip_mime, slip_size, slip_hash, note, status,
                submitted_ip, receipt_no, verified_at)
             VALUES (@ref, @aid, @amount, 'transfer', @payer, @tat, @bank, @sp, @mime, @size, @hash, @note, @status, @ip, @receipt, @vat)`
          )
          .run({
            ref: refCode,
            aid: assignmentId,
            amount,
            payer: v.str(req.body.payer_name, 120) || a.full_name,
            tat: v.dateTime(req.body.transferred_at),
            bank: v.id(req.body.bank_account_id),
            sp: relPath,
            mime: info.detected,
            size: info.size,
            hash: info.hash,
            note: v.str(req.body.note, 500) || null,
            status: autoApprove ? 'approved' : 'pending',
            ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null,
            receipt: autoApprove ? nextReceiptNo() : null,
            vat: autoApprove ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
          });
        return { refCode, paymentId: info2.lastInsertRowid };
      })();

      audit.log(req, 'แจ้งชำระเงิน', {
        actorType: 'member', actorId: a.member_id, actorName: a.full_name,
        targetType: 'payment', targetId: result.paymentId,
        detail: { ref_code: result.refCode, amount, collection: a.collection_name },
      });

      res.status(201).json({
        ok: true,
        ref_code: result.refCode,
        amount,
        status: autoApprove ? 'approved' : 'pending',
        status_label: autoApprove ? 'ชำระแล้ว' : 'รอตรวจสอบ',
        member_name: publicName(a),
        member_code: a.member_code,
        collection_name: a.collection_name,
        submitted_at: new Date().toISOString(),
        message: autoApprove
          ? 'บันทึกการชำระเงินเรียบร้อยแล้ว'
          : 'แจ้งชำระเงินเรียบร้อยแล้ว กรุณาเก็บเลขอ้างอิงไว้เพื่อตรวจสอบสถานะและดูสลิปภายหลัง',
      });
    } catch (e) {
      cleanupFile();
      throw e;
    }
  }));

  /* ------------------------ ตรวจสอบสถานะด้วยเลขอ้างอิง ------------------------ */
  router.get('/payments/lookup', lookupLimiter, v.wrap((req, res) => {
    const ref = v.str(req.query.ref, 12).replace(/\D/g, '');
    if (!ref || ref.length < 4) v.fail(400, 'กรุณากรอกเลขอ้างอิงให้ถูกต้อง');

    const p = db
      .prepare(
        `SELECT p.*, a.amount_due, a.discount, a.waived, a.collection_id,
                m.member_code, m.prefix, m.first_name, m.last_name,
                c.name AS collection_name, c.code AS collection_code,
                g.name AS group_name, ad.full_name AS verified_by_name
           FROM payments p
           JOIN assignments a  ON a.id = p.assignment_id
           JOIN members m      ON m.id = a.member_id
           JOIN collections c  ON c.id = a.collection_id
      LEFT JOIN groups g       ON g.id = m.group_id
      LEFT JOIN admins ad      ON ad.id = p.verified_by
          WHERE p.ref_code = ? AND p.status <> 'cancelled'`
      )
      .get(ref);

    if (!p) v.fail(404, 'ไม่พบเลขอ้างอิงนี้ในระบบ กรุณาตรวจสอบอีกครั้ง');

    const statusLabel =
      { pending: 'รอตรวจสอบ', approved: 'ชำระแล้ว', rejected: 'ไม่ผ่านการตรวจสอบ' }[p.status] || p.status;

    res.json({
      ref_code: p.ref_code,
      status: p.status,
      status_label: statusLabel,
      amount: p.amount,
      payer_name: p.payer_name,
      transferred_at: p.transferred_at,
      submitted_at: p.created_at,
      verified_at: p.verified_at,
      verified_by_name: p.verified_by_name,
      reject_reason: p.reject_reason,
      receipt_no: p.receipt_no,
      note: p.note,
      has_slip: !!p.slip_path,
      slip_mime: p.slip_mime,
      member: {
        member_code: p.member_code,
        name: getSettingBool('mask_member_name')
          ? `${p.prefix || ''}${p.first_name} ${maskName(p.last_name)}`.trim()
          : `${p.prefix || ''}${p.first_name} ${p.last_name}`.trim(),
        group_name: p.group_name,
      },
      collection: { id: p.collection_id, code: p.collection_code, name: p.collection_name },
    });
  }));

  /* ---------------------------- ดูสลิปด้วยเลขอ้างอิง ---------------------------- */
  router.get('/payments/:ref(\\d{4,12})/slip', lookupLimiter, v.wrap((req, res) => {
    const ref = v.str(req.params.ref, 12).replace(/\D/g, '');
    const p = db
      .prepare("SELECT slip_path, slip_mime FROM payments WHERE ref_code = ? AND status <> 'cancelled'")
      .get(ref);
    if (!p || !p.slip_path) v.fail(404, 'ไม่พบสลิปของเลขอ้างอิงนี้');

    const abs = path.resolve(UPLOAD_DIR, p.slip_path);
    if (!abs.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(abs)) v.fail(404, 'ไม่พบไฟล์สลิป');

    res.setHeader('Content-Type', p.slip_mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', `inline; filename="slip-${ref}${path.extname(abs)}"`);
    fs.createReadStream(abs).pipe(res);
  }));

  /* ----------------------- ประวัติการชำระของสมาชิก (ค้นด้วยรหัส) ----------------------- */
  router.post('/member/history', lookupLimiter, v.wrap((req, res) => {
    const code = v.str(req.body.member_code, 40);
    const pin = v.str(req.body.pin, 20);
    if (!code) v.fail(400, 'กรุณากรอกรหัสสมาชิก');

    const m = db.prepare('SELECT * FROM members WHERE member_code = ? AND is_active = 1').get(code);
    const needPin = getSettingBool('require_member_pin');
    if (!m || (needPin && (!pin || !m.pin_hash || !bcrypt.compareSync(pin, m.pin_hash)))) {
      v.fail(401, 'รหัสสมาชิกหรือรหัสยืนยันไม่ถูกต้อง');
    }

    const ledger = finance.getMemberLedger(m.id).filter((r) => r.collection_status !== 'draft');
    const totals = finance.summarize(ledger);

    res.json({
      member: {
        member_code: m.member_code,
        name: `${m.prefix || ''}${m.first_name} ${m.last_name}`.trim(),
        group_name: db.prepare('SELECT name FROM groups WHERE id = ?').get(m.group_id)?.name || null,
      },
      totals,
      items: ledger.map((r) => ({
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
        last_verified_at: r.last_verified_at,
      })),
    });
  }));

  return router;
};
