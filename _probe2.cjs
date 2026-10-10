// _probe2.cjs — 打印 poseData 的 lost 帧 + 起跳/落地窗口，定位 lost 帧对 liftoff 的影响
const fs = require('fs');
const path = require('path');
const outDir = path.join('D:\\jump app', '_fixtures');
const f = fs.readdirSync(outDir).find(x => /^pose_/.test(x) && fs.statSync(path.join(outDir, x)).isFile());
const j = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
const data = j.data && j.data.poseData ? j.data.poseData : (j.poseData || []);
const fps = (j.data && j.data.fps) || j.fps || 30;
function r(v, d) { return (v === null || v === undefined) ? d : Math.round(v * 1000) / 1000; }
function row(i) {
  const d = data[i]; if (!d) return null;
  return '#' + i + ' t=' + r(d.t,0) + ' lost=' + (d.lost?1:0) + ' feetY=' + r(d.feetY,0) + ' comH=' + r(d.comH,'') + ' L=' + r(d.leftFeetY,0) + ' R=' + r(d.rightFeetY,0) + ' kneeL=' + r(d.kneeL,'');
}
console.log('fps=' + fps.toFixed(3) + ' total=' + data.length);
console.log('--- lost frames ---');
let nl = 0;
for (let i = 0; i < data.length; i++) { if (data[i].lost) { console.log(row(i)); nl++; } }
if (!nl) console.log('（无 lost 帧）');
console.log('--- 起跳窗口 42~56 ---');
for (let i = 42; i <= 56; i++) { const s = row(i); if (s) console.log(s); }
console.log('--- 落地窗口 66~78 ---');
for (let i = 66; i <= 78; i++) { const s = row(i); if (s) console.log(s); }
