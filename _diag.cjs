// _diag.cjs — 诊断管线：ffmpeg 抽帧 → @mediapipe/tasks-vision (Node/CPU) 逐帧识别
// → vm 加载 js/pose.js 计算指标 → 与文件名标注（帧号）对比。
// 用法: node _diag.cjs "test video/双脚，倒数第二步触地82-99，….mp4" [视频索引…]
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = 'D:\\jump app';
const ffmpeg = require(path.join(root, '_diag', 'node_modules', 'ffmpeg-static'));

// ---------- 1. 加载 pose.js（vm 沙箱） ----------
const sandbox = {
  window: {}, document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
  navigator: { userAgent: 'node' }, location: { href: '', search: '' },
  console, setTimeout, clearTimeout, Promise, Math, JSON, Date,
  isFinite, parseInt, parseFloat, URL, Blob, Uint8Array, ArrayBuffer, DataView,
  fetch: () => Promise.reject(new Error('no fetch'))
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'pose.js'), 'utf8'), sandbox, { filename: 'pose.js' });
const VTPose = sandbox.window.VTPose;

// ---------- 2. MediaPipe（Node CPU，输入用 ImageData 鸭子类型） ----------
// tasks-vision 的 CJS 入口在创建任务时引用 document（仅创建 canvas 占位），
// 输入走 {width,height,data} 路径时不真正使用 canvas，注入 stub 即可。
const wasmDir = path.join(root, '_diag', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: () => ({}),
    addEventListener: () => {},
    removeEventListener: () => {},
    documentElement: { style: {} },
    body: { appendChild: () => {}, removeChild: () => {} },
    head: { appendChild: () => {} }
  };
}
if (typeof global.self === 'undefined') global.self = global;
// Ph() 检查 OffscreenCanvas：注入 stub 让 bundle 走 Node 模式（canvas=undefined，跳过 script 加载）
if (typeof global.OffscreenCanvas === 'undefined') global.OffscreenCanvas = class {};
// Node 模式：$h 不会被调用，必须预先加载 wasm glue 并设置 self.ModuleFactory
const gluePath = path.join(wasmDir, 'vision_wasm_internal.js');
const glueMod = require(gluePath);
if (typeof global.ModuleFactory === 'undefined' && typeof glueMod === 'function') {
  global.ModuleFactory = glueMod;
  console.log('[diag] 预加载 ModuleFactory OK');
}
// 模拟 worker 的 importScripts（兜底：若 $h 仍被调用）
if (typeof global.importScripts === 'undefined') {
  const { fileURLToPath } = require('url');
  global.importScripts = function (url) {
    let u = url.toString();
    if (u.startsWith('file://')) u = fileURLToPath(u);
    const mod = require(u);
    if (mod && typeof mod === 'function' && typeof global.ModuleFactory === 'undefined') {
      global.ModuleFactory = mod;
    }
  };
}
const vision = require(path.join(root, '_diag', 'node_modules', '@mediapipe', 'tasks-vision'));
let poseLandmarker = null;

async function initModel() {
  const fileset = await vision.FilesetResolver.forVisionTasks(wasmDir);
  poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: path.join(root, 'mediapipe', 'tasks-vision', 'pose_landmarker_lite.task'), delegate: 'CPU' },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3
  });
}

// ---------- 2.5 PPM 解析 → ImageData 鸭子类型 ----------
function parsePpm(buf) {
  // P6 格式：header 可能含注释（# 开头行）
  let p = 0;
  const nextToken = () => {
    while (p < buf.length && (buf[p] === 0x20 || buf[p] === 0x09 || buf[p] === 0x0a || buf[p] === 0x0d)) p++;
    if (p < buf.length && buf[p] === 0x23) { while (p < buf.length && buf[p] !== 0x0a) p++; return nextToken(); }
    let s = '';
    while (p < buf.length && buf[p] !== 0x20 && buf[p] !== 0x09 && buf[p] !== 0x0a && buf[p] !== 0x0d) s += String.fromCharCode(buf[p++]);
    return s;
  };
  const magic = nextToken();
  if (magic !== 'P6') throw new Error('not P6: ' + magic);
  const w = parseInt(nextToken(), 10);
  const h = parseInt(nextToken(), 10);
  const maxVal = parseInt(nextToken(), 10);
  if (!(w > 0 && h > 0 && maxVal === 255)) throw new Error('bad PPM header');
  while (p < buf.length && (buf[p] === 0x20 || buf[p] === 0x09 || buf[p] === 0x0a || buf[p] === 0x0d)) p++;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = buf[p + i * 3];
    data[i * 4 + 1] = buf[p + i * 3 + 1];
    data[i * 4 + 2] = buf[p + i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: data };
}

