// api/index.js (CommonJS)
const path = require('path');

// load express app dari index.js root
const app = require(path.join(__dirname, '..', 'index.js'));

// export as Vercel serverless function
module.exports = app;
