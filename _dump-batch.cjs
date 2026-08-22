// _dump-batch.cjs — 跑 _dump-poses.html 生成 20 个视频的回归夹具（fixtures/fx_*.json）
// 用法: node _dump-batch.cjs   （输出到 D:\jump app\_fixtures\）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = 'D:\\jump app';
const OUT_DIR = path.join(root, '_fixtures');
const PORT = parseInt(process.env.FIX_PORT || '8935', 10);
const CDP_PORT = parseInt(process.env.FIX_CDP_PORT || '9365', 10);
const EXPECT = parseInt(process.env.FIX_EXPECT || '20', 10);
const VID_LIST = process.env.FIX_VIDS || '';
const DIM = process.env.FIX_DIM || '';
const SAM = process.env.FIX_SAM || '';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.json': 'application/json' };

fs.mkdirSync(OUT_DIR, { recursive: true });
let saved = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const b = Buffer.from(j.dataUrl.split(',')[1], 'base64');
        fs.writeFileSync(path.join(OUT_DIR, j.name), b);
        saved++;
        console.log('saved ' + j.name + ' (' + Math.round(b.length / 1024) + 'KB, ' + saved + '/' + EXPECT + ')');
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-fix-'));
// FIX_HEADED=1 时有头模式（真实 GPU 加速，推理快 ~100 倍）；默认无头（软件渲染，慢）
const headed = process.env.FIX_HEADED === '1';
const chromeArgs = [
  '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update',
  '--mute-audio', '--disable-dev-shm-usage',
  '--enable-features=SharedArrayBuffer',
  'http://127.0.0.1:' + PORT + '/_dump-poses.html' + (VID_LIST ? '?vids=' + VID_LIST : '') + (DIM ? '&dim=' + DIM : '') + (SAM ? '&sam=' + SAM : '') + '&light=1'
];
if (headed) {
  // 有头：隐藏窗口到屏幕外，让 Chrome 用真实 GPU
  chromeArgs.unshift('--window-position=-32000,-32000', '--window-size=800,600');
} else {
  chromeArgs.unshift(
    '--headless=new',
    '--enable-logging=stderr', '--v=0',
    '--use-gl=angle', '--use-angle=vulkan', '--use-vulkan=swiftshader',
    '--enable-unsafe-swiftshader'
  );
}
const chrome = spawn(CHROME, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stdout.on('data', d => { const s = String(d); if (s.indexOf('saved ') >= 0 || s.indexOf('ALL DONE') >= 0 || s.indexOf('[') >= 0) process.stdout.write('[page] ' + s); });
chrome.stderr.on('data', d => { const s = String(d).trim(); if (s && s.indexOf('PdhAddEnglishCounter') < 0 && s.indexOf('main.crx') < 0) process.stdout.write('[chrome] ' + s.split('\n').slice(0, 2).join(' | ') + '\n'); });
chrome.on('error', e => console.error('[chrome spawn error] ' + e.message));

function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

const t0 = Date.now();
const timer = setInterval(() => {
  if (saved >= EXPECT) { clearInterval(timer); console.log('ALL SAVED'); cleanup(0); }
  else if (Date.now() - t0 > 50 * 60 * 1000) { clearInterval(timer); console.error('TIMEOUT, saved ' + saved + '/' + EXPECT); cleanup(1); }
}, 1000);
