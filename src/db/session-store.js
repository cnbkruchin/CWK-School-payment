'use strict';
/** express-session store ที่ใช้ better-sqlite3 (ไม่ต้องพึ่ง native module เพิ่ม) */
module.exports = function makeStore(session, db) {
  const Store = session.Store;

  class SqliteStore extends Store {
    constructor(opts = {}) {
      super(opts);
      this.ttl = opts.ttl || 1000 * 60 * 60 * 8; // 8 ชั่วโมง
      this.get_ = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
      this.set_ = db.prepare(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (@sid, @data, @exp)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
      );
      this.del_ = db.prepare('DELETE FROM sessions WHERE sid = ?');
      this.touch_ = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
      this.all_ = db.prepare('SELECT sid, data FROM sessions WHERE expires_at > ?');
      this.count_ = db.prepare('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?');
      this.clear_ = db.prepare('DELETE FROM sessions');
      this.prune_ = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

      this.timer = setInterval(() => this.prune(), 1000 * 60 * 15);
      if (this.timer.unref) this.timer.unref();
    }

    expiry(sess) {
      const ms =
        sess && sess.cookie && sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + this.ttl;
      return ms;
    }

    prune() {
      try { this.prune_.run(Date.now()); } catch { /* ignore */ }
    }

    get(sid, cb) {
      try {
        const row = this.get_.get(sid);
        if (!row) return cb(null, null);
        if (row.expires_at <= Date.now()) {
          this.del_.run(sid);
          return cb(null, null);
        }
        cb(null, JSON.parse(row.data));
      } catch (e) { cb(e); }
    }

    set(sid, sess, cb) {
      try {
        this.set_.run({ sid, data: JSON.stringify(sess), exp: this.expiry(sess) });
        cb && cb(null);
      } catch (e) { cb && cb(e); }
    }

    destroy(sid, cb) {
      try { this.del_.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
    }

    touch(sid, sess, cb) {
      try { this.touch_.run(this.expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
    }

    length(cb) {
      try { cb(null, this.count_.get(Date.now()).n); } catch (e) { cb(e); }
    }

    all(cb) {
      try { cb(null, this.all_.all(Date.now()).map((r) => JSON.parse(r.data))); } catch (e) { cb(e); }
    }

    clear(cb) {
      try { this.clear_.run(); cb && cb(null); } catch (e) { cb && cb(e); }
    }
  }

  return SqliteStore;
};
