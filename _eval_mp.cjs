// _eval_mp.cjs — 读 _mp_poses/*.json（Python MediaPipe 产物），用当前 js/pose.js 算法跑，输出检测帧号/高度/起跳方式
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = 'D:\\jump app';
const posesDir = path.join(root, '_mp_poses');

const sandbox = {
  window: {}, document: { createElement: () => ({}), getElementById: () => null, querySelector: () => null },
  navigator: { userAgent: 'node' }, location: { href: '', search: '' }, console: console,
  setTimeout, clearTimeout, Promise, Math, JSON, Date, isFinite, parseInt, parseFloat, URL, Blob, fetch: () => Promise.reject(new Error('no fetch'))
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'pose.js'), 'utf8'), sandbox, { filename: 'pose.js' });
const VTPose = sandbox.window.VTPose;

const files = fs.readdirSync(posesDir).filter(f => f.endsWith('.json') && (!process.argv[2] || f.includes(process.argv[2])));
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(posesDir, f), 'utf8'));
  const data = j.poseData || [];
  const fps = j.fps || 30;
  if (!data.length) { console.log(f + '  （空）'); continue; }
  let m;
  try { m = VTPose.computeJumpMetrics(data, { fps }); }
  catch (e) { console.log(f + '  ERR ' + e.message); continue; }
  if (!m.ok) { console.log(f.replace(/\.json$/, '') + '  ok=false ' + (m.msg || '')); continue; }
  const b = m.best;
  const lo = Math.round(b.jump.liftoffTime * fps) + 1;
  const la = Math.round(b.jump.landingTime * fps) + 1;
  console.log(f.replace(/\.json$/, '') + '  ->  离地 ' + lo + ' / 落地 ' + la + '  腾空 ' + Math.round(b.jump.flightTime * 1000) + 'ms  高度 ' + b.jump.heightCm.toFixed(1) + 'cm  起跳 ' + ((b.takeoff && b.takeoff.type) || '?') + '  ' + b.jump.source + '  (' + m.jumps.length + '跳)');
  for (const jj of (m.jumps || [])) console.log('     cand lo=' + Math.round(jj.liftoffTime * fps) + '(帧' + (Math.round(jj.liftoffTime * fps) + 1) + ') la=' + Math.round(jj.landingTime * fps) + '(帧' + (Math.round(jj.landingTime * fps) + 1) + ') ft=' + Math.round(jj.flightTime * 1000) + 'ms h=' + jj.heightCm.toFixed(1) + ' src=' + jj.source + (jj.contactTime != null ? ' contact=' + jj.contactTime : ''));
  try {
    const dbg = {};
    const j2 = VTPose.detectJump(data, { fps, debugOut: dbg });
    console.log('     detectJump: ' + j2.length + ' jumps, flightSegs=' + dbg.flightSegs + ' rejected=' + dbg.rejected + ' hipFallback=' + dbg.hipFallback + ' hipArch=' + dbg.hipArch);
    for (const dc of (dbg.descs || [])) console.log('       seg s0=' + dc.s0 + ' landing=' + dc.landing + ' m0=' + dc.m0 + ' mVal=' + dc.mVal + ' lo=' + dc.lo + ' fDrop=' + dc.fDrop + ' rejected=' + dc.rejected + ' med=' + dc.med);
  } catch (e) {}
}
