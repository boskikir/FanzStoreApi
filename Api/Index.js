// api/index.js (CommonJS)
const path = require('path');

// load express app (yang kamu buat di index.js)
const app = require(path.join(__dirname, '..', 'index.js'));

// export as Vercel handler
module.exports = (req, res) => {
  return app(req, res);
};
