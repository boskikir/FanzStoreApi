// plugins/ai4chat.js
// Proxy plugin for https://api.nekolabs.web.id/ai/ai4chat/chat
// name: ai4chat
// category: AI

const fetch = require('node-fetch');

module.exports = {
  name: 'ai4chat',
  category: 'AI',
  path: '/ai/ai4chat/chat',
  method: 'get',
  desc: 'Proxy to nekorinn ai4chat (text is REQUIRED).',
  status: 'ready',
  params: {
    text: 'Text / prompt to send to ai4chat (required)'
  },

  handler: async (req, res) => {
    try {
      const text = (req.query && req.query.text) ? String(req.query.text).trim() : '';
      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameter 'text'."
        });
      }

      // Build upstream URL preserving any other query params
      const upstreamBase = 'https://api.nekolabs.web.id/ai/ai4chat/chat';
      const qs = Object.keys(req.query || {})
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(req.query[k])}`)
        .join('&');
      const upstreamUrl = qs ? `${upstreamBase}?${qs}` : upstreamBase;

      // timeout via AbortController
      const controller = new AbortController();
      const timeoutMs = 12000; // 12s
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(upstreamUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      }).finally(() => clearTimeout(id));

      // If upstream returned non-2xx
      if (!resp.ok) {
        // try to read body for debugging detail
        let txt = null;
        try { txt = await resp.text(); } catch(e) { txt = null; }
        return res.status(502).json({
          success: false,
          message: `Upstream returned HTTP ${resp.status}`,
          status: resp.status,
          detail: txt
        });
      }

      // Try parse JSON, fallback to text
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const json = await resp.json().catch(async (e) => {
          const raw = await resp.text().catch(()=>null);
          return { success: false, message: 'Failed to parse upstream JSON', raw };
        });
        // forward JSON as-is
        return res.json(json);
      } else {
        // non-json (e.g., plain text or image etc) -> forward as text
        const textBody = await resp.text().catch(()=>null);
        return res.json({
          success: true,
          contentType: ct,
          result: textBody
        });
      }
    } catch (err) {
      // handle abort specially
      if (err && err.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          message: 'Upstream request timed out'
        });
      }
      console.error('[plugin:ai4chat] error:', err);
      return res.status(500).json({
        success: false,
        message: 'Plugin internal error',
        detail: err && err.message
      });
    }
  }
};