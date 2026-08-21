// _analyze-fx.cjs — 分析 _dump-poses.html 生成的诊断结果（fx_*.json）：检测帧号 vs 标注帧号
const fs = require('fs');
const path = require('path');

const dir = 'D:\\jump app\\_frames';
const files = fs.readdirSync(dir).filter(f => f.startsWith('fx_') && f.endsWith('.json')).sort();

if (!files.length) { console.log('无 fx_*.json（诊断尚未完成）'); process.exit(0); }

let liftoffOk = 0, landingOk = 0, total = 0;
for (const f of files) {
  const root = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const name = root.video || f;
  const fps = root.fps || 0;
  const m = name.match(/离地时刻(\d+)/);
  const la = name.match(/落地时刻(\d+)/);
  const gtLo = m ? parseInt(m[1], 10) : null;
  const gtLa = la ? parseInt(la[1], 10) : null;
  const best = root.metrics && root.metrics.ok ? root.metrics.best : null;
  total++;
  if (!best) {
    console.log(`\n[${name}]`);
    console.log('  未识别到弹跳  debug=' + JSON.stringify(root.metrics && root.metrics.debug));
    continue;
  }
  const loFrame = Math.round(best.jump.liftoffTime * fps);
  const laFrame = Math.round(best.jump.landingTime * fps);
  const loDiff = gtLo != null ? loFrame - gtLo : null;
  const laDiff = gtLa != null ? laFrame - gtLa : null;
  if (loDiff != null && Math.abs(loDiff) <= 1) liftoffOk++;
  if (laDiff != null && Math.abs(laDiff) <= 1) landingOk++;
  console.log(`\n[${name}]`);
  console.log(`  fps=${fps}  检测: 离地帧 ${loFrame} (${best.jump.liftoffTime}s)  落地帧 ${laFrame} (${best.jump.landingTime}s)  高度 ${best.jump.heightCm}cm`);
  console.log(`  标注: 离地帧 ${gtLo}  落地帧 ${gtLa}`);
  console.log(`  误差: 离地 ${loDiff != null ? (loDiff >= 0 ? '+' : '') + loDiff : '?'} 帧  落地 ${laDiff != null ? (laDiff >= 0 ? '+' : '') + laDiff : '?'} 帧`);
}
console.log(`\n===== 汇总: ${total} 个视频 | 离地±1帧内 ${liftoffOk}/${total} | 落地±1帧内 ${landingOk}/${total} =====`);
