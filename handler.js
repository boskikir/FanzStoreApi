// handler.js
const fs = require('fs');
const path = require('path');

/**
 * require lib/database (jika ada) — aman jika tidak ada (null)
 */
const db = (() => {
  try { return require(path.join(__dirname, 'lib', 'database.js')); }
  catch(e) {
    try { return require('./lib/database.js'); } catch(e2) { return null; }
  }
})();

/**
 * wrapHandler(fn)
 * - wraps plugin handler to catch errors and return 500 if error thrown
 * - minimal change: increment stats and broadcast when request arrives
 */
function wrapHandler(fn) {
  return async (req, res, next) => {
    try {
      // increment counters (minimal, increments on request arrival)
      try { if (db && typeof db.incRequest === 'function') db.incRequest(1); } catch(e){}

      // broadcast updated stats to SSE clients (if available)
      try { if (db && typeof db.broadcastStats === 'function') db.broadcastStats(); } catch(e){}

      await Promise.resolve(fn(req, res, next));
    } catch (e) {
      console.error('[handler] plugin error:', e);
      if (!res.headersSent) res.status(500).json({ error: e.message || 'Plugin error' });
    }
  };
}

/**
 * Helper: normalizeParamsForUi(paramsFromPlugin)
 * - ensures params are objects of the form:
 *   { name: { description: string, required: boolean, ...other } }
 * - if plugin provided string value -> treated as description
 * - heuristic: param named "text" => required: true (per user request)
 */
function normalizeParamsForUi(params = {}) {
  const out = {};
  if (!params || typeof params !== 'object') return out;

  for (const key of Object.keys(params)) {
    const val = params[key];
    if (typeof val === 'string') {
      out[key] = {
        description: val || '',
        required: (key.toLowerCase() === 'text') // heuristic: text => required
      };
    } else if (val && typeof val === 'object') {
      // accept plugin-provided object, but ensure required boolean exists
      out[key] = Object.assign({ description: '', required: false }, val);
      // if plugin provided description as string in val.description keep it
      // keep any extra props intact
      if (typeof out[key].required === 'undefined') out[key].required = false;
    } else {
      out[key] = { description: '', required: false };
    }
  }
  return out;
}

/**
 * buildIyahFile(loadedPlugins, outFile)
 * - builds structured categories array and writes to outFile (atomic)
 * - canonicalizes plugin paths to root-based (no /api prefix)
 */
function buildIyahFile(loadedPlugins = [], outFile) {
  try {
    // group by category
    const pluginCategories = {}; // { categoryName: [items...] }
    for (const p of loadedPlugins) {
      const cat = (p.category || 'Plugins');
      if (!pluginCategories[cat]) pluginCategories[cat] = [];

      // p.path is the full registered path (e.g. "/api/random/blue-archive" or "/random/blue-archive")
      // canonicalize: remove leading /api if present
      const canonical = (p.path || '').replace(/^\/api\//, '/');

      // normalize params for UI/iyah.json
      const normalizedParams = normalizeParamsForUi(p.params || {});

      // prepare pathWithQuery if params exist
      const paramKeys = Object.keys(normalizedParams || {});
      const pathWithQuery = canonical + (paramKeys.length ? '?' + paramKeys.map(k => `${k}=`).join('&') : '');

      pluginCategories[cat].push({
        name: p.name || '',
        path: pathWithQuery,
        desc: p.desc || '',
        status: p.status || 'ready',
        params: normalizedParams,
        category: cat
      });
    }

    // convert to categories array sorted by category name (deterministic)
    const categories = Object.keys(pluginCategories)
      .sort((a, b) => a.localeCompare(b))
      .map(catName => ({
        name: catName,
        items: pluginCategories[catName]
      }));

    const out = { categories };
    // write atomically to avoid partial writes
    const tmp = outFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
    fs.renameSync(tmp, outFile);
    console.log('[handler] iyah.json generated ->', outFile);
    return true;
  } catch (e) {
    console.error('[handler] failed to build iyah.json', e && e.message);
    return false;
  }
}

/**
 * loadPlugins(app, options)
 * - app: express app
 * - options: { pluginsDir, baseRoute, writeIyah: true/false, iyahPath }
 *
 * Returns an array of loaded plugin metadata objects:
 *  { file, name, path, method, desc, status, params, category }
 */
function loadPlugins(app, options = {}) {
  const pluginsDir = options.pluginsDir || path.join(__dirname, 'plugins');
  const baseRoute = (typeof options.baseRoute === 'string') ? options.baseRoute : '/api';
  const writeIyah = (typeof options.writeIyah === 'boolean') ? options.writeIyah : true;
  const iyahPath = options.iyahPath || path.join(process.cwd(), 'iyah.json');

  if (!fs.existsSync(pluginsDir)) {
    console.warn('[handler] plugins dir not found:', pluginsDir);
    return [];
  }

  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  const loaded = [];

  for (const file of files) {
    try {
      const p = path.join(pluginsDir, file);
      // clear cache so changes reflected without restart
      try { delete require.cache[require.resolve(p)]; } catch (e) {}
      const mod = require(p);

      if (!mod || !mod.path || !mod.handler) {
        console.warn(`[handler] skipping ${file} (missing path or handler)`);
        continue;
      }

      const method = (mod.method || 'get').toLowerCase();

      // ensure leading slash for mod.path
      let pluginPath = mod.path.startsWith('/') ? mod.path : '/' + mod.path;
      // fullPath join baseRoute with pluginPath (normalize to posix)
      let fullPath = path.posix.join(baseRoute, pluginPath).replace(/\\/g, '/');
      // ensure it starts with slash
      if (!fullPath.startsWith('/')) fullPath = '/' + fullPath;

      // register route
      if (method === 'get') app.get(fullPath, wrapHandler(mod.handler));
      else if (method === 'post') app.post(fullPath, wrapHandler(mod.handler));
      else if (method === 'all') app.all(fullPath, wrapHandler(mod.handler));
      else {
        console.warn(`[handler] unsupported method ${method} in ${file}`);
        continue;
      }

      // Normalize params for UI/iyah.json (so meta.params has consistent shape)
      const normalizedParams = normalizeParamsForUi(mod.params || {});

      const meta = {
        file,
        name: mod.name || file.replace('.js', ''),
        path: fullPath, // registered path
        method,
        desc: mod.desc || '',
        status: mod.status || 'ready',
        params: normalizedParams,
        category: mod.category || 'Plugins'
      };

      loaded.push(meta);
      console.log(`[handler] loaded plugin ${file} => ${method.toUpperCase()} ${fullPath}`);
    } catch (e) {
      console.error(`[handler] error loading ${file}:`, e && e.message);
    }
  }

  // After loading all plugins, optionally write iyah.json based on loaded plugins
  if (writeIyah) {
    try {
      buildIyahFile(loaded, iyahPath);
    } catch (e) {
      console.error('[handler] error writing iyah.json:', e && e.message);
    }
  }

  return loaded;
}

module.exports = { loadPlugins };