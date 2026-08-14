// 轻量 MP4 元数据解析：打印时长 / 分辨率 / 帧率（不依赖 ffmpeg）
'use strict';
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node mp4info.js <file.mp4>'); process.exit(1); }
const buf = fs.readFileSync(file);

function boxes(start, end, visit) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    else if (size === 0) { size = end - p; }
    if (size < hdr || p + size > end) break;
    visit(type, p + hdr, size - hdr);
    p += size;
  }
}

function u32(o) { return buf.readUInt32BE(o); }
function u64(o) { return Number(buf.readBigUInt64BE(o)); }

const mvhd = { timescale: 0, duration: 0 };
const tracks = [];

// 顶层盒子
let moovStart = -1, moovSize = 0;
boxes(0, buf.length, (t, s, sz) => { if (t === 'moov') { moovStart = s - 8; moovSize = sz + 8; } });

if (moovStart < 0) { console.error('no moov'); process.exit(1); }

boxes(moovStart + 8, moovStart + moovSize, (t, s, sz) => {
  if (t === 'mvhd') {
    const ver = buf[s];
    mvhd.timescale = ver === 1 ? u32(s + 20) : u32(s + 12);
    mvhd.duration = ver === 1 ? u64(s + 24) : u32(s + 16);
  } else if (t === 'trak') {
    const tr = { width: 0, height: 0, timescale: 0, duration: 0, isVideo: false, fps: 0 };
    // tkhd
    boxes(s, s + sz, (tt, ss, ssz) => {
      if (tt === 'tkhd') {
        const ver = buf[ss];
        const wOff = ver === 1 ? 88 : 76;
        tr.width = u32(ss + wOff) / 65536;
        tr.height = u32(ss + wOff + 4) / 65536;
      } else if (tt === 'mdia') {
        boxes(ss, ss + ssz, (mt, ms, msz) => {
          if (mt === 'mdhd') {
            const ver = buf[ms];
            tr.timescale = ver === 1 ? u32(ms + 20) : u32(ms + 12);
            tr.duration = ver === 1 ? u64(ms + 24) : u32(ms + 16);
          } else if (mt === 'hdlr') {
            tr.isVideo = buf.toString('ascii', ms + 8, ms + 12) === 'vide';
          } else if (mt === 'minf') {
            boxes(ms, ms + msz, (nt, ns, nsz) => {
              if (nt === 'stbl') {
                boxes(ns, ns + nsz, (st, sts, stsz) => {
                  if (st === 'stts') {
                    const n = u32(sts + 4);
                    const map = {};
                    for (let i = 0; i < n; i++) {
                      const delta = u32(sts + 8 + i * 8 + 4);
                      map[delta] = (map[delta] || 0) + u32(sts + 8 + i * 8);
                    }
                    let bestDelta = 0, bestCount = 0;
                    for (const k in map) if (map[k] > bestCount) { bestCount = map[k]; bestDelta = +k; }
                    if (bestDelta > 0) tr.fps = Math.round(tr.timescale / bestDelta * 100) / 100;
                  }
                });
              }
            });
          }
        });
      }
    });
    tracks.push(tr);
  }
});

const v = tracks.find(t => t.isVideo) || tracks[0];
console.log(JSON.stringify({
  file,
  sizeBytes: buf.length,
  durationSec: mvhd.duration && mvhd.timescale ? +(mvhd.duration / mvhd.timescale).toFixed(3) : null,
  video: v ? { width: v.width, height: v.height, fps: v.fps, durationSec: v.timescale ? +(v.duration / v.timescale).toFixed(3) : null } : null,
  tracks: tracks.map(t => ({ isVideo: t.isVideo, width: t.width, height: t.height, fps: t.fps }))
}, null, 2));
