/* A stand-in for the Firebase compat SDK (app / auth / database / storage), for recording
 * product videos against the REAL pages with demo data — nothing touches the live project.
 *
 * The database lives in scripts/video/server.js; every open page mirrors it. Writes apply
 * locally at once and are sent to the server, which relays them to the other pages over
 * Server-Sent Events — so a presenter tab and a phone tab stay in step, as they do live.
 *
 * It copies the Realtime Database behaviours the app depends on: empty objects/arrays are
 * dropped, integer-keyed objects come back as arrays, ServerValue.TIMESTAMP/increment are
 * resolved, and 'value' fires straight away with what is stored.
 */
(function () {
  'use strict';
  const CLIENT = Math.random().toString(36).slice(2);
  const sync = (url) => { const x = new XMLHttpRequest(); x.open('GET', url, false); x.send(); return JSON.parse(x.responseText || 'null'); };
  let TREE = sync('/__db/tree') || {};
  const AS = (/[?&]as=(\w+)/.exec(location.search) || [])[1] || '';
  const CONF = sync('/__video/config' + (AS ? '?as=' + AS : '')) || {};

  // ── paths & tree ─────────────────────────────────────────────────────────────
  const split = (p) => String(p || '').split('/').filter(Boolean);
  const join = (a) => a.join('/');
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  function getAt(parts) { let n = TREE; for (const k of parts) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
  function normalize(v) {                     // arrays → objects, drop null/empty
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const n = normalize(x); if (n !== null) o[i] = n; }); return Object.keys(o).length ? o : null; }
    if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { const n = normalize(v[k]); if (n !== null) o[k] = n; } return Object.keys(o).length ? o : null; }
    if (typeof v === 'number' && !isFinite(v)) return null;
    return v;
  }
  function resolveSV(v, cur) {
    if (v && typeof v === 'object' && '.sv' in v) {
      const sv = v['.sv'];
      if (sv === 'timestamp') return Date.now();
      if (sv && typeof sv === 'object' && 'increment' in sv) return (typeof cur === 'number' ? cur : 0) + Number(sv.increment);
      return null;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = resolveSV(v[k], cur && typeof cur === 'object' ? cur[k] : undefined); return o; }
    if (Array.isArray(v)) return v.map((x, i) => resolveSV(x, cur && cur[i]));
    return v;
  }
  function setAt(parts, value) {
    value = normalize(value);
    if (!parts.length) { TREE = value || {}; return; }
    let n = TREE; const stack = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (n[k] == null || typeof n[k] !== 'object') { if (value === null) return; n[k] = {}; }
      stack.push([n, k]); n = n[k];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete n[last]; else n[last] = value;
    for (let i = stack.length - 1; i >= 0; i--) { const [p, k] = stack[i]; if (p[k] && typeof p[k] === 'object' && !Object.keys(p[k]).length) delete p[k]; }
  }
  function toVal(v) {                         // RTDB's array heuristic on the way out
    if (v === null || typeof v !== 'object') return v;
    const keys = Object.keys(v); const out = {};
    for (const k of keys) out[k] = toVal(v[k]);
    const ints = keys.every(k => /^(0|[1-9]\d*)$/.test(k));
    if (ints && keys.length) { const max = Math.max(...keys.map(Number)); if (max < 2 * keys.length) { const a = []; for (let i = 0; i <= max; i++) a[i] = out[i] === undefined ? undefined : out[i]; return a; } }
    return out;
  }

  // ── listeners ────────────────────────────────────────────────────────────────
  const LISTENERS = [];
  function queryView(q) {                     // ordered [key, value] children for a query
    const v = getAt(q._parts);
    if (v === null || typeof v !== 'object') return null;
    let rows = Object.keys(v).map(k => [k, v[k]]);
    const o = q._q.orderBy;
    const sortVal = (r) => o === 'key' ? r[0] : o === 'value' ? r[1] : o ? (r[1] && typeof r[1] === 'object' ? getIn(r[1], o) : null) : r[0];
    if (o) rows.sort((a, b) => { const x = sortVal(a), y = sortVal(b); if (x === y) return a[0] < b[0] ? -1 : 1; if (x == null) return -1; if (y == null) return 1; return x < y ? -1 : 1; });
    if (q._q.equalTo !== undefined) rows = rows.filter(r => sortVal(r) === q._q.equalTo);
    if (q._q.startAt !== undefined) rows = rows.filter(r => sortVal(r) >= q._q.startAt);
    if (q._q.endAt !== undefined) rows = rows.filter(r => sortVal(r) <= q._q.endAt);
    if (q._q.first) rows = rows.slice(0, q._q.first);
    if (q._q.last) rows = rows.slice(-q._q.last);
    return rows;
  }
  function getIn(obj, path) { let n = obj; for (const k of split(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
  function currentRaw(q) {
    if (!q._hasQuery) return clone(getAt(q._parts));
    const rows = queryView(q); if (!rows || !rows.length) return null;
    const o = {}; rows.forEach(([k, v]) => { o[k] = clone(v); }); return o;
  }
  function notify() {
    for (const l of LISTENERS.slice()) {
      if (l.dead) continue;
      const now = currentRaw(l.q); const s = JSON.stringify(now);
      if (l.event === 'value') { if (s !== l.last) { l.last = s; fire(l, new Snapshot(l.q.ref, now, l.q)); } continue; }
      const prev = l.lastObj || {}, cur = (now && typeof now === 'object') ? now : {};
      if (l.event === 'child_added') for (const k of Object.keys(cur)) if (!(k in prev)) fire(l, new Snapshot(l.q.ref.child(k), cur[k]));
      if (l.event === 'child_changed') for (const k of Object.keys(cur)) if (k in prev && JSON.stringify(prev[k]) !== JSON.stringify(cur[k])) fire(l, new Snapshot(l.q.ref.child(k), cur[k]));
      if (l.event === 'child_removed') for (const k of Object.keys(prev)) if (!(k in cur)) fire(l, new Snapshot(l.q.ref.child(k), prev[k]));
      l.lastObj = clone(cur); l.last = s;
    }
  }
  function fire(l, snap) { try { l.cb.call(l.ctx || null, snap); } catch (e) { console.error(e); } }
  let _pending = false;
  function scheduleNotify() { if (_pending) return; _pending = true; setTimeout(() => { _pending = false; notify(); }, 0); }

  // ── server sync ──────────────────────────────────────────────────────────────
  function send(ops) {
    return fetch('/__db/write', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: CLIENT, ops }) }).catch(() => {});
  }
  try {
    const es = new EventSource('/__db/stream?client=' + CLIENT);
    es.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.client === CLIENT) return; m.ops.forEach(([p, v]) => setAt(split(p), v)); scheduleNotify(); };
  } catch (e) {}
  function applyOps(ops) { ops.forEach(([p, v]) => setAt(split(p), v)); scheduleNotify(); return send(ops); }

  // ── Snapshot / Reference / Query ─────────────────────────────────────────────
  class Snapshot {
    constructor(ref, raw, q) { this.ref = ref; this.key = ref ? ref.key : null; this._raw = raw === undefined ? null : raw; this._q = q; }
    val() { return toVal(clone(this._raw)); }
    exportVal() { return this.val(); }
    exists() { return this._raw !== null && this._raw !== undefined; }
    child(p) { return new Snapshot(this.ref.child(p), getIn(this._raw, p)); }
    hasChild(p) { return getIn(this._raw, p) !== null; }
    hasChildren() { return !!this._raw && typeof this._raw === 'object' && Object.keys(this._raw).length > 0; }
    numChildren() { return this._raw && typeof this._raw === 'object' ? Object.keys(this._raw).length : 0; }
    forEach(fn) {
      if (!this._raw || typeof this._raw !== 'object') return false;
      let keys = Object.keys(this._raw);
      if (this._q && this._q._hasQuery) { const rows = queryView(this._q) || []; keys = rows.map(r => r[0]).filter(k => k in this._raw); }
      for (const k of keys) if (fn(new Snapshot(this.ref.child(k), this._raw[k])) === true) return true;
      return false;
    }
    toJSON() { return this.val(); }
  }
  class Query {
    constructor(parts, q) { this._parts = parts; this._q = q || {}; this._hasQuery = Object.keys(this._q).length > 0; }
    get ref() { return new Reference(this._parts); }
    _with(k, v) { return new Query(this._parts, Object.assign({}, this._q, { [k]: v })); }
    orderByChild(c) { return this._with('orderBy', c); }
    orderByKey() { return this._with('orderBy', 'key'); }
    orderByValue() { return this._with('orderBy', 'value'); }
    orderByPriority() { return this; }
    equalTo(v) { return this._with('equalTo', v); }
    startAt(v) { return this._with('startAt', v); }
    startAfter(v) { return this._with('startAt', v); }
    endAt(v) { return this._with('endAt', v); }
    endBefore(v) { return this._with('endAt', v); }
    limitToFirst(n) { return this._with('first', n); }
    limitToLast(n) { return this._with('last', n); }
    on(event, cb, cancel, ctx) {
      if (typeof cancel === 'object' && cancel) { ctx = cancel; }
      const l = { q: this, event, cb, ctx, last: undefined, lastObj: {} };
      LISTENERS.push(l);
      if (this._parts[0] === '.info') {
        const v = this._parts[1] === 'connected' ? true : this._parts[1] === 'serverTimeOffset' ? 0 : null;
        setTimeout(() => fire(l, new Snapshot(this.ref, v)), 0); return cb;
      }
      setTimeout(() => {                      // RTDB answers straight away with what is stored
        const now = currentRaw(this);
        if (event === 'value') { l.last = JSON.stringify(now); fire(l, new Snapshot(this.ref, now, this)); }
        else { l.last = JSON.stringify(now); l.lastObj = clone(now && typeof now === 'object' ? now : {});
          if (event === 'child_added' && now) for (const k of Object.keys(now)) fire(l, new Snapshot(this.ref.child(k), now[k])); }
      }, 0);
      return cb;
    }
    off(event, cb) {
      for (const l of LISTENERS) {
        if (join(l.q._parts) !== join(this._parts)) continue;
        if (event && l.event !== event) continue;
        if (cb && l.cb !== cb) continue;
        l.dead = true;
      }
      for (let i = LISTENERS.length - 1; i >= 0; i--) if (LISTENERS[i].dead) LISTENERS.splice(i, 1);
    }
    once(event, cb) {
      event = event || 'value';
      return new Promise(res => { setTimeout(() => {
        let s;
        if (this._parts[0] === '.info') s = new Snapshot(this.ref, this._parts[1] === 'connected' ? true : 0);
        else s = new Snapshot(this.ref, currentRaw(this), this);
        if (typeof cb === 'function') cb(s); res(s); }, 0); });
    }
    get() { return this.once('value'); }
    isEqual(o) { return o && join(o._parts) === join(this._parts); }
    toString() { return 'https://video-demo.local/' + join(this._parts); }
  }
  let _pushLast = 0, _pushSeq = 0;
  const PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  function pushKey() {
    let t = Date.now(); if (t === _pushLast) _pushSeq++; else { _pushSeq = 0; _pushLast = t; }
    let s = ''; for (let i = 0; i < 8; i++) { s = PUSH[t % 64] + s; t = Math.floor(t / 64); }
    let r = ''; for (let i = 0; i < 12; i++) r += PUSH[Math.floor(Math.random() * 64)];
    return s + String(_pushSeq).padStart(2, '0').slice(-2).replace(/\d/g, d => PUSH[+d + 1]) + r.slice(2);
  }
  class Reference extends Query {
    constructor(parts) { super(parts, {}); }
    get key() { return this._parts.length ? this._parts[this._parts.length - 1] : null; }
    get parent() { return this._parts.length ? new Reference(this._parts.slice(0, -1)) : null; }
    get root() { return new Reference([]); }
    get ref() { return this; }
    child(p) { return new Reference(this._parts.concat(split(p))); }
    set(v, cb) { const cur = getAt(this._parts); const val = resolveSV(clone(v), cur);
      const p = applyOps([[join(this._parts), normalize(val)]]); if (typeof cb === 'function') p.then(() => cb(null)); return p.then(() => undefined); }
    update(obj, cb) {
      const ops = [];
      for (const k of Object.keys(obj || {})) { const parts = this._parts.concat(split(k)); ops.push([join(parts), normalize(resolveSV(clone(obj[k]), getAt(parts)))]); }
      const p = applyOps(ops); if (typeof cb === 'function') p.then(() => cb(null)); return p.then(() => undefined);
    }
    remove(cb) { return this.set(null, cb); }
    push(v) {
      const r = this.child(pushKey());
      const p = v === undefined ? Promise.resolve() : r.set(v);
      r.then = (a, b) => p.then(() => r).then(a, b); r.catch = (b) => p.catch(b);
      return r;
    }
    transaction(fn, onComplete) {
      const cur = toVal(clone(getAt(this._parts)));
      const next = fn(cur);
      if (next === undefined) { const s = new Snapshot(this, getAt(this._parts)); if (onComplete) onComplete(null, false, s); return Promise.resolve({ committed: false, snapshot: s }); }
      return this.set(next).then(() => { const s = new Snapshot(this, getAt(this._parts)); if (onComplete) onComplete(null, true, s); return { committed: true, snapshot: s }; });
    }
    setWithPriority(v) { return this.set(v); }
    onDisconnect() { const ok = () => Promise.resolve(); return { set: ok, update: ok, remove: ok, cancel: ok, setWithPriority: ok }; }
  }
  const database = { ref: (p) => new Reference(split(p)), refFromURL: (u) => new Reference(split(String(u).replace(/^https?:\/\/[^/]+/, ''))),
    goOffline() {}, goOnline() {}, useEmulator() {} };

  // ── auth ─────────────────────────────────────────────────────────────────────
  function makeUser(u) {
    if (!u) return null;
    return Object.assign({ uid: u.uid, email: u.email, displayName: u.displayName || null, photoURL: null, emailVerified: true,
      isAnonymous: false, providerData: [{ providerId: 'password', email: u.email }],
      metadata: { creationTime: new Date(u.createdAt || Date.now()).toUTCString(), lastSignInTime: new Date().toUTCString() },
      getIdToken: async () => 'video-demo-token',
      getIdTokenResult: async () => ({ token: 'video-demo-token', claims: {} }),
      reload: async () => {}, updateProfile: async (p) => { Object.assign(user, p); },
      sendEmailVerification: async () => {}, delete: async () => {}, toJSON() { return { uid: this.uid, email: this.email }; },
      // Account settings (2026-09-30). The password "wrong" is rejected, so the error path can be filmed too.
      reauthenticateWithCredential: async (c) => { if (!c || !c.password || c.password === 'wrong') { const e = new Error('bad'); e.code = 'auth/invalid-credential'; throw e; } },
      updatePassword: async () => {}, verifyBeforeUpdateEmail: async () => {} });
  }
  let user = (CONF.signedIn === false || /[?&]signedout\b/.test(location.search)) ? null : makeUser(CONF.user);
  const authSubs = [];
  const emitAuth = () => authSubs.slice().forEach(f => { try { f(user); } catch (e) { console.error(e); } });
  const auth = {
    get currentUser() { return user; },
    onAuthStateChanged(fn) { authSubs.push(fn); setTimeout(() => fn(user), 0); return () => { const i = authSubs.indexOf(fn); if (i >= 0) authSubs.splice(i, 1); }; },
    onIdTokenChanged(fn) { return auth.onAuthStateChanged(fn); },
    async signInWithEmailAndPassword(email) { user = makeUser(Object.assign({}, CONF.user, { email })); emitAuth(); return { user }; },
    async createUserWithEmailAndPassword(email) { user = makeUser(Object.assign({}, CONF.user, { email, createdAt: Date.now() })); emitAuth(); return { user, additionalUserInfo: { isNewUser: true } }; },
    async signInWithPopup() { user = makeUser(CONF.user); emitAuth(); return { user, additionalUserInfo: { isNewUser: false } }; },
    async signInWithRedirect() {}, async getRedirectResult() { return { user: null }; },
    async signInWithCustomToken() { user = makeUser(CONF.user); emitAuth(); return { user }; },
    async signInAnonymously() { user = makeUser({ uid: 'anon' + CLIENT, email: null }); user.isAnonymous = true; emitAuth(); return { user }; },
    async signOut() { user = null; emitAuth(); },
    async setPersistence() {}, async sendPasswordResetEmail() {}, async fetchSignInMethodsForEmail() { return ['password']; },
    useDeviceLanguage() {}, languageCode: 'en', useEmulator() {}, tenantId: null,
  };
  function GoogleAuthProvider() { this.addScope = () => this; this.setCustomParameters = () => this; }
  GoogleAuthProvider.credential = () => ({});
  function EmailAuthProvider() {} EmailAuthProvider.credential = (email, password) => ({ email, password });

  // ── storage: uploads go to the local server and come back as real URLs ─────
  const storage = { ref(p) { return storageRef(split(p || '')); }, refFromURL(u) { return storageRef(['from-url']); } };
  function storageRef(parts) {
    const path = join(parts);
    return {
      fullPath: path, name: parts[parts.length - 1] || '',
      child: (c) => storageRef(parts.concat(split(c))),
      getDownloadURL: async () => '/__upload/' + path,
      delete: async () => {},
      put(file, meta) {
        const p = fetch('/__upload/' + path, { method: 'POST', headers: { 'Content-Type': (meta && meta.contentType) || file.type || 'application/octet-stream' }, body: file })
          .then(() => ({ ref: storageRef(parts), bytesTransferred: file.size || 0, totalBytes: file.size || 0, state: 'success', metadata: meta || {} }));
        const task = { then: (a, b) => p.then(a, b), catch: (b) => p.catch(b),
          on(ev, prog, err, done) { p.then(s => { if (prog) prog(s); if (done) done(); }, e => err && err(e)); return () => {}; },
          snapshot: { ref: storageRef(parts), bytesTransferred: 0, totalBytes: file.size || 0 }, cancel() {}, pause() {}, resume() {} };
        return task;
      },
      putString(s) { return this.put(new Blob([s])); },
    };
  }

  // ── the firebase namespace ───────────────────────────────────────────────────
  const apps = [];
  function makeApp(cfg, name) {
    const app = { name: name || '[DEFAULT]', options: cfg || {}, database: () => database, auth: () => auth, storage: () => storage, delete: async () => {} };
    apps.push(app); return app;
  }
  const fb = {
    SDK_VERSION: '10.7.1-video-stub', apps,
    initializeApp: (cfg, name) => { const ex = apps.find(a => a.name === (name || '[DEFAULT]')); return ex || makeApp(cfg, name); },
    app: (name) => apps.find(a => a.name === (name || '[DEFAULT]')) || makeApp({}, name),
    database: Object.assign(() => database, { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' }, increment: (n) => ({ '.sv': { increment: n } }) }, enableLogging() {} }),
    auth: Object.assign(() => auth, { GoogleAuthProvider, EmailAuthProvider, Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } } }),
    storage: Object.assign(() => storage, { TaskEvent: { STATE_CHANGED: 'state_changed' }, TaskState: {} }),
  };
  window.firebase = fb;
  window.__videoDB = { get: (p) => toVal(clone(getAt(split(p)))), set: (p, v) => database.ref(p).set(v), client: CLIENT };
})();
