// _eval-pose.cjs — 用 Node vm 加载 js/pose.js，对 _fixtures/pose_*.json 的 poseData 跑 computeJumpMetrics，
// 输出检测的离地/落地帧号（1-based）、高度、起跳方式，用于跟文件名标注真值对比。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = 'D:\\jump app';
const outDir = path.join(root, '_fixtures');

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
if (!VTPose || typeof VTPose.computeJumpMetrics !== 'function') { console.error('pose.js 加载失败'); process.exit(1); }

const files = fs.readdirSync(outDir).filter(f => /^pose_/.test(f) && fs.statSync(path.join(outDir, f)).isFile());
if (!files.length) { console.error('没有找到 pose_*.json（请先在 ai-jump.html 分析一次）'); process.exit(1); }

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
  const fps = (j.data && j.data.fps) || j.fps || 30;
  // 用单调索引时间（i/fps）替代 mediaTime（有重复导致帧号/检测错乱）
  const data = (j.data && j.data.poseData ? j.data.poseData : (j.poseData || [])).map((x, i) => ({ ...x, t: i / fps }));
  if (!data.length) { console.log(f + '\n  （无 poseData，跳过）'); continue; }
  let m;
  try { m = VTPose.computeJumpMetrics(data, { fps: fps }); }
  catch (e) { console.log(f + '\n  computeJumpMetrics 异常: ' + e.message); continue; }
  if (!m.ok) { console.log(f + '\n  ok=false  ' + (m.msg || '')); continue; }
  const b = m.best;
  const jr = b.jump;
  const lo = Math.round(jr.liftoffTime * fps) + 1;
  const la = Math.round(jr.landingTime * fps) + 1;
  const tk = (b.takeoff && b.takeoff.type) || 'unknown';
  const fpsStr = (fps || 0).toFixed(1);
  console.log(f);
  console.log('  BEST: 离地帧 ' + lo + ' / 落地帧 ' + la + '  腾空 ' + Math.round(jr.flightTime * 1000) + 'ms  高度 ' + jr.heightCm.toFixed(1) + 'cm  起跳 ' + tk + '  fps ' + fpsStr + '  (jumpCount ' + m.jumps.length + ')');
  console.log('  候选明细:');
  for (const jj of (m.jumps || [])) {
    console.log('    lo=' + Math.round(jj.liftoffTime * fps) + '(帧' + (Math.round(jj.liftoffTime * fps) + 1) + ') la=' + Math.round(jj.landingTime * fps) + '(帧' + (Math.round(jj.landingTime * fps) + 1) + ') ft=' + Math.round(jj.flightTime * 1000) + 'ms h=' + jj.heightCm.toFixed(1) + 'cm src=' + jj.source + (jj.contactTime != null ? ' contact=' + jj.contactTime : ''));
  }
  if (m.debug) console.log('  debug: ' + JSON.stringify(m.debug));
  // 直接调 detectJump 拿 rejected 细分（正确签名 detectJump(data, opts)）
  try {
    const dbg = {};
    const jumps2 = VTPose.detectJump(data, { fps: fps, debugOut: dbg });
    console.log('  detectJump: 返回 ' + jumps2.length + ' jumps, flightSegs=' + dbg.flightSegs + ' rejected=' + dbg.rejected + ' hipFallback=' + dbg.hipFallback + ' hipArch=' + dbg.hipArch);
    for (const jj of jumps2) console.log('    raw lo=' + (Math.round(jj.liftoffTime * fps) + 1) + ' 帧 la=' + (Math.round(jj.landingTime * fps) + 1) + ' 帧 src=' + jj.source + ' h=' + jj.heightCm.toFixed(1) + 'cm');
    for (const dc of (dbg.descs || [])) console.log('    rejected[' + dc.rejected + '] s0=' + dc.s0 + ' landing=' + dc.landing + ' m0=' + dc.m0 + ' mVal=' + dc.mVal + ' lo=' + dc.lo + ' fDrop=' + dc.fDrop + ' med=' + dc.med + ' triggerDv=' + dc.triggerDv);
  } catch (e) { console.log('  detectJump 异常: ' + e.message); }
}
