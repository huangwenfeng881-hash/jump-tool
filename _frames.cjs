// _frames.cjs — 用 headless Chrome 跑一个本地页面，页面把结果 POST 回本地服务器落盘（无 CDP 依赖）
// 用法: node _frames.cjs [page] [outdir] [expect]
//   page  : 要打开的页面名（默认 _frames-page.html）
//   outdir: 输出目录（默认 ./_frames）
//   expect: 期望收到的文件数（默认 31）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = __dirname;
const PORT = parseInt(process.env.FRAMES_PORT || '8899', 10);
const CDP_PORT = parseInt(process.env.FRAMES_CDP_PORT || '9333', 10);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = process.argv[2] || '_frames-page.html';
const OUT = process.argv[3] || path.join(root, '_frames');
const EXPECT = parseInt(process.argv[4] || '31', 10);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

fs.mkdirSync(OUT, { recursive: true });
let saved = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        const b = Buffer.from(j.dataUrl.split(',')[1], 'base64');
        fs.writeFileSync(path.join(OUT, j.name), b);
        saved++;
        console.log('saved ' + j.name + ' (' + Math.round(b.length / 1024) + 'KB, total ' + saved + ')');
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update',
  '--mute-audio', '--disable-dev-shm-usage',
  '--enable-features=SharedArrayBuffer',
  '--use-gl=angle', '--use-angle=vulkan', '--use-vulkan=swiftshader',
  '--enable-unsafe-swiftshader',
  'http://127.0.0.1:' + PORT + '/' + PAGE
], { stdio: 'ignore' });

function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

// 等待全部结果落盘，超时 240s
const t0 = Date.now();
const timer = setInterval(() => {
  if (saved >= EXPECT) { clearInterval(timer); console.log('ALL SAVED (' + saved + ')'); cleanup(0); }
  else if (Date.now() - t0 > 240000) { clearInterval(timer); console.error('TIMEOUT, saved ' + saved + '/' + EXPECT); cleanup(1); }
}, 500);
