// scripts/generate_iyah.js
const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(__dirname, '..', 'plugins');
const outFile = path.join(__dirname, '..', 'iyah.json');

function build() {
  if (!fs.existsSync(pluginsDir)) {
    console.error('plugins dir not found', pluginsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  const pluginCategories = {}; // { categoryName: [items...] }

  for (const file of files) {
    try {
      const p = path.join(pluginsDir, file);
      delete require.cache[require.resolve(p)];
      const mod = require(p);
      if (!mod || !mod.path) continue;

      const params = mod.params || {};
      // ensure plugin path starts with single slash
      const pluginPath = mod.path.startsWith('/') ? mod.path : '/' + mod.path;
      // build api path under /api
      const apiPath = path.posix.join('/api', pluginPath);
      const pathWithQuery = apiPath + (Object.keys(params).length ? '?' + Object.keys(params).map(k => `${k}=`).join('&') : '');

      const item = {
        name: mod.name || file.replace('.js',''),
        path: pathWithQuery,
        desc: mod.desc || '',
        status: mod.status || 'ready',
        params: mod.params || {},
        category: mod.category || 'Plugins'
      };

      const catName = (mod.category || 'Plugins');

      if (!pluginCategories[catName]) pluginCategories[catName] = [];
      pluginCategories[catName].push(item);
    } catch (err) {
      console.warn('failed to load plugin', file, err && err.message);
    }
  }

  // build categories array sorted by name (optional)
  const categories = Object.keys(pluginCategories).sort((a,b)=>a.localeCompare(b)).map(catName => ({
    name: catName,
    items: pluginCategories[catName]
  }));

  const out = { categories };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log('iyah.json generated ->', outFile);
}

build();
