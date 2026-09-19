'use strict';

function str(v, max = 255) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

function num(v, fallback = 0) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function money(v, fallback = 0) {
  const n = num(v, fallback);
  return Math.round(Math.max(0, n) * 100) / 100;
}

function bool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function id(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

/** วันที่รูปแบบ YYYY-MM-DD */
function dateOnly(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** วัน-เวลารูปแบบ YYYY-MM-DDTHH:MM หรือ YYYY-MM-DD HH:MM(:SS) */
function dateTime(v) {
  const s = str(v, 25).replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s + ':00';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + ' 00:00:00';
  return null;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

/** ครอบ route handler ให้ส่งต่อ error (ทั้งแบบ sync และ async) ไปยัง error handler */
function wrap(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { str, num, money, bool, id, isEmail, dateOnly, dateTime, HttpError, fail, wrap };
