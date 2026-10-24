const http = require('http');

// HTTP server عشان Fly.io ما يوقفش الـ app
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => { res.writeHead(200); res.end('NVR Bot Online'); }).listen(PORT);

// شغّل البوت مباشرة
require('./bot.js');
