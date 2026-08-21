// _app-smoke.cjs — assets/app 打包页面冒烟测试：serve assets 目录 → headless Chrome 打开 smoke 页 → 等 POST /save 落盘
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const assetsRoot = 'D:\\jump app\\android\\app\\src\\main\\assets\\app';
const smokePage = 'D:\\jump app\\_smoke-app.html';
const PORT = parseInt(process.env.APP_PORT || '8931', 10);
const CDP_PORT = parseInt(process.env.APP_CDP_PORT || '9361', 10);
const OUT = path.join('D:\\jump app\\_frames', 'app-smoke.json');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon'
};

let savedCount = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        fs.writeFileSync(OUT, Buffer.from(j.dataUrl.split(',')[1], 'base64'));
        savedCount++;
        console.log('SAVED #' + savedCount + ' ' + OUT);
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/smoke.html') {
    fs.readFile(smokePage, (e, d) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
    });
    return;
  }
  if (p === '/') p = '/ai-jump.html';
  const fp = path.join(assetsRoot, p);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
server.listen(PORT);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-app-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update',
  '--mute-audio', '--disable-dev-shm-usage',
  '--enable-features=SharedArrayBuffer',
  '--use-gl=angle', '--use-angle=vulkan', '--use-vulkan=swiftshader',
  '--enable-unsafe-swiftshader',
  'http://127.0.0.1:' + PORT + '/smoke.html'
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', d => console.log('[chrome] ' + String(d).trim().split('\n').slice(0, 3).join(' | ')));
chrome.on('error', e => console.error('[chrome spawn error] ' + e.message));
chrome.on('exit', (code, sig) => console.log('[chrome exited] code=' + code + ' sig=' + sig));

function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

const t0 = Date.now();
const timer = setInterval(() => {
  // 需要收到 ping + final 两份结果
  if (savedCount >= 2) { clearInterval(timer); console.log('SMOKE DONE'); cleanup(0); }
  else if (Date.now() - t0 > 90000) { clearInterval(timer); console.error('SMOKE TIMEOUT, saved=' + savedCount); cleanup(1); }
}, 500);