// ---------- 3. 标注解析 ----------
function parseGroundTruth(name) {
  const lo = name.match(/离地时刻(\d+)/);
  const la = name.match(/落地时刻(\d+)/);
  return { liftoffFrame: lo ? parseInt(lo[1], 10) : null, landingFrame: la ? parseInt(la[1], 10) : null };
}

// ---------- 4. 单视频诊断 ----------
async function diag(videoName) {
  const videoPath = path.join(root, 'test video', videoName);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-diag-'));
  const framesDir = path.join(tmp, 'f');
  fs.mkdirSync(framesDir);
  try {
    // 抽帧：全帧率（vsync 0 保留所有帧），PPM 无压缩便于解析
    execFileSync(ffmpeg, ['-i', videoPath, '-vsync', '0', path.join(framesDir, '%05d.ppm')], { stdio: 'pipe' });
    const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.ppm')).sort();
    if (!frameFiles.length) { console.log(videoName, '-> 抽帧失败'); return; }
    const fps = frameFiles.length / (getDuration(videoPath) || 1);

    // 逐帧识别
    let inferSeq = 0;
    const data = [];
    for (let i = 0; i < frameFiles.length; i++) {
      const img = parsePpm(fs.readFileSync(path.join(framesDir, frameFiles[i])));
      let lm = null;
      try {
        const res = poseLandmarker.detectForVideo(img, ++inferSeq);
        if (res.landmarks && res.landmarks.length) lm = res.landmarks[0];
      } catch (e) { lm = null; }
      const t = Math.round(i / fps * 1000) / 1000;
      const f = lm ? VTPose.computeFrame(lm) : null;
      if (f) {
        data.push(Object.assign({ t, lost: false }, f));
      } else {
        data.push({ t, lost: true, kneeL: null, kneeR: null, hipL: null, hipR: null, comH: null, comX: null, feetY: null, leftFeetY: null, rightFeetY: null, hipX: null, hipY: null, ankleX: null, ankleY: null, shX: null, shY: null, wrX: null, wrY: null });
      }
      if (i % 50 === 0) process.stdout.write(`  ${i}/${frameFiles.length} 帧\r`);
    }
    process.stdout.write('\n');

    const metrics = VTPose.computeJumpMetrics(data, { fps });
    const gt = parseGroundTruth(videoName);
    const out = { video: videoName, frames: frameFiles.length, fps: Math.round(fps * 1000) / 1000, groundTruth: gt, metrics: metrics };
    const best = metrics.ok ? metrics.best : null;
    if (best) {
      const loFrame = Math.round(best.jump.liftoffTime * fps);
      const laFrame = Math.round(best.jump.landingTime * fps);
      const loDiff = gt.liftoffFrame != null ? loFrame - gt.liftoffFrame : null;
      const laDiff = gt.landingFrame != null ? laFrame - gt.landingFrame : null;
      console.log(`\n[${videoName}]`);
      console.log(`  检测: 离地帧 ${loFrame} (${best.jump.liftoffTime}s)  落地帧 ${laFrame} (${best.jump.landingTime}s)  高度 ${best.jump.heightCm}cm`);
      console.log(`  标注: 离地帧 ${gt.liftoffFrame}  落地帧 ${gt.landingFrame}`);
      console.log(`  误差: 离地 ${loDiff} 帧  落地 ${laDiff} 帧`);
    } else {
      console.log(`\n[${videoName}] 未识别到弹跳  debug=${JSON.stringify(metrics.debug)}`);
    }
    return out;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

function getDuration(videoPath) {
  const { execFileSync } = require('child_process');
  const out = execFileSync(ffmpeg, ['-i', videoPath], { stdio: ['ignore', 'ignore', 'pipe'] }).toString();
  const m = out.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

(async function () {
  await initModel();
  const args = process.argv.slice(2);
  const all = fs.readdirSync(path.join(root, 'test video')).filter(f => f.endsWith('.mp4')).sort();
  const targets = args.length ? args.map(a => all.find(f => f.includes(a))).filter(Boolean) : all.slice(0, 3);
  if (!targets.length) { console.log('未匹配到视频'); return; }
  for (const t of targets) { await diag(t); }
  console.log('\n完成');
})();
