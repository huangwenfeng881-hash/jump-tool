// _gen-synth-fixtures.cjs — 用 Node vm 加载 js/pose.js，对 4 个合成场景跑 computeJumpMetrics，
// 生成 Kotlin 移植回归夹具（_fixtures/synth_*.json，含 poseData + 网页版期望 metrics）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = 'D:\\jump app';
const outDir = path.join(root, '_fixtures');
fs.mkdirSync(outDir, { recursive: true });

// ---- 与 _synthetic-test.html 一致的合成数据生成器 ----
function entry(t, o) {
  return {
    t: t,
    kneeL: o.kneeL, kneeR: o.kneeR, hipL: o.hipL, hipR: o.hipR,
    comH: o.comH, comX: 0.5,
    feetY: o.feetY, leftFeetY: o.leftFeetY, rightFeetY: o.rightFeetY,
    hipX: 0.5, hipY: 1 - o.comH / 100, ankleX: 0.5, ankleY: o.feetY,
    shX: 0.5, shY: 1 - (o.comH + 15) / 100, wrX: 0.5, wrY: 1 - (o.comH + 25) / 100,
    lost: false
  };
}
function lerp(a, b, k) { return a + (b - a) * k; }

function genDouble() {
  const data = [];
  const fps = 30, N = 91;
  const TAKE = {
    44: [0.762, 32.6, 127, 158], 45: [0.766, 31.8, 145, 144], 46: [0.773, 31.2, 165, 143],
    47: [0.780, 30.7, 170, 148], 48: [0.786, 30.3, 169, 143], 49: [0.792, 30.2, 170, 138],
    50: [0.796, 30.1, 175, 130], 51: [0.801, 31.6, 179, 132], 52: [0.803, 33.4, 179, 136],
    53: [0.803, 34.4, 179, 137], 54: [0.797, 36.8, 178, 139], 55: [0.779, 38.6, 176, 139],
    56: [0.775, 39.5, 178, 138]
  };
  const DESC = {
    72: [0.644, 48.7], 73: [0.656, 47.9], 74: [0.658, 47.6], 75: [0.666, 46.4],
    76: [0.679, 45.3], 77: [0.685, 44.8], 78: [0.697, 43.1], 79: [0.707, 41.6],
    80: [0.715, 40.7], 81: [0.716, 39.8]
  };
  for (let i = 0; i < N; i++) {
    const t = i / fps;
    let feetY, comH, kl, kr, lf, rf;
    if (TAKE[i]) { feetY = TAKE[i][0]; comH = TAKE[i][1]; kl = TAKE[i][2]; kr = TAKE[i][3]; lf = rf = feetY; }
    else if (DESC[i]) { feetY = DESC[i][0]; comH = DESC[i][1]; kl = 177; kr = 176; lf = rf = feetY; }
    else if (i <= 15) { feetY = 0.865; comH = 24.5; kl = 168; kr = 172; lf = rf = 0.865; }
    else if (i <= 36) { const run = (i - 16) / 20; feetY = 0.80 + 0.02 * Math.sin(run * Math.PI * 4); comH = lerp(28, 33, run); kl = 160; kr = 160; lf = rf = feetY; }
    else if (i <= 43) { const dip = (i - 37) / 6; kl = lerp(113, 89, dip); kr = lerp(140, 162, dip); feetY = lerp(0.80, 0.755, Math.min(1, dip * 1.1)); comH = lerp(35.5, 33.3, dip); lf = rf = feetY; }
    else if (i <= 62) { const up = (i - 57) / 5; feetY = lerp(0.711, 0.667, up); comH = lerp(41.4, 47.7, up); kl = 178; kr = 150; lf = rf = feetY; }
    else if (i <= 71) { const apex = (i - 63) / 8; feetY = lerp(0.621, 0.634, apex); comH = lerp(48.5, 49.3, apex) + 0.9 * Math.sin(apex * Math.PI); kl = 175; kr = 170; lf = rf = feetY; }
    else { const sq = (i - 82) / 8; feetY = lerp(0.72, 0.742, sq); comH = lerp(39.4, 32.2, sq); kl = lerp(120, 60, sq); kr = lerp(140, 120, sq); lf = rf = feetY; }
    data.push(entry(t, { feetY: feetY, comH: Math.round(comH * 10) / 10, kneeL: Math.round(kl), kneeR: Math.round(kr), leftFeetY: Math.round(lf * 1000) / 1000, rightFeetY: Math.round(rf * 1000) / 1000 }));
  }
  return data;
}

function genSingle() {
  const data = genDouble();
  for (let i = 0; i < data.length; i++) {
    if (i >= 47 && i <= 51) {
      data[i].leftFeetY = Math.round(lerp(0.70, 0.74, (i - 47) / 4) * 1000) / 1000;
      data[i].feetY = data[i].rightFeetY;
    }
  }
  return data;
}

