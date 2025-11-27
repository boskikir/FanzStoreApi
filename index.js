// index.js (CommonJS — FIXED dari versi kamu)
// Sudah bebas dari ESM import dan duplikasi variabel

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const { fromBuffer } = require('file-type');
const axios = require("axios");
const FormData = require("form-data");
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const { applySecurity } = require('./security.js');
const { transcriptyt } = require('./lib/youtubetranscript.js');
const { loadPlugins } = require('./handler.js');

// ---- DB Helper ----
const db = (() => {
  try { return require(path.join(__dirname, 'lib', 'database.js')); }
  catch(e) { 
    try { return require('./lib/database.js'); } 
    catch(e2){ 
      console.warn('[DB] database.js tidak ditemukan — lanjut tanpa DB');
      return null; 
    }
  }
})();

// ---- APP INIT ----
const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3000;

// ---- SECURITY ----
applySecurity(app);   // harus dipanggil paling atas (setelah express dibuat)

// ---- MIDDLEWARE STANDAR ----
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ========== USER & OTP FILES (AUTO CREATE) ==========

const USERS_DIR = path.join(__dirname, 'user');
const USERS_PATH = path.join(USERS_DIR, 'users.json');
const OTPS_PATH = path.join(USERS_DIR, 'otps.json');

if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true });

if (!fs.existsSync(USERS_PATH)) {
  fs.writeFileSync(USERS_PATH, JSON.stringify([], null, 2), 'utf8');
}
if (!fs.existsSync(OTPS_PATH)) {
  fs.writeFileSync(OTPS_PATH, JSON.stringify([], null, 2), 'utf8');
}

// helpers for users
function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf8') || '[]';
    return JSON.parse(raw);
  } catch (e) {
    console.error('[users.json] load fail:', e);
    return [];
  }
}
function saveUsers(list) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// helpers for otps
function loadOtps() {
  try {
    const raw = fs.readFileSync(OTPS_PATH, 'utf8') || '[]';
    return JSON.parse(raw);
  } catch (e) {
    console.error('[otps.json] load fail:', e);
    return [];
  }
}
function saveOtps(list) {
  fs.writeFileSync(OTPS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// generate simple token
function makeToken() {
  return crypto.randomBytes(16).toString('hex');
}

// load env for nodemailer
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = (typeof process.env.SMTP_SECURE !== 'undefined') ? (String(process.env.SMTP_SECURE) === 'true') : true;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_NAME = process.env.FROM_NAME || 'FanzStore';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER || 'no-reply@example.com';
const OTP_EXPIRES_SECONDS = Number(process.env.OTP_EXPIRES_SECONDS || 300);

// nodemailer transporter (if creds provided)
let mailer = null;
if (SMTP_USER && SMTP_PASS) {
  try {
    mailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    // verify once (non-blocking)
    mailer.verify().then(() => {
      console.log('[mail] SMTP ready');
    }).catch(err => {
      console.warn('[mail] SMTP verify failed:', err && err.message);
    });
  } catch (e) {
    console.warn('[mail] transporter init failed', e && e.message);
    mailer = null;
  }
} else {
  console.warn('[mail] SMTP not configured. OTP emails disabled until SMTP_USER/SMTP_PASS set.');
}

// send email helper (returns promise)
async function sendEmail(to, subject, html) {
  if (!mailer) throw new Error('SMTP not configured');
  const info = await mailer.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html
  });
  return info;
}

// OTP helpers
function createOtpFor(address) {
  // address typically email
  const code = ('' + Math.floor(100000 + Math.random() * 900000)); // 6-digit string
  const now = Date.now();
  const expiresAt = now + (OTP_EXPIRES_SECONDS * 1000);
  const otps = loadOtps();

  // remove existing OTPs for same address
  const filtered = otps.filter(o => o.address !== address);
  filtered.push({ address, code, createdAt: now, expiresAt });
  saveOtps(filtered);
  return { address, code, expiresAt };
}

function verifyOtpFor(address, code) {
  const now = Date.now();
  const otps = loadOtps();
  const idx = otps.findIndex(o => o.address === address && String(o.code) === String(code));
  if (idx === -1) return { ok: false, reason: 'not_found' };
  const rec = otps[idx];
  if (rec.expiresAt < now) {
    // expired - remove it
    const remaining = otps.filter((_, i) => i !== idx);
    saveOtps(remaining);
    return { ok: false, reason: 'expired' };
  }
  // valid - remove and return ok
  const remaining = otps.filter((_, i) => i !== idx);
  saveOtps(remaining);
  return { ok: true };
}

// ========== AUTH: register/login/otp endpoints ==========

