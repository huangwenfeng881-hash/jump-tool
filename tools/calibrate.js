#!/usr/bin/env node
// tools/calibrate.js — 用当前 js/pose.js 算法跑 tools/extract_poses.py 提取的姿态数据，与文件名标注真值自动对比。
//
// 用法（项目根目录）:
//   node tools/calibrate.js                          # 评估默认 _mp_poses 全部视频 vs 标注
//   node tools/calibrate.js --poses my_poses          # 指定姿态数据目录
//   node tools/calibrate.js --only "44-53"            # 只跑文件名含关键词的视频
//   node tools/calibrate.js --scan                    # 扫描 [落地med,落绝对,起跳主,确认,confirm] 找命中最多
//
// 标注真值来源：文件名里的「离地时刻X」「落地时刻Y」（1-based）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_POSES = path.join(ROOT, '_mp_poses');

function loadVTPose() {
  const sandbox = {
    window: {}, document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
    navigator: { userAgent: 'node' }, location: { href: '', search: '' }, console: console,
    setTimeout, clearTimeout, Promise, Math, JSON, Date, isFinite, parseInt, parseFloat, URL, Blob, fetch: () => Promise.reject(new Error('no fetch'))
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'pose.js'), 'utf8'), sandbox, { filename: 'pose.js' });
  return sandbox.window.VTPose;
}

function sandboxFor(src) {
  const sb = {
    window: {}, document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
    navigator: { userAgent: 'node' }, location: { href: '', search: '' }, console: console,
    setTimeout, clearTimeout, Promise, Math, JSON, Date, isFinite, parseInt, parseFloat, URL, Blob, fetch: () => Promise.reject(new Error('no fetch'))
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'pose.js' });
  return sb.window.VTPose;
}

function parseGT(name) {
  const lo = /离地时刻(\d+)/.exec(name);
  const la = /落地时刻(\d+)/.exec(name);
  if (!lo || !la) return null;
  return { lo: parseInt(lo[1], 10), la: parseInt(la[1], 10) };
}

function applyVariant(src, v) {
  return src
    .replace(/dv <= med \* [0-9.]+ \|\| dv <= 0\.\d+/g, 'dv <= med * ' + v.LM + ' || dv <= ' + v.AB)
    .replace(/sH\[q\] > mVal \+ [0-9.]+ &&/g, 'sH[q] > mVal + ' + v.LO1 + ' &&')
    .replace(/sH\[q \+ 1\] >= mVal \+ [0-9.]+/g, 'sH[q + 1] >= mVal + ' + v.LO2)
    .replace(/d2 < med \* 0\.[0-9]+ && d3 < med \* 0\.[0-9]+ && d4 < med \* 0\.[0-9]+/g, 'd2 < med * ' + v.CF + ' && d3 < med * ' + v.CF + ' && d4 < med * ' + v.CF);
}

function runOn(data, fps, VTPose, variant) {
  if (!data.length) return null;
  let VT = VTPose;
  if (variant) {
    // 需按替换后的源码重载，才能让阈值生效
    const poseSrc = fs.readFileSync(path.join(ROOT, 'js', 'pose.js'), 'utf8');
    VT = sandboxFor(applyVariant(poseSrc, variant));
  }
  try {
    const m = VT.computeJumpMetrics(data, { fps });
    if (!m.ok || !m.best) return null;
    const b = m.best;
    return { lo: Math.round(b.jump.liftoffTime * fps) + 1, la: Math.round(b.jump.landingTime * fps) + 1, h: b.jump.heightCm, src: b.jump.source, jumps: m.jumps || [] };
  } catch (e) { return null; }
}

function listVideos(posesDir, only) {
  return fs.readdirSync(posesDir).filter(f => f.endsWith('.json') && (!only || f.includes(only)));
}

function evaluate(VTPose, posesDir, only, variant) {
  const files = listVideos(posesDir, only);
  const rows = []; let hit = 0, total = 0, loSum = 0, laSum = 0;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(posesDir, f), 'utf8'));
    const gt = parseGT(j.video || f);
    if (!gt) continue;
    const r = runOn(j.poseData || [], j.fps || 30, VTPose, variant);
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
  const args = process.argv.slice(2);
  let posesDir = DEFAULT_POSES, only = '', scan = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--poses') posesDir = args[++i];
    else if (args[i] === '--only') only = args[++i];
    else if (args[i] === '--scan') scan = true;
    else { console.error('未知参数: ' + args[i]); process.exit(1); }
  }
  const poseSrc = fs.readFileSync(path.join(ROOT, 'js', 'pose.js'), 'utf8');
  const VTPose = loadVTPose();

  if (!scan) {
    const ev = evaluate(VTPose, posesDir, only, null);
    console.log('当前算法: 命中(±1帧) ' + ev.hit + '/' + ev.total + '  平均离地误差 ' + (ev.loSum / Math.max(1, ev.total)).toFixed(2) + '  落地误差 ' + (ev.laSum / Math.max(1, ev.total)).toFixed(2));
    for (const r of ev.rows) {
      console.log('  ' + r.name + '  GT ' + r.gt.lo + '/' + r.gt.la + '  vs  ' + r.r.lo + '/' + r.r.la + '  (Δ' + (r.dlo >= 0 ? '+' : '') + r.dlo + '/' + (r.dla >= 0 ? '+' : '') + r.dla + ')  ' + r.r.src);
    }
    return;
  }

  // 扫描
  const LMs = [0.5, 0.55, 0.6, 0.65, 0.68, 0.72, 0.78, 0.85, 0.95];
  const ABs = [0.007, 0.015, 0.02, 0.03, 0.04];
  const LO1s = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const LO2s = [0.2, 0.3, 0.4];
  const CFs = [0.6, 0.7, 0.8, 0.9];
  let best = null, bestScore = -1;
  for (const LM of LMs) for (const AB of ABs) for (const LO1 of LO1s) for (const LO2 of LO2s) for (const CF of CFs) {
    const ev = evaluate(VTPose, posesDir, only, { LM, AB, LO1, LO2, CF });
    if (ev.total === 0) continue;
    const score = ev.hit - (ev.loSum + ev.laSum) / Math.max(1, ev.total) * 0.2;
    if (score > bestScore) { bestScore = score; best = { LM, AB, LO1, LO2, CF, ev }; }
  }
  if (!best) { console.log('没有可评估的视频'); return; }
  const b = best;
  console.log('BEST: 落地med=' + b.LM + ' 绝对=' + b.AB + ' 起跳主=' + b.LO1 + ' 确认=' + b.LO2 + ' confirm=' + b.CF);
  console.log('  命中(±1帧) ' + b.ev.hit + '/' + b.ev.total + '  平均离地 ' + (b.ev.loSum / b.ev.total).toFixed(2) + '  落地 ' + (b.ev.laSum / b.ev.total).toFixed(2));
  for (const r of b.ev.rows) console.log('    ' + r.name + '  GT ' + r.gt.lo + '/' + r.gt.la + '  vs  ' + r.r.lo + '/' + r.r.la + '  (Δ' + (r.dlo >= 0 ? '+' : '') + r.dlo + '/' + (r.dla >= 0 ? '+' : '') + r.dla + ')');
}
main();
