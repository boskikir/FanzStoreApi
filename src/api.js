// src/api.js
// Centralized API caller — supports calling without payload (path-only calls).
// Usage examples:
//   Apis('nekorinn', '/ai/api/ai4chat', { text: 'halo' })
//   Apis('archive', '/random/blue-archive')  // <-- no payload required

const fetch = require('node-fetch');

const DEFAULT_TIMEOUT = 15000;

// default registry — edit as needed
const APIs = {
  archive: { baseURL: "https://archive.lick.eu.org" },
  anabot:  { baseURL: "https://anabot.my.id" },
  diibot:  { baseURL: "https://api.diioffc.web.id" },
  exon:    { baseURL: "https://exonity.tech" },
  gtech:   { baseURL: "https://gtech-api-xtp1.onrender.com" },
  hanggts: { baseURL: "https://api.hanggts.xyz" },
  izumii:  { baseURL: "https://izumiiiiiiii.dpdns.org" },
  lolkey:  { baseURL: "https://api.lolhuman.xyz" },
  nekorinn:{ baseURL: "https://api.nekolabs.web.id" },
  nirkyy:  { baseURL: "https://nirkyy-dev.hf.space" },
  siputzx: { baseURL: "https://api.siputzx.my.id" },
  sxtream: { baseURL: "https://api.sxtream.xyz" },
  popc:    { baseURL: "https://popcat.xyz" },
  zell:    { baseURL: "https://zellapi.autos" },
};

// helpers
const trimSlash = s => (s||'').replace(/\/+$/,'');
const ensureLeadingSlash = p => p ? (p.startsWith('/') ? p : '/' + p) : '/';
const isFullUrl = s => /^https?:\/\//i.test(s);
const objToQs = obj => {
  if (!obj || typeof obj !== 'object') return '';
  const keys = Object.keys(obj);
  if (!keys.length) return '';
  return '?' + keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(obj[k] ?? ''))}`).join('&');
};

/**
 * Apis(name, pathOrUrl, payload = undefined, options = {})
 * - payload optional: if omitted or undefined => no query/body will be added
 * - default method: GET
 */
async function Apis(name, pathOrUrl='/', payload, options = {}) {
  try {
    const entry = APIs[name];
    if (!entry) return { success: false, error: `Service "${name}" not registered` };

    const method = (options.method || 'get').toLowerCase();
    const headers = Object.assign({}, options.headers || {});
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT;

    // Build base URL + path
    let url;
    const base = entry.baseURL || '';
    if (isFullUrl(pathOrUrl)) {
      url = pathOrUrl;
    } else {
      const path = ensureLeadingSlash(pathOrUrl);
      url = trimSlash(base) + path;
    }

    // If payload is explicitly provided and is an object with keys, handle accordingly.
    // If payload is undefined or null -> do not append ? or body at all.
    const fetchOpts = { method: method.toUpperCase(), headers: Object.assign({}, headers) };

    if ((method === 'get' || method === 'delete')) {
      if (payload && typeof payload === 'object' && Object.keys(payload).length) {
        const qs = objToQs(payload);
        url = url + (url.includes('?') ? (qs ? '&' + qs.slice(1) : '') : qs);
      }
      // if payload is undefined or empty object, we append nothing
    } else {
      // POST/PUT/PATCH: if payload === undefined -> send empty body '{}'
      fetchOpts.headers['Content-Type'] = fetchOpts.headers['Content-Type'] || 'application/json';
      const bodyToSend = (typeof payload === 'undefined') ? {} : payload;
      try { fetchOpts.body = JSON.stringify(bodyToSend); } catch (e) { fetchOpts.body = '{}' }
    }

    // timeout
    const controller = new AbortController();
    fetchOpts.signal = controller.signal;
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, fetchOpts);
    clearTimeout(id);

    const status = resp.status;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    let data;
    if (ct.includes('application/json')) data = await resp.json().catch(()=>null);
    else data = await resp.text().catch(()=>null);

    if (resp.ok) {
      return { success: true, provider: name, base, url, status, data };
    } else {
      return { success: false, provider: name, base, url, status, data, error: `HTTP ${status}` };
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timeout ${options.timeoutMs || DEFAULT_TIMEOUT}ms` : err.message;
    return { success: false, error: msg, provider: name, url: pathOrUrl };
  }
}

/* registry helpers */
function register(name, baseURL, opts = {}) {
  if (!name || !baseURL) throw new Error('register(name, baseURL) both required');
  APIs[name] = Object.assign({}, APIs[name] || {}, { baseURL }, opts);
  return APIs[name];
}
function update(name, opts = {}) {
  if (!APIs[name]) throw new Error(`Service ${name} not registered`);
  if (opts.baseURL) APIs[name].baseURL = opts.baseURL;
  if (opts.apiKey) APIs[name].apiKey = opts.apiKey;
  if (opts.apiKeyHeader) APIs[name].apiKeyHeader = opts.apiKeyHeader;
  if (opts.apiKeyQueryName) APIs[name].apiKeyQueryName = opts.apiKeyQueryName;
  return APIs[name];
}
function remove(name) { if (APIs[name]) delete APIs[name]; return true; }
function list() { return Object.assign({}, APIs); }

module.exports = { Apis, register, update, remove, list, _APIs: APIs };
