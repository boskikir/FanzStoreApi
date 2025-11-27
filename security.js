// security.js (CommonJS) - safe replacement for your project
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const helmet = require('helmet');
const cors = require('cors');
const express = require('express');

function applySecurity(app) {

  // ------------------------------------
  // IMPORTANT: trust proxy for hosted env
  // If your app sits behind a proxy (Replit, Heroku, Vercel, nginx, etc)
  // enable trust proxy so req.ip uses X-Forwarded-For correctly.
  // Set to '1' for single-proxy deployments; use true if you prefer.
  // ------------------------------------
  try {
    app.set('trust proxy', 1); // <- fix for ValidationError from express-rate-limit
  } catch (e) { /* ignore if not supported */ }

  // ------------------------------
  // 1. Security headers
  // ------------------------------
  app.use(helmet());
  try { app.disable && app.disable('x-powered-by'); } catch(e){}

  // ------------------------------
  // 2. CORS
  // ------------------------------
  app.use(cors({
    origin: '*',
    methods: ['GET','POST','OPTIONS','PUT','DELETE']
  }));

  // ------------------------------
  // 3. Body parsers with small limits
  // Note: if index.js already calls express.json() with a different limit,
  // we still add a lightweight parser here for extra protection.
  // ------------------------------
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  // ------------------------------
  // 4. Global Rate Limit
  // ------------------------------
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,   // 1 minute
    max: 100,              // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the RateLimit-* headers
    legacyHeaders: false,  // Disable the deprecated X-RateLimit-* headers
    handler: (req, res /*, next */) => {
      // ensure JSON response, not a string
      res.status(429).json({ success:false, error:'Too many requests — Slow down!' });
    }
  });
  app.use(globalLimiter);

  // ------------------------------
  // 5. Slow Down (throttle repeated requests)
  // express-slow-down v2 wants delayMs as function; to silence warning:
  // ------------------------------
  const speedLimiter = slowDown({
    windowMs: 60 * 1000,
    delayAfter: 50,
    // new behaviour: function
    delayMs: () => 300,
    // optional: disable internal validation warning if needed
    // validate: { delayMs: false } // uncomment to silence strict validation
  });
  app.use(speedLimiter);

  // ------------------------------
  // 6. Login-specific rate limit
  // ------------------------------
  const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ success:false, error:'Terlalu banyak percobaan login!' });
    }
  });
  // apply only to login routes (provide multiple paths)
  app.use(['/auth/login','/login','/api/login'], loginLimiter);

  // ------------------------------
  // 7. Block common scanner paths
  // ------------------------------
  const blockedPaths = new Set([
    '/wp-admin', '/xmlrpc.php', '/phpmyadmin', '/.env',
    '/server-status', '/admin', '/config', '/backup'
  ]);

  app.use((req,res,next)=>{
    if (blockedPaths.has(req.path)) {
      res.status(404).type('text').send('Not found');
      return;
    }
    next();
  });

  console.log('[SECURITY] Proteksi aktif ✔ (trust proxy:', app.get('trust proxy'), ')');
}

module.exports = { applySecurity };