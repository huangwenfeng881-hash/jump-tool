// _serve-app.cjs — 临时验证：serve assets/app 目录 + 冒烟页 /smoke.html，结果 POST /save
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = 'D:\\jump app\\android\\app\\src\\main\\assets\\app';
const smokePage = 'D:\\jump app\\_smoke-app.html';
const PORT = parseInt(process.env.APP_PORT || '8931', 10);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        fs.writeFileSync(path.join('D:\\jump app\\_frames', j.name), Buffer.from(j.dataUrl.split(',')[1], 'base64'));
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/smoke.html') { fs.readFile(smokePage, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d); }); return; }
  if (p === '/') p = '/ai-jump.html';
  const fp = path.join(root, p);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(PORT, () => console.log('serve on ' + PORT));
