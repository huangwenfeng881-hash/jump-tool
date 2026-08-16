// _compare-results.cjs — 可重复性验证：对比多份 _cdp-driver 结果 JSON 的确定性载荷
// 用法: node _compare-results.cjs a.json b.json [c.json ...]
// 确定性载荷 = { fps, dur, frames, aborted, lost, jumps, steps, takeoff, best, data }
// （剔除 diag/elapsedMs 等运行时机相关字段）；逐字节比较 JSON.stringify 结果。
const fs = require('fs');

const files = process.argv.slice(2);
if (files.length < 2) { console.error('用法: node _compare-results.cjs a.json b.json [...]'); process.exit(2); }

function payload(r) {
  const p = {
    fps: r.fps, dur: r.dur, frames: r.frames, aborted: r.aborted,
    lost: r.lost, jumps: r.jumps, steps: r.steps, takeoff: r.takeoff,
    best: r.best, data: r.data
  };
  return JSON.stringify(p);
}

const loaded = files.map(f => {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { file: f, raw: r, payload: payload(r), len: Buffer.byteLength(payload(r)) };
});

const first = loaded[0];
console.log('== 对比 ===========================================');
console.log('文件数: ' + loaded.length);
console.log('载荷大小: ' + (first.len / 1024).toFixed(1) + ' KB/份 (' + first.file + ')');
const allSame = loaded.every(x => x.payload === first.payload);
if (allSame) {
  console.log('结果: ✅ 逐字节一致（' + files.join(' vs ') + '）');
} else {
  console.log('结果: ❌ 不一致，差异如下：');
  loaded.forEach(x => {
    const same = x.payload === first.payload;
    console.log('  ' + x.file + (same ? ' 一致' : ' 不一致'));
    if (!same) {
      const a = JSON.parse(first.payload), b = JSON.parse(x.payload);
      const diff = [];
      for (const k of Object.keys(a)) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          if (k === 'data') {
            const n = Math.min(a.data.length, b.data.length);
            let firstDiff = -1, diffs = 0;
            for (let i = 0; i < n; i++) {
              if (JSON.stringify(a.data[i]) !== JSON.stringify(b.data[i])) { if (firstDiff < 0) firstDiff = i; diffs++; }
            }
            diff.push('data: 长度 ' + a.data.length + ' vs ' + b.data.length + '，逐帧差异 ' + diffs + ' 处，首处下标 ' + firstDiff);
          } else {
            diff.push(k + ': ' + JSON.stringify(a[k]) + ' vs ' + JSON.stringify(b[k]));
          }
        }
      }
      diff.forEach(d => console.log('    - ' + d));
    }
  });
}
process.exit(allSame ? 0 : 1);