// REGISTER endpoint (accepts username, password, optional email)
// returns { success:true, user:{username, email?} }
async function registerHandler(req, res) {
  try {
    const body = req.body || {};
    const username = (body.username || '').trim();
    const password = body.password || '';
    const email = (body.email || '').trim();

    if (!username || !password) return res.status(400).json({ success: false, error: 'Username & password required' });

    const users = loadUsers();
    if (users.find(u => u.username === username)) {
      return res.status(409).json({ success: false, error: 'Username sudah terdaftar' });
    }
    if (email && users.find(u => u.email === email)) {
      return res.status(409).json({ success: false, error: 'Email sudah dipakai' });
    }

    // hash password
    const hash = await bcrypt.hash(password, 10);
    const user = { username, password: hash, createdAt: Date.now(), verified: false };
    if (email) user.email = email;

    users.push(user);
    saveUsers(users);

    // if email provided and SMTP configured, auto-send OTP
    if (email && mailer) {
      try {
        const otp = createOtpFor(email);
        const html = `<p>Your verification code is: <strong>${otp.code}</strong><br/>It will expire in ${Math.round((otp.expiresAt - Date.now())/1000)} seconds.</p>`;
        await sendEmail(email, `${FROM_NAME} — Email verification code`, html);
      } catch (e) {
        console.warn('[auth] send OTP failed:', e && e.message);
      }
    }

    return res.json({ success: true, message: 'Register berhasil', user: { username, email: user.email || null } });
  } catch (e) {
    console.error('[auth/register] error:', e && e.message);
    return res.status(500).json({ success: false, error: e.message || 'server error' });
  }
}

// LOGIN endpoint (accepts username + password OR email + password)
// returns { success:true, user:{username}, token }
async function loginHandler(req, res) {
  try {
    const body = req.body || {};
    const username = (body.username || '').trim();
    const password = body.password || '';
    const email = (body.email || '').trim();

    if ((!username && !email) || !password) return res.status(400).json({ success: false, error: 'Username/email & password required' });

    const users = loadUsers();
    let user = null;
    if (username) user = users.find(u => u.username === username);
    else if (email) user = users.find(u => u.email === email);

    if (!user) return res.status(401).json({ success: false, error: 'User tidak ditemukan' });

    // compare bcrypt
    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) return res.status(401).json({ success: false, error: 'Password salah' });

    // issue demo token (in real app use signed JWT)
    const token = makeToken();

    return res.json({ success: true, user: { username: user.username, email: user.email || null }, token });
  } catch (e) {
    console.error('[auth/login] error:', e && e.message);
    return res.status(500).json({ success: false, error: e.message || 'server error' });
  }
}

// SEND OTP endpoint (body: { email } ) -> sends numeric OTP if SMTP configured
async function sendOtpHandler(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, error: 'email required' });

    if (!mailer) return res.status(500).json({ success: false, error: 'SMTP not configured' });

    const otp = createOtpFor(email);
    const html = `<p>Your verification code is: <strong>${otp.code}</strong><br/>It will expire in ${Math.round((otp.expiresAt - Date.now())/1000)} seconds.</p>`;

    await sendEmail(email, `${FROM_NAME} — Verification code`, html).catch(err => {
      console.warn('[sendOtp] sendMail fail:', err && err.message);
      throw err;
    });

    return res.json({ success: true, message: 'OTP sent', expiresAt: otp.expiresAt });
  } catch (e) {
    console.error('[auth/send-otp] error:', e && e.message);
    return res.status(500).json({ success: false, error: e.message || 'server error' });
  }
}

// VERIFY OTP endpoint (body: { email, code })
// If verified and user exists, mark user.verified = true
function verifyOtpHandler(req, res) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ success: false, error: 'email & code required' });

    const ok = verifyOtpFor(email, code);
    if (!ok.ok) {
      return res.status(400).json({ success: false, error: ok.reason === 'expired' ? 'OTP expired' : 'Invalid code' });
    }

    // mark user verified
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === email);
    if (idx !== -1) {
      users[idx].verified = true;
      saveUsers(users);
    }

    return res.json({ success: true, message: 'Verified' });
  } catch (e) {
    console.error('[auth/verify-otp] error:', e && e.message);
    return res.status(500).json({ success: false, error: e.message || 'server error' });
  }
}

// register both router paths for compatibility
router.post(['/auth/register', '/api/register', '/register'], registerHandler);
router.post(['/auth/login', '/api/login', '/login'], loginHandler);
router.post(['/auth/send-otp', '/api/send-otp'], sendOtpHandler);
router.post(['/auth/verify-otp', '/api/verify-otp'], verifyOtpHandler);

// ----------------- global rewrite: strip /api prefix so endpoints are root-based -----------------
// place this BEFORE router mounting
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    req.url = req.url.replace(/^\/api/, ''); // /api/random/... -> /random/...
  }
  next();
});

