// _probe_mp.cjs — 打印 _mp_poses 指定视频的关键帧区间（feetY/comH/左右脚），用于诊断离地/落地边界
// 用法: node _probe_mp.cjs <视频名关键词> <起帧> <止帧>
const fs = require('fs');
const path = require('path');
const dir = path.join('D:\\jump app', '_mp_poses');
const kw = process.argv[2] || '44-53';
const a = parseInt(process.argv[3] || '70', 10), b = parseInt(process.argv[4] || '96', 10);
const f = fs.readdirSync(dir).find(x => x.includes(kw) && x.endsWith('.json'));
if (!f) { console.log('未找到含 ' + kw + ' 的视频'); process.exit(1); }
const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const data = j.poseData || [];
function r(v, d) { return (v === null || v === undefined) ? d : Math.round(v * 1000) / 1000; }
console.log('fps=' + j.fps.toFixed(2) + ' total=' + data.length + '  ' + f);
for (let i = a; i <= b; i++) {
  const d = data[i]; if (!d) continue;
  console.log('#' + i + ' t=' + r(d.t,0) + ' feetY=' + r(d.feetY,0) + ' comH=' + r(d.comH,'') + ' L=' + r(d.leftFeetY,0) + ' R=' + r(d.rightFeetY,0) + ' kneeL=' + r(d.kneeL,''));
}
