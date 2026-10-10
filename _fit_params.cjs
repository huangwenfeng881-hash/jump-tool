// _fit_params.cjs — 读 _mp_poses/*.json，用当前 js/pose.js 算法跑，与文件名标注真值(离地时刻X/落地时刻Y)对比；
// 输出每个视频误差 + 全局命中率。可选 SCAN=1 扫描 [落地med, 起跳主, 确认] 找命中最多组合。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = 'D:\\jump app';
const posesDir = path.join(root, '_mp_poses');

function loadPose() {
  const sandbox = {
    window: {}, document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
    navigator: { userAgent: 'node' }, location: { href: '', search: '' }, console: console,
    setTimeout, clearTimeout, Promise, Math, JSON, Date, isFinite, parseInt, parseFloat, URL, Blob, fetch: () => Promise.reject(new Error('no fetch'))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'pose.js'), 'utf8'), sandbox, { filename: 'pose.js' });
  return sandbox.window.VTPose;
}

function parseGT(name) {
  const lo = /离地时刻(\d+)/.exec(name);
  const la = /落地时刻(\d+)/.exec(name);
  if (!lo || !la) return null;
  return { lo: parseInt(lo[1], 10), la: parseInt(la[1], 10) };
}

function runOn(poseSrc, VTPose, j, variant) {
  const data = j.poseData || [];
  const fps = j.fps || 30;
  if (!data.length) return null;
  let VT = VTPose;
  if (variant) {
    let src = poseSrc
      .replace(/dv <= med \* [0-9.]+ \|\| dv <= 0\.\d+/g, 'dv <= med * ' + variant.LM + ' || dv <= ' + variant.AB)
      .replace(/sH\[q\] > mVal \+ [0-9.]+ &&/g, 'sH[q] > mVal + ' + variant.LO1 + ' &&')
      .replace(/sH\[q \+ 1\] >= mVal \+ [0-9.]+/g, 'sH[q + 1] >= mVal + ' + variant.LO2)
      .replace(/d2 < med \* 0\.[0-9]+ && d3 < med \* 0\.[0-9]+ && d4 < med \* 0\.[0-9]+/g, 'd2 < med * ' + variant.CF + ' && d3 < med * ' + variant.CF + ' && d4 < med * ' + variant.CF);
    const sb = {
      window: {}, document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
      navigator: { userAgent: 'node' }, location: { href: '', search: '' }, console: console,
      setTimeout, clearTimeout, Promise, Math, JSON, Date, isFinite, parseInt, parseFloat, URL, Blob, fetch: () => Promise.reject(new Error('no fetch'))
    };
    sb.window = sb;
    vm.createContext(sb);
    try {
      vm.runInContext(src, sb, { filename: 'pose.js' });
      VT = sb.window.VTPose;
    } catch (e) { return null; }
  }
  try {
    const m = VT.computeJumpMetrics(data, { fps });
    if (!m.ok || !m.best) return null;
    const b = m.best;
    return { lo: Math.round(b.jump.liftoffTime * fps) + 1, la: Math.round(b.jump.landingTime * fps) + 1, h: b.jump.heightCm, src: b.jump.source };
  } catch (e) { return null; }
}

function evaluate(poseSrc, VTPose, variant) {
  const files = fs.readdirSync(posesDir).filter(f => f.endsWith('.json'));
  const rows = [];
  let hit = 0, total = 0, loSum = 0, laSum = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(posesDir, f), 'utf8'));
    const gt = parseGT(j.video || f);
    if (!gt) continue;
    const r = runOn(poseSrc, VTPose, j, variant);
    if (!r) continue;
    total++;
    const dlo = r.lo - gt.lo, dla = r.la - gt.la;
    loSum += Math.abs(dlo); laSum += Math.abs(dla);
    if (Math.abs(dlo) <= 1 && Math.abs(dla) <= 1) hit++;
    rows.push({ name: f.replace(/\.json$/, ''), gt, r, dlo, dla });
  }
  return { rows, hit, total, loSum, laSum };
}

function main() {
  const poseSrc = fs.readFileSync(path.join(root, 'js', 'pose.js'), 'utf8');
  const VTPose = loadPose();
  const scan = process.env.SCAN === '1';
  if (!scan) {
    const ev = evaluate(poseSrc, VTPose, null);
    console.log('当前算法: 命中(±1帧) ' + ev.hit + '/' + ev.total + '  平均离地误差 ' + (ev.loSum / Math.max(1, ev.total)).toFixed(2) + '  落地误差 ' + (ev.laSum / Math.max(1, ev.total)).toFixed(2));
    for (const r of ev.rows) {
      console.log('  ' + r.name.replace(/\.json$/, '') + '  GT ' + r.gt.lo + '/' + r.gt.la + '  vs  ' + r.r.lo + '/' + r.r.la + '  (Δ' + (r.dlo >= 0 ? '+' : '') + r.dlo + '/' + (r.dla >= 0 ? '+' : '') + r.dla + ')  ' + r.r.src);
    }
    return;
  }
  // 扫描
  const LMs = [0.5, 0.55, 0.6, 0.65, 0.68, 0.72, 0.78, 0.85, 0.95];
  const ABs = [0.007, 0.015, 0.02, 0.03, 0.04];
  const LO1s = [0.3, 0.4, 0.5, 0.6, 0.7];
  const LO2s = [0.2, 0.3, 0.4];
  const CFs = [0.6, 0.7, 0.8, 0.9];
  let best = null, bestScore = -1, bestRows = null;
  for (const LM of LMs) for (const AB of ABs) for (const LO1 of LO1s) for (const LO2 of LO2s) for (const CF of CFs) {
    const ev = evaluate(poseSrc, VTPose, { LM, AB, LO1, LO2, CF });
    if (ev.total === 0) continue;
    // 分数：命中数优先，其次平均误差小
    const score = ev.hit - (ev.loSum + ev.laSum) / Math.max(1, ev.total) * 0.2;
    if (score > bestScore) { bestScore = score; best = { LM, AB, LO1, LO2, CF, ev }; }
  }
  if (best) {
    const b = best;
    console.log('BEST: 落地med=' + b.LM + ' 绝对=' + b.AB + ' 起跳主=' + b.LO1 + ' 确认=' + b.LO2 + ' confirm=' + b.CF);
    console.log('  命中(+/-1帧) ' + b.ev.hit + '/' + b.ev.total + '  平均离地误差 ' + (b.ev.loSum / b.ev.total).toFixed(2) + '  落地误差 ' + (b.ev.laSum / b.ev.total).toFixed(2));
    for (const r of b.ev.rows) console.log('    ' + r.name.replace(/\.json$/, '') + '  GT ' + r.gt.lo + '/' + r.gt.la + '  vs  ' + r.r.lo + '/' + r.r.la + '  (Δ' + (r.dlo >= 0 ? '+' : '') + r.dlo + '/' + (r.dla >= 0 ? '+' : '') + r.dla + ')');
  }
}
main();
