// _serve-dump.cjs — 本地接收服务器：接收浏览器 POST 的姿态数据/批跑结果，保存到 _fixtures
// 支持两种格式：{ name, dataUrl }（base64，用于 _dump-poses.html 批跑）与 { name, data }（对象，用于 ai-jump.html 自动上报）
// 带 CORS，可被 http://127.0.0.1:8899（server-core.ps1）页面跨源 POST 到 http://127.0.0.1:8936/save
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = 'D:\\jump app';
const OUT_DIR = path.join(root, '_fixtures');
const PORT = parseInt(process.env.FIX_PORT || '8936', 10);
fs.mkdirSync(OUT_DIR, { recursive: true });
let saved = 0;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.json': 'application/json' };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        let b;
        if (j.dataUrl && typeof j.dataUrl === 'string') {
          b = Buffer.from(j.dataUrl.split(',')[1], 'base64');
        } else if (j.data !== undefined) {
          b = Buffer.from(JSON.stringify(j.data));
        } else {
          b = Buffer.from(JSON.stringify(j));
        }
        const safeName = String(j.name || 'anon').replace(/[\\/:*?"<>|\r\n]+/g, '_');
        fs.writeFileSync(path.join(OUT_DIR, safeName), b);
        saved++;
        console.log('saved ' + safeName + ' (' + Math.round(b.length / 1024) + 'KB, total ' + saved + ')');
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }

  const p = decodeURIComponent(req.url.split('?')[0]);
  const fp = path.join(root, p === '/' ? '/index.html' : p);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(PORT);
console.log('READY http://127.0.0.1:' + PORT + '  (CORS: *)');