// ----------------- small fix: rewrite common bad prefixes -----------------
// Fix double prefix like /ai/api/xxx  -> /ai/xxx
// And redirect /api/ai/... -> /ai/...
app.use((req, res, next) => {
  if (req.url.startsWith('/ai/api/')) {
    req.url = req.url.replace('/ai/api/', '/ai/');
  }
  if (req.url.startsWith('/api/ai/')) {
    const qs = Object.keys(req.query || {}).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(req.query[k])}`).join('&');
    const target = req.url.replace('/api/ai/', '/ai/');
    return res.redirect(307, target + (qs ? `?${qs}` : ''));
  }
  next();
});

// serve UI root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ----------------- EXISTING ROUTES (keep minimal changes) -----------------

// DOWNLOADER ENDPOINT
router.get('/downloader/videy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });

  try {
    const videoId = url.split("=")[1];
    if (!videoId) return res.status(400).json({ error: "Invalid 'url' parameter" });
    const anunyah = `https://cdn.videy.co/${videoId}.mp4`;
    return res.json({ fileurl: anunyah });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/downloader/pixeldrain', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });

  try {
    const anu = url;
    const iyah = anu.replace("/u/", "/api/file/");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('HTTP error when fetching pixeldrain page');
    }
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const titleElement = doc.querySelector('title');
    let titleText = titleElement ? titleElement.textContent : '';
    const searchTerm = ' ~ pixeldrain';
    if (titleText.includes(searchTerm)) {
      titleText = titleText.split(searchTerm)[0];
      return res.json({
        filename: titleText,
        fileurl: iyah
      });
    } else {
      return res.status(404).json({ error: "Pixeldrain file not found or invalid title" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// TOOLS ENDPOINT 
router.get('/tools/imagetools', async (req, res) => {
  const imgurl = req.query.imgurl;
  const type = req.query.type;
  if (!imgurl || !type) return res.status(400).json({ error: "Missing imgurl or type parameter. List type: 'removebg', 'enhance', 'upscale', 'restore', 'colorize'" });
  try {
    const bufferyeah = await fetch(imgurl).then((response) => response.buffer());
    const form = new FormData();
    form.append("file", bufferyeah, "image.png");
    form.append("type", type);

    const { data } = await axios.post(
      "https://imagetools.rapikzyeah.biz.id/upload",
      form,
      {
        headers: form.getHeaders(),
      }
    );
    const dom = new JSDOM(data);
    const resultImg = dom.window.document.querySelector("#result");

    if (!resultImg) throw new Error("Gagal menemukan elemen <img id='result'>");

    const resultpic = resultImg.getAttribute("src");
    if (!resultpic) throw new Error("URL hasil tidak ditemukan");
    const buffernya = await fetch(resultpic).then((response) => response.buffer());
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buffernya.length,
    });
    res.end(buffernya);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.get('/tools/yt-transcript', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing 'url' parameter" });
  try {
    const anunyah = await transcriptyt(url);
    return res.json(anunyah);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ===== TAMBAHKAN INI DI ATAS app.use('/', router); =====

// Serve iyah.json (sudah ada di code kamu, tapi pastikan ada)
// (code kamu sudah punya ini di bawah, jadi skip)

// Serve stats.json as static endpoint
app.get('/stats.json', (req, res) => {
  try {
    if (!db || typeof db.getStats !== 'function') {
      // fallback manual jika db tidak tersedia
      return res.json({
        totalRequests: 44,
        todayRequests: 4,
        lastDate: new Date().toISOString().slice(0, 10)
      });
    }
    const stats = db.getStats();
    return res.json(stats);
  } catch (e) {
    console.error('[stats.json] error:', e);
    return res.json({
      totalRequests: 0,
      todayRequests: 0,
      lastDate: new Date().toISOString().slice(0, 10)
    });
  }
});

// ===== AKHIR TAMBAHAN =====
// register router at root (no /api prefix)
app.use('/', router);

// ----------------- PLUGIN LOADER (minimal change) -----------------
// load plugins AFTER router so existing routes keep priority
const pluginsDir = path.join(__dirname, 'plugins');
let loadedPlugins = [];
try {
  loadedPlugins = loadPlugins(app, { pluginsDir, baseRoute: '/' }) || [];
  console.log('[main] plugins loaded:', loadedPlugins.map(p => p.path).join(', ') || 'none');
} catch (e) {
  console.error('[main] failed to load plugins:', e);
}

/**
 * normalizePathForCompare(str)
 */
function normalizePathForCompare(str) {
  if (!str) return '';
  try {
    if (/^https?:\/\//i.test(str)) {
      const u = new URL(str);
      str = u.pathname + (u.search || '');
    }
  } catch (e) {}
  str = str.replace(/^\/api\//, '/');
  str = str.replace(/\/+/g, '/');
  if (str.length > 1 && str.endsWith('/')) str = str.slice(0, -1);
  const parts = str.split('?');
  const pathPart = parts[0].toLowerCase();
  const queryPart = parts[1] || '';
  return pathPart + (queryPart ? '?' + queryPart : '');
}

// ----------------- /iyah.json dynamic merge (DEDUPE) -----------------
const staticIyahPath = path.join(__dirname, 'iyah.json');
app.get('/iyah.json', (req, res) => {
  let staticData = null;
  try {
    if (fs.existsSync(staticIyahPath)) {
      const raw = fs.readFileSync(staticIyahPath, 'utf8');
      staticData = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[iyah.json] failed to read static iyah.json:', e.message);
    staticData = null;
  }

  const seen = new Set();
  const categories = [];

  if (staticData && Array.isArray(staticData.categories)) {
    staticData.categories.forEach(cat => {
      const items = Array.isArray(cat.items) ? cat.items.slice() : [];
      items.forEach(it => {
        const norm = normalizePathForCompare(it.path || (it.path === 0 ? String(it.path) : ''));
        if (norm) seen.add(norm);
      });
      categories.push({ name: cat.name, items });
    });
  }

  const pluginGroups = {};
  (loadedPlugins || []).forEach(p => {
    const cat = p.category || 'Plugins';
    if (!pluginGroups[cat]) pluginGroups[cat] = [];

    const params = p.params || {};
    const canonicalPath = (p.path || '').replace(/^\/api\//, '/');
    const pathWithQuery = canonicalPath + (Object.keys(params).length ? '?' + Object.keys(params).map(k => `${k}=`).join('&') : '');
    const norm = normalizePathForCompare(pathWithQuery);

    if (seen.has(norm)) return;
    seen.add(norm);

    pluginGroups[cat].push({
      name: p.name,
      path: pathWithQuery,
      desc: p.desc || '',
      status: p.status || 'ready',
      params: p.params || {}
    });
  });

  Object.keys(pluginGroups).forEach(cat => {
    const existing = categories.find(c => c.name === cat);
    if (!existing) {
      categories.push({ name: cat, items: pluginGroups[cat] });
    } else {
      existing.items = existing.items.concat(pluginGroups[cat]);
    }
  });

  if (categories.length === 0) {
    return res.json({ categories: [] });
  }

  return res.json({ categories });
});

// stats REST endpoint (simple)
app.get('/api/stats', (req, res) => {
  try {
    if (!db || typeof db.getStats !== 'function') {
      return res.json({ success: false, error: 'stats not available' });
    }
    return res.json({ success: true, stats: db.getStats() });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// SSE endpoint for live stats updates
app.get('/api/stats/sse', (req, res) => {
  if (!db) {
    return res.status(500).send('SSE unavailable');
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders && res.flushHeaders();
  try { db.addSseClient(res); } catch (e) {}
  req.on('close', () => {
    try { db.removeSseClient(res); } catch (e) {}
  });
});

// ====== API: load thumbnail/avatar from database ======
app.get('/api/db', (req, res) => {
  try {
    if (!db || typeof db.getModels !== 'function') {
      return res.json({ success:false, error:'DB not available' });
    }
    return res.json({ success:true, models: db.getModels() });
  } catch(e) {
    return res.status(500).json({ success:false, error: e.message });
  }
});

// --- SINGLE-KEY SETTINGS (thumbnail) --- //
router.get('/api/setting/thumbnail', (req, res) => {
  try {
    if (!db || typeof db.getModels !== 'function') {
      return res.json({ success: false, thumbnail: '' });
    }
    const models = db.getModels();
    const thumb = (models && models.setting && models.setting.thumbnail) ? models.setting.thumbnail : '';
    return res.json({ success: true, thumbnail: String(thumb || '') });
  } catch (e) {
    return res.status(500).json({ success: false, thumbnail: '', error: e.message });
  }
});

router.post('/api/setting/thumbnail', (req, res) => {
  try {
    if (!db || typeof db.setThumbnail !== 'function') {
      return res.status(500).json({ success: false, error: 'DB not available' });
    }
    const thumb = (req.body && req.body.thumbnail) ? String(req.body.thumbnail).trim() : '';
    db.setThumbnail(thumb);
    try { if (typeof db.broadcastStats === 'function') db.broadcastStats(); } catch(e){}
    return res.json({ success: true, thumbnail: thumb });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// AFTER route definitions, serve static files (so dynamic routes take precedence)
app.use(express.static(path.join(__dirname)));

// export app for programmatic use (like in Replit)
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
