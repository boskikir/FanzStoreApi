// lib/database.js
const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(process.cwd(), 'stats.json');
const DB_PATH = path.join(process.cwd(), 'db.json');

// ----------------- STATS (existing behaviour) -----------------
let __STATS = {
  totalRequests: 0,
  todayRequests: 0,
  lastDate: (new Date()).toISOString().slice(0,10)
};

try {
  if (fs.existsSync(STATS_PATH)) {
    const raw = fs.readFileSync(STATS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      __STATS = Object.assign(__STATS, parsed);
    }
  }
} catch (e) {
  console.warn('[db] load stats failed', e && e.message);
}

// ----------------- DB (models) -----------------
let __DB = {
  models: {
    setting: {
      thumbnail: '' // isi default, bisa diupdate via API / fungsi
    },
    users: {
      totalUsers: 0
    },
    // duplikat summary stats agar mudah diakses dari db.json
    stats: {
      totalRequests: __STATS.totalRequests || 0,
      todayRequests: __STATS.todayRequests || 0,
      lastDate: __STATS.lastDate || (new Date()).toISOString().slice(0,10)
    }
  }
};

try {
  if (fs.existsSync(DB_PATH)) {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.models) {
      // merge safely
      __DB.models = Object.assign(__DB.models, parsed.models);
      // ensure stats in DB reflect current __STATS (merge prefer current stats)
      __DB.models.stats = Object.assign(__DB.models.stats || {}, {
        totalRequests: __STATS.totalRequests || 0,
        todayRequests: __STATS.todayRequests || 0,
        lastDate: __STATS.lastDate || (new Date()).toISOString().slice(0,10)
      });
    }
  }
} catch (e) {
  console.warn('[db] load db.json failed', e && e.message);
}

// ----------------- debounced save timers -----------------
let __saveStatsTimer = null;
let __saveDbTimer = null;

function saveStatsDebounced() {
  if (__saveStatsTimer) clearTimeout(__saveStatsTimer);
  __saveStatsTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATS_PATH, JSON.stringify(__STATS, null, 2), 'utf8');
    } catch (e) {
      console.error('[db] save stats failed', e && e.message);
    }
  }, 600);
}

function saveDbDebounced() {
  if (__saveDbTimer) clearTimeout(__saveDbTimer);
  __saveDbTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(__DB, null, 2), 'utf8');
    } catch (e) {
      console.error('[db] save db failed', e && e.message);
    }
  }, 600);
}

// ----------------- helpers -----------------
function ensureDaily() {
  const today = (new Date()).toISOString().slice(0,10);
  if (__STATS.lastDate !== today) {
    __STATS.todayRequests = 0;
    __STATS.lastDate = today;
    // mirror to DB models stats
    __DB.models.stats.todayRequests = 0;
    __DB.models.stats.lastDate = today;
    saveStatsDebounced();
    saveDbDebounced();
  }
}

// ----------------- API: stats operations -----------------
function incRequest(n = 1) {
  ensureDaily();
  __STATS.totalRequests = (__STATS.totalRequests || 0) + n;
  __STATS.todayRequests = (__STATS.todayRequests || 0) + n;

  // also mirror into DB models.stats
  __DB.models.stats.totalRequests = __STATS.totalRequests;
  __DB.models.stats.todayRequests = __STATS.todayRequests;
  __DB.models.stats.lastDate = __STATS.lastDate || (new Date()).toISOString().slice(0,10);

  saveStatsDebounced();
  saveDbDebounced();
}

function getStats() {
  ensureDaily();
  return {
    totalRequests: __STATS.totalRequests || 0,
    todayRequests: __STATS.todayRequests || 0,
    lastDate: __STATS.lastDate || (new Date()).toISOString().slice(0,10)
  };
}

// ----------------- SSE client management -----------------
const SSE_CLIENTS = new Set();

function addSseClient(res) {
  // prepare SSE headers (caller should already set headers, but we ensure common ones)
  try {
    res.writeHead && res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
  } catch (e) { /* ignore if headers set elsewhere */ }

  SSE_CLIENTS.add(res);
  // send initial stats event
  try {
    const payload = JSON.stringify({ type: 'stats', stats: getStats() });
    res.write(`data: ${payload}\n\n`);
  } catch (e) {}
}

function removeSseClient(res) {
  SSE_CLIENTS.delete(res);
  try { res.end(); } catch(e) {}
}

function broadcastStats() {
  const payload = JSON.stringify({ type: 'stats', stats: getStats() });
  for (const res of Array.from(SSE_CLIENTS)) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      // cleanup broken client
      try { SSE_CLIENTS.delete(res); res.end(); } catch(e2){}
    }
  }
}

// ----------------- DB models helpers (thumbnail, users etc) -----------------
function getDB() {
  // return copy to avoid accidental external mutation
  return JSON.parse(JSON.stringify(__DB));
}

function getModels() {
  // return the models object reference (if you want to mutate directly)
  return __DB.models;
}

function setThumbnail(url) {
  __DB.models.setting.thumbnail = String(url || '');
  saveDbDebounced();
}

function incTotalUsers(n = 1) {
  __DB.models.users.totalUsers = (__DB.models.users.totalUsers || 0) + n;
  saveDbDebounced();
}

function setTotalUsers(v = 0) {
  __DB.models.users.totalUsers = Number(v || 0);
  saveDbDebounced();
}

function getTotalUsers() {
  return Number(__DB.models.users.totalUsers || 0);
}

// ----------------- exports -----------------
module.exports = {
  // stats
  incRequest,
  getStats,

  // sse
  addSseClient,
  removeSseClient,
  broadcastStats,

  // db models
  getDB,
  getModels,
  setThumbnail,
  incTotalUsers,
  setTotalUsers,
  getTotalUsers
};
