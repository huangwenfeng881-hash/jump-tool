// _syntax-check.cjs — 提取所有 HTML 的内联 <script> 并做语法检查（classic 用 new Function，module 用 node --check 临时文件）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = 'D:\\jump app';
const htmls = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let total = 0, failed = 0, skipped = 0;
const failures = [];

for (const h of htmls) {
  const src = fs.readFileSync(path.join(root, h), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, idx = 0;
  while ((m = re.exec(src)) !== null) {
    idx++;
    total++;
    const attrs = m[1] || '';
    const code = m[2] || '';
    const isModule = /type=["']module["']/i.test(attrs);
    const hasSrc = /src=/i.test(attrs);
    if (hasSrc || !code.trim()) { skipped++; continue; }
    if (isModule) {
      const tmp = path.join(os.tmpdir(), 'vt-inline-' + process.pid + '-' + idx + '.mjs');
      try {
        fs.writeFileSync(tmp, code, 'utf8');
        execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
      } catch (e) {
        failed++;
        failures.push(h + ' #' + idx + ' [module]: ' + String(e.stderr || e.message).split('\n').slice(0, 4).join(' | '));
      } finally {
        try { fs.unlinkSync(tmp); } catch (e2) {}
      }
    } else {
      try {
        new Function(code); // eslint-disable-line no-new-func
      } catch (e) {
        failed++;
        failures.push(h + ' #' + idx + ' [classic]: ' + e.message);
      }
    }
  }
}

// pose.js
try {
  execFileSync(process.execPath, ['--check', path.join(root, 'js', 'pose.js')], { stdio: 'pipe' });
  console.log('js/pose.js: OK');
} catch (e) {
  failed++;
  failures.push('js/pose.js: ' + String(e.stderr || e.message));
}

console.log('HTML 内联脚本: ' + total + ' 段（跳过 ' + skipped + ' 段外链/空）');
if (failures.length) {
  console.log('FAILED ' + failed + ':');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部语法 OK');
