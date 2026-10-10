// _scan.cjs — 在真实 poseData（单调索引时间轴）上离线扫描 [落地med×落地绝对阈值×起跳主×确认]，
// 用 vm 加载替换了阈值的 pose.js，找接近标注真值(离地48/落地74)的组合。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = 'D:\\jump app';
const outDir = path.join(root, '_fixtures');
const f = fs.readdirSync(outDir).find(x => /^pose_/.test(x) && fs.statSync(path.join(outDir, x)).isFile());
const j = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
const data = j.data && j.data.poseData ? j.data.poseData : (j.poseData || []);
const fps = (j.data && j.data.fps) || j.fps || 30;
const poseSrc = fs.readFileSync(path.join(root, 'js', 'pose.js'), 'utf8');

function run(LM, AB, LO1, LO2) {
  const dt = data.map((x, i) => ({ ...x, t: i / fps }));
  let src = poseSrc
    .replace(/dv <= med \* [0-9.]+ \|\| dv <= 0\.\d+/g, 'dv <= med * ' + LM + ' || dv <= ' + AB)
    .replace(/sH\[q\] > mVal \+ [0-9.]+ &&/g, 'sH[q] > mVal + ' + LO1 + ' &&')
    .replace(/sH\[q \+ 1\] >= mVal \+ [0-9.]+/g, 'sH[q + 1] >= mVal + ' + LO2);
  const sandbox = {
    window: {},
    document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
    navigator: { userAgent: 'node' }, location: { href: '', search: '' }, console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, Math: Math, JSON: JSON, Date: Date, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat, URL: URL, Blob: Blob, fetch: () => Promise.reject(new Error('no fetch'))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(src, sandbox, { filename: 'pose.js' });
    const VTPose = sandbox.window.VTPose;
    const m = VTPose.computeJumpMetrics(dt, { fps: fps });
    if (!m.ok) return { ok: false, msg: m.msg };
    const b = m.best;
    const lo = Math.round(b.jump.liftoffTime * fps) + 1;
    const la = Math.round(b.jump.landingTime * fps) + 1;
    return { ok: true, lo, la, h: b.jump.heightCm, src: b.jump.source, n: m.jumps.length, tk: (b.takeoff && b.takeoff.type) };
  } catch (e) { return { ok: false, msg: e.message }; }
}

const LMs = [0.6, 0.68, 0.76, 0.85, 1.0, 1.15, 1.25];
const ABs = [0.007, 0.01, 0.012, 0.015, 0.02, 0.025, 0.03];
const LO1s = [0.4, 0.5, 0.6, 0.7];
const LO2s = [0.25, 0.35, 0.45];

let best = null, bestScore = 1e9;
const results = [];
for (const LM of LMs) for (const AB of ABs) for (const LO1 of LO1s) for (const LO2 of LO2s) {
  const r = run(LM, AB, LO1, LO2);
  if (!r.ok || r.src !== 'feet') continue;
  const score = Math.abs(r.lo - 48) + Math.abs(r.la - 74) * 2;
  results.push({ LM, AB, LO1, LO2, lo: r.lo, la: r.la, h: Math.round(r.h * 10) / 10, tk: r.tk, score });
  if (score < bestScore) { bestScore = score; best = results[results.length - 1]; }
}

const top = results.slice().sort((a, b) => a.score - b.score).slice(0, 35);
console.log('候选 (落地med | 绝对 | 起跳主 | 确认) -> 离地/落地 高度 起跳 分数');
for (const r of top) console.log('  ' + r.LM + ' | ' + r.AB + ' | ' + r.LO1 + ' | ' + r.LO2 + '  ->  ' + r.lo + '/' + r.la + '  ' + r.h + 'cm  ' + r.tk + '  score=' + r.score);
console.log('\nBEST: ' + JSON.stringify(best));
