'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { db, migrate, UPLOAD_DIR } = require('./db');
const makeStore = require('./db/session-store');
const { loadAdmin } = require('./middleware/auth');
const { originGuard } = require('./middleware/security');
const mailer = require('./services/mailer');

function createApp() {
  migrate();
  mailer.init();

  const app = express();
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
  app.disable('x-powered-by');

  /* ---------------------------- ความปลอดภัย ---------------------------- */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'self'"],
          frameSrc: ["'self'", 'blob:'],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: process.env.NODE_ENV === 'production' ? undefined : false,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  /* ------------------------------ เซสชัน ------------------------------ */
  const SqliteStore = makeStore(session, db);
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('ต้องกำหนดค่า SESSION_SECRET ในไฟล์ .env ก่อนใช้งานจริง');
  }
  app.use(
    session({
      name: 'cwk.sid',
      store: new SqliteStore({ ttl: 1000 * 60 * 60 * 8 }),
      secret: secret || 'cwk-development-secret-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
        maxAge: 1000 * 60 * 60 * 8,
      },
    })
  );

  app.use(originGuard);
  app.use(loadAdmin);

  /* ---------------------------- จำกัดอัตราคำขอ ---------------------------- */
  const limiterOpts = { standardHeaders: true, legacyHeaders: false };
  const loginLimiter = rateLimit({
    ...limiterOpts,
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' },
  });
  const lookupLimiter = rateLimit({
    ...limiterOpts,
    windowMs: 10 * 60 * 1000,
    limit: 40,
    message: { error: 'ค้นหาบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  });
  const submitLimiter = rateLimit({
    ...limiterOpts,
    windowMs: 60 * 60 * 1000,
    limit: 60,
    message: { error: 'แจ้งชำระเงินบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
  });

  /* ------------------------------- เส้นทาง ------------------------------- */
  app.use('/api/public', require('./routes/public')({ lookupLimiter, submitLimiter }));
  app.use('/api/admin', require('./routes/admin.auth')({ loginLimiter }));
  app.use('/api/admin/members', require('./routes/admin.members'));
  app.use('/api/admin/groups', require('./routes/admin.groups'));
  app.use('/api/admin/collections', require('./routes/admin.collections'));
  app.use('/api/admin/payments', require('./routes/admin.payments'));
  app.use('/api/admin/reports', require('./routes/admin.reports'));
  app.use('/api/admin/settings', require('./routes/admin.settings'));
  app.use('/api/admin/users', require('./routes/admin.users'));

  /* ------------------------------ ไฟล์สลิป ------------------------------ */
  // เข้าถึงผ่าน API ที่ตรวจสอบสิทธิ์เท่านั้น (ดูใน routes/public.js และ admin.payments.js)
  app.use('/uploads/branding', express.static(path.join(UPLOAD_DIR, 'branding'), { maxAge: '7d' }));

  /* ------------------------------ ไฟล์หน้าเว็บ ------------------------------ */
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
  app.get('/admin/*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
  app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  /* ------------------------------ ข้อผิดพลาด ------------------------------ */
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'ไม่พบรายการที่ต้องการ' });
    res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    const status = err.status || 500;
    if (req.path.startsWith('/api/')) {
      return res.status(status).json({ error: err.publicMessage || 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' });
    }
    res.status(status).send('เกิดข้อผิดพลาดภายในระบบ');
  });

  return app;
}

module.exports = { createApp };