function genStepClose() {
  const data = [];
  const fps = 30, N = 91;
  for (let i = 0; i < N; i++) {
    const t = i / fps;
    let feetY, comH, kl, kr;
    if (i <= 15) { feetY = 0.865; comH = 24.5; kl = 168; kr = 172; }
    else if (i <= 36) { const run = (i - 16) / 20; feetY = 0.80 + 0.02 * Math.sin(run * Math.PI * 4); comH = lerp(28, 33, run); kl = 160; kr = 160; }
    else if (i <= 46) { const dip = (i - 37) / 9; kl = lerp(113, 95, dip); kr = lerp(140, 150, dip); feetY = lerp(0.80, 0.76, Math.min(1, dip * 1.2)); comH = lerp(35.5, 31.0, dip); }
    else if (i <= 49) { const hop = (i - 46) / 3; feetY = lerp(0.76, 0.72, hop); kl = 120; kr = 130; comH = lerp(31.0, 33.0, hop); }
    else if (i <= 51) { const pl = (i - 50) / 1; feetY = lerp(0.72, 0.80, pl); kl = 140; kr = 140; comH = lerp(33.0, 31.6, pl); }
    else if (i <= 56) { const lag = (i - 52) / 4; feetY = lerp(0.803, 0.775, lag); comH = lerp(33.4, 39.5, lag); kl = 178; kr = 150; }
    else if (i <= 62) { const up = (i - 57) / 5; feetY = lerp(0.71, 0.667, up); comH = lerp(41.0, 47.5, up); kl = 178; kr = 150; }
    else if (i <= 71) { const apex = (i - 63) / 8; feetY = lerp(0.621, 0.634, apex); comH = lerp(48.5, 49.3, apex) + 0.9 * Math.sin(apex * Math.PI); kl = 175; kr = 170; }
    else if (i <= 81) { const dn = 1 - Math.pow(1 - (i - 72) / 9, 2); feetY = lerp(0.644, 0.716, dn); comH = lerp(48.7, 39.8, dn); kl = 177; kr = 176; }
    else { const sq = (i - 82) / 8; feetY = lerp(0.72, 0.742, sq); comH = lerp(39.4, 32.2, sq); kl = lerp(120, 60, sq); kr = lerp(140, 120, sq); }
    data.push(entry(t, { feetY: feetY, comH: Math.round(comH * 10) / 10, kneeL: Math.round(kl), kneeR: Math.round(kr), leftFeetY: Math.round(feetY * 1000) / 1000, rightFeetY: Math.round(feetY * 1000) / 1000 }));
  }
  return data;
}

function genRun() {
  const data = [];
  const fps = 30, N = 91;
  for (let i = 0; i < N; i++) {
    const t = i / fps;
    const k = i / (N - 1);
    const feetY = 0.78 + 0.03 * Math.sin(k * Math.PI * 6);
    const comH = 31 + 0.6 * Math.sin(k * Math.PI * 6);
    data.push(entry(t, { feetY: Math.round(feetY * 1000) / 1000, comH: Math.round(comH * 10) / 10, kneeL: 160, kneeR: 160, leftFeetY: Math.round(feetY * 1000) / 1000, rightFeetY: Math.round(feetY * 1000) / 1000 }));
  }
  return data;
}

// ---- 用 vm 加载 pose.js ----
const sandbox = {
  window: {},
  document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
  navigator: { userAgent: 'node' },
  location: { href: '', search: '' },
  console: console,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise, Math: Math, JSON: JSON, Date: Date, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
  URL: URL, Blob: Blob, fetch: () => Promise.reject(new Error('no fetch'))
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const poseSrc = fs.readFileSync(path.join(root, 'js', 'pose.js'), 'utf8');
vm.runInContext(poseSrc, sandbox, { filename: 'pose.js' });
const VTPose = sandbox.window.VTPose;
if (!VTPose || typeof VTPose.computeJumpMetrics !== 'function') {
  console.error('pose.js 加载失败（VTPose 未导出）');
  process.exit(1);
}

// ---- 生成夹具 ----
const scenes = [
  { name: 'synth_double', gen: genDouble },
  { name: 'synth_single', gen: genSingle },
  { name: 'synth_stepclose', gen: genStepClose },
  { name: 'synth_run', gen: genRun }
];

for (const sc of scenes) {
  const data = sc.gen();
  const metrics = VTPose.computeJumpMetrics(data, { fps: 30 });
  const out = {
    video: sc.name,
    fps: 30,
    duration: Math.round((data.length - 1) / 30 * 1000) / 1000,
    poseData: data,
    metrics: metrics
  };
  const fp = path.join(outDir, sc.name + '.json');
  fs.writeFileSync(fp, JSON.stringify(out), 'utf8');
  const best = metrics.ok ? metrics.best : null;
  console.log('生成 ' + sc.name + '  ok=' + metrics.ok +
    (best ? '  height=' + best.jump.heightCm + 'cm liftoff=' + best.jump.liftoffTime + ' landing=' + best.jump.landingTime : ''));
}
console.log('完成：' + scenes.length + ' 个合成夹具 → ' + outDir);
