// _probe-pose.cjs — 打印 poseData 里离地/落地附近帧的脚/髋/膝数据，帮定位单脚起跳与落地检测偏差
const fs = require('fs');
const path = require('path');
const outDir = path.join('D:\\jump app', '_fixtures');
const f = fs.readdirSync(outDir).find(x => /^pose_/.test(x) && fs.statSync(path.join(outDir, x)).isFile());
if (!f) { console.error('no pose file'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
const data = j.data && j.data.poseData ? j.data.poseData : (j.poseData || []);
const fps = (j.data && j.data.fps) || j.fps || 30;
function r(v, d) { return (v === null || v === undefined) ? d : Math.round(v * 1000) / 1000; }
function row(i) {
  const d = data[i];
  if (!d) return null;
  return '#' + i + ' t=' + r(d.t, 0) + ' feetY=' + r(d.feetY, 0) + ' L=' + r(d.leftFeetY, 0) + ' R=' + r(d.rightFeetY, 0) + ' comH=' + r(d.comH, '') + ' kneeL=' + r(d.kneeL, '') + ' kneeR=' + r(d.kneeR, '') + ' hipY=' + r(d.hipY, '') + ' lost=' + (d.lost ? 1 : 0);
}
console.log('fps=' + fps + ' total=' + data.length + ' 文件名=' + f);
console.log('--- 起跳窗口 42~60 ---');
for (let i = 42; i <= 60; i++) { const s = row(i); if (s) console.log(s); }
console.log('--- 落地窗口 68~80 ---');
for (let i = 68; i <= 80; i++) { const s = row(i); if (s) console.log(s); }
