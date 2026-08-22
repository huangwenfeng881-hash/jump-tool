// _check-stsz.cjs — 用与 ai-jump.html 完全相同的 parseMp4TotalFrames 逻辑验证 test video 的帧数解析
const fs = require('fs');
const path = require('path');

function parseMp4TotalFrames(bufIn) {
  // 兼容 Buffer（Node）与 ArrayBuffer（浏览器）
  const buf = bufIn instanceof ArrayBuffer ? bufIn : bufIn.buffer.slice(bufIn.byteOffset, bufIn.byteOffset + bufIn.byteLength);
  if (!buf || buf.byteLength < 16) return null;
  const dv = new DataView(buf);
  function be32(o) { return dv.getUint32(o); }
  function btype(o) { return String.fromCharCode(dv.getUint8(o + 4), dv.getUint8(o + 5), dv.getUint8(o + 6), dv.getUint8(o + 7)); }
  let moov = -1, moovSize = 0, off = 0;
  while (off + 8 <= buf.byteLength) {
    const size = be32(off);
    if (size < 8 || off + size > buf.byteLength) break;
    if (btype(off) === 'moov') { moov = off; moovSize = size; break; }
    off += size;
  }
  if (moov < 0) return null;
  const counts = [];
  function walk(start, end, isVideo) {
    let o = start;
    while (o + 8 <= end) {
      const size = be32(o);
      if (size < 8 || o + size > end) break;
      const t = btype(o);
      if (t === 'hdlr' && o + 20 <= end) {
        const h = String.fromCharCode(dv.getUint8(o + 16), dv.getUint8(o + 17), dv.getUint8(o + 18), dv.getUint8(o + 19));
        if (h === 'vide') isVideo = true;
      } else if (t === 'stsz' && isVideo) {
        const cnt = be32(o + 16);
        if (cnt > 0 && cnt < 10000000) counts.push(cnt);
      } else if (t === 'trak' || t === 'mdia' || t === 'minf' || t === 'stbl') {
        walk(o + 8, o + size, isVideo);
      }
      o += size;
    }
  }
  walk(moov + 8, moov + moovSize, false);
  return counts.length ? Math.max.apply(null, counts) : null;
}

const dir = 'D:\\jump app\\test video';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort();
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const n = parseMp4TotalFrames(buf);
  // 标注帧号（1-based）
  const m = f.match(/离地时刻(\d+)/);
  const la = f.match(/落地时刻(\d+)/);
  console.log(`${f}`);
  console.log(`  解析帧数=${n}  (文件 ${Math.round(buf.length / 1024)}KB)  标注: 离地帧${m ? m[1] : '?'} 落地帧${la ? la[1] : '?'}`);
}
