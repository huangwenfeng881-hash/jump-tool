// _debug-lo.cjs — 复算 detectJump 第②步：medianFilter(comH) + 找 m0/mVal + liftoff 循环，打印每帧
const fs = require('fs');
const path = require('path');
const outDir = path.join('D:\\jump app', '_fixtures');
const f = fs.readdirSync(outDir).find(x => /^pose_/.test(x) && fs.statSync(path.join(outDir, x)).isFile());
const j = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
const data = j.data && j.data.poseData ? j.data.poseData : (j.poseData || []);
const fps = (j.data && j.data.fps) || j.fps || 30;
const n = data.length;
const rawH = data.map(d => (!d.lost && d.comH != null) ? d.comH : null);
function medF(arr) {
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const win = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (arr[k] != null) win.push(arr[k]);
    if (win.length) { win.sort((a, b) => a - b); s[i] = win[Math.floor(win.length / 2)]; } else s[i] = null;
  }
  return s;
}
const sH = medF(rawH);
console.log('fps=' + fps.toFixed(3) + ' n=' + n);
// 真实弹跳段 s0=70 landing=74 (0-based)
const landing = 74;
const LO1 = 0.95, LO2 = 0.3;
const tLo = data[landing].t - 1.2, tHi = data[landing].t - 0.05;
let m0 = -1, mVal = Infinity;
for (let p = 0; p < n; p++) { if (data[p].t < tLo) continue; if (data[p].t > tHi) break; if (sH[p] != null && sH[p] < mVal) { mVal = sH[p]; m0 = p; } }
console.log('landing=' + landing + ' t=' + data[landing].t.toFixed(3) + ' tLo=' + tLo.toFixed(3) + ' tHi=' + tHi.toFixed(3) + ' m0=' + m0 + ' mVal=' + mVal);
console.log('--- sH 40~56 ---');
for (let q = 40; q <= 56; q++) {
  const v = sH[q];
  const inWin = data[q].t >= tLo && data[q].t <= tHi;
  const trig = v != null && (v > mVal + LO1);
  const conf = (q + 1 < n) && sH[q + 1] != null && sH[q + 1] >= mVal + LO2;
  console.log('q=' + q + ' t=' + data[q].t.toFixed(3) + (inWin ? ' [win]' : '      ') + ' sH=' + (v == null ? 'null' : v.toFixed(3)) + ' raw=' + (rawH[q] == null ? 'null' : rawH[q].toFixed(2)) + (trig ? '  >thr' : '') + (conf ? '  conf' : ''));
}
