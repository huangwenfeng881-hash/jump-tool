/**
 * Vertrise 跃升 · 弹跳知识科普（公开视频库）
 * 两种来源：
 *   1) storage  上传到 Supabase Storage（自动压 720p），适合短视频
 *   2) bilibili 只存 B 站链接（BV 号），播放用官方 iframe 播放器，不吃存储额度
 * 浏览：任何人；发布/编辑/删除：白名单创作者本人。
 */
window.JTKnowledge = (function () {
  'use strict';
  var CFG = window.JTConfig || {};
  var BASE = (CFG.PROXY_URL || CFG.SUPABASE_URL || '').replace(/\/+$/, '');      // REST：走代理
  var STORE = (CFG.SUPABASE_URL || BASE).replace(/\/+$/, '');                      // Storage：直连
  var KEY = CFG.SUPABASE_ANON_KEY || '';
  var CACHE_KEY = 'vt_kv_cache_v1';
  var COMPRESS_OVER = 18 * 1024 * 1024;
  var TARGET_H = 720, BITRATE = 2200000;

  function api(p) { return BASE + p; }
  function authHeaders(token, json) {
    var h = { apikey: KEY };
    if (json) h['Content-Type'] = 'application/json';
    h.Authorization = 'Bearer ' + (token || KEY);
    return h;
  }
  function session() {
    return (window.JTAuth && window.JTAuth.getSession)
      ? window.JTAuth.getSession().catch(function () { return null; })
      : Promise.resolve(null);
  }
  function publicUrl(p) {
    if (!p) return '';
    return STORE + '/storage/v1/object/public/knowledge/' + p.split('/').map(encodeURIComponent).join('/');
  }

  // ---------- B 站链接解析 ----------
  /** 支持 BV1xx411c7mD / av12345 / 完整链接 / b23.tv 短链（短链需展开） */
  function parseBili(input) {
    var s = String(input || '').trim();
    var m = s.match(/BV[0-9A-Za-z]{10}/);
    if (m) return { type: 'bvid', id: m[0], url: 'https://www.bilibili.com/video/' + m[0] };
    m = s.match(/av(\d+)/i);
    if (m) return { type: 'aid', id: m[1], url: 'https://www.bilibili.com/video/av' + m[1] };
    if (/^b23\.tv|^https?:\/\/b23\.tv/.test(s)) return { type: 'short', id: s, url: s.indexOf('http') === 0 ? s : 'https://' + s };
    return null;
  }
  function playerUrl(rec, page) {
    var p = '1';
    if (rec && rec.ext_id) p = String(rec.ext_id);
    return 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(rec.ext_url || '') +
      '&page=' + (page || p) + '&high_quality=1&danmaku=0&autoplay=0';
  }
  /** 用 BV/av 号拼 iframe 播放器 */
  function biliEmbed(bvid, page) {
    return 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(bvid) +
      '&page=' + (page || 1) + '&high_quality=1&danmaku=0&autoplay=0';
  }

  function permError(status, body) {
    var t = String(body || '').toLowerCase();
    var denied = (status === 401 || status === 403 ||
      (status === 400 && /row-level|policy|unauthorized|permission|forbidden/.test(t)));
    if (denied) {
      var e = new Error('当前账号没有发布权限（仅开放给创作者，请联系站长开通）');
      e.needPermission = true;
      return e;
    }
    return new Error('上传失败 HTTP ' + status + (t ? '（' + String(body).slice(0, 80) + '）' : ''));
  }

  function list() {
    var url = api('/rest/v1/knowledge_videos?select=id,user_id,creator_name,title,note,platform,ext_url,ext_id,cover_url,video_path,cover_path,created_at,size_bytes&published=eq.true&order=created_at.desc&limit=200');
    return fetch(url, { headers: authHeaders(null, true) }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (rows) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) {}
      return rows;
    }).catch(function (err) {
      var cached = [];
      try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch (e) {}
      if (cached.length) return cached;
      throw err;
    });
  }

  /** 封面：storage 用公共桶；B 站用 cover_url 或官方图床；都没有返回空 */
  function coverUrl(rec) {
    if (!rec) return '';
    if (rec.cover_path) return publicUrl(rec.cover_path);
    if (rec.cover_url) return rec.cover_url;
    if (rec.platform === 'bilibili' && rec.ext_id) {
      return 'https://i0.hdslb.com/bfs/archive/' + rec.ext_id + '.jpg'; // 可能 404，img onerror 兜底
    }
    return '';
  }

  // ---------- 上传（Storage） ----------
  function compressVideo(file, onStage) {
    return new Promise(function (resolve) {
      if (file.size <= COMPRESS_OVER) return resolve(file);
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return resolve(file);
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.playsInline = true; v.muted = false; v.preload = 'auto'; v.src = url;
      var finished = false;
      function done(out) {
        if (finished) return; finished = true;
        try { URL.revokeObjectURL(url); } catch (e) {}
        resolve(out || file);
      }
      var guard = setTimeout(function () { done(file); }, 240000);
      v.addEventListener('error', function () { clearTimeout(guard); done(file); });
      v.addEventListener('loadedmetadata', function () {
        try {
          var scale = Math.min(1, TARGET_H / Math.max(1, v.videoHeight));
          var w = Math.max(2, Math.round(v.videoWidth * scale / 2) * 2);
          var h = Math.max(2, Math.round(v.videoHeight * scale / 2) * 2);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          var stream = canvas.captureStream(0);
          var vtrack = stream.getVideoTracks()[0];
          try {
            var vs = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
            if (vs && vs.getAudioTracks) vs.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
          } catch (e) {}
          var mime = (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))
            ? 'video/webm;codecs=vp8' : 'video/webm';
          var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE, audioBitsPerSecond: 96000 });
          var chunks = [];
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.onstop = function () {
            clearTimeout(guard);
            if (drawTick) clearInterval(drawTick);
            var blob = new Blob(chunks, { type: 'video/webm' });
            if (onStage) onStage({ stage: 'compress', p: 1 });
            done(blob.size > 1024 ? blob : file);
          };
          var drawTick = null;
          var draw = function () {
            if (finished) return;
            try { ctx.drawImage(v, 0, 0, w, h); } catch (e) {}
            try { if (vtrack && vtrack.requestFrame) vtrack.requestFrame(); } catch (e) {}
            if (v.ended) { if (drawTick) clearInterval(drawTick); return; }
          };
          drawTick = setInterval(draw, 33);
          draw();
          v.addEventListener('timeupdate', function () {
            if (onStage && v.duration) onStage({ stage: 'compress', p: Math.min(1, v.currentTime / v.duration) });
          });
          v.addEventListener('ended', function () { try { rec.stop(); } catch (e) {} });
          rec.start(1000);
          v.play().then(draw).catch(function () { try { rec.stop(); } catch (e) {} });
        } catch (e) { clearTimeout(guard); done(file); }
      });
    });
  }

  function makeCover(file) {
    return new Promise(function (resolve) {
      try {
        var url = URL.createObjectURL(file);
        var v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        var done = false;
        function finish(blob) {
          if (done) return; done = true;
          try { URL.revokeObjectURL(url); } catch (e) {}
          resolve(blob || null);
        }
        var timer = setTimeout(function () { finish(null); }, 9000);
        v.addEventListener('loadeddata', function () {
          try { v.currentTime = Math.min(0.2, (v.duration || 1) / 3); } catch (e) {}
        });
        v.addEventListener('seeked', function () {
          try {
            var w = 480, h = Math.round(v.videoHeight * 480 / Math.max(1, v.videoWidth));
            var c = document.createElement('canvas');
            c.width = w; c.height = Math.max(1, h);
            c.getContext('2d').drawImage(v, 0, 0, w, h);
            c.toBlob(function (b) { clearTimeout(timer); finish(b); }, 'image/jpeg', 0.72);
          } catch (e) { clearTimeout(timer); finish(null); }
        });
        v.addEventListener('error', function () { clearTimeout(timer); finish(null); });
      } catch (e) { resolve(null); }
    });
  }

  function uploadBlob(path, blob, contentType, token, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', STORE + '/storage/v1/object/knowledge/' + path);
      xhr.setRequestHeader('apikey', KEY);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
      if (onProgress) xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(path);
        else reject(permError(xhr.status, xhr.responseText));
      };
      xhr.onerror = function () { reject(new Error('网络错误，上传失败')); };
      xhr.send(blob);
    });
  }

  function insertRow(token, row) {
    return fetch(api('/rest/v1/knowledge_videos'), {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(row)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        var err = permError(r.status, t);
        err.message = err.message + (t ? '（' + t.slice(0, 80) + '）' : '');
        throw err;
      });
      return row;
    });
  }

  function upload(file, meta, onStage) {
    return session().then(function (s) {
      if (!s || !s.user) {
        var e = new Error('需要先登录才能上传公开视频');
        e.needLogin = true;
        throw e;
      }
      return compressVideo(file, onStage).then(function (out) {
        var isWebm = (out.type || '').indexOf('webm') >= 0;
        var ext = isWebm ? '.webm' : (String(file.name || '').match(/\.[a-zA-Z0-9]+$/) || ['.mp4'])[0].toLowerCase();
        var contentType = isWebm ? 'video/webm' : (file.type || 'video/mp4');
        var uid = s.user.id, token = s.access_token, ts = Date.now();
        var videoPath = uid + '/v' + ts + ext;
        return makeCover(out).then(function (coverBlob) {
          return uploadBlob(videoPath, out, contentType, token, function (p) {
            if (onStage) onStage({ stage: 'upload', p: p });
          }).then(function () {
            var coverPath = null, chain = Promise.resolve();
            if (coverBlob) {
              coverPath = uid + '/c' + ts + '.jpg';
              chain = uploadBlob(coverPath, coverBlob, 'image/jpeg', token).catch(function () { coverPath = null; });
            }
            return chain.then(function () {
              return insertRow(token, {
                user_id: uid,
                creator_name: (meta.creator || (s.user.email || '').split('@')[0] || '创作者'),
                title: meta.title || '未命名',
                note: meta.note || '',
                platform: 'storage',
                video_path: videoPath,
                cover_path: coverPath,
                size_bytes: out.size || null,
                published: true
              });
            });
          });
        });
      });
    });
  }

  /** 添加 B 站外链视频：不吃存储额度，播放走官方播放器 */
  function addBilibili(input, meta) {
    return session().then(function (s) {
      if (!s || !s.user) {
        var e = new Error('需要先登录才能发布视频');
        e.needLogin = true;
        throw e;
      }
      var parsed = parseBili(input);
      if (!parsed) throw new Error('没认出 BV 号，请粘贴完整视频链接');
      if (parsed.type === 'short') throw new Error('b23.tv 短链请在浏览器打开后，复制跳转后的完整链接（含 BV 号）');
      return insertRow(s.access_token, {
        user_id: s.user.id,
        creator_name: (meta.creator || (s.user.email || '').split('@')[0] || '创作者'),
        title: meta.title || '未命名',
        note: meta.note || '',
        platform: 'bilibili',
        ext_url: parsed.id,
        ext_id: parsed.id,
        cover_url: meta.cover || null,
        published: true
      });
    });
  }

  function update(id, patch) {
    return session().then(function (s) {
      if (!s) throw new Error('需要登录');
      return fetch(api('/rest/v1/knowledge_videos?id=eq.' + encodeURIComponent(id)), {
        method: 'PATCH',
        headers: authHeaders(s.access_token, true),
        body: JSON.stringify(patch)
      }).then(function (r) { if (!r.ok) throw new Error('保存失败 HTTP ' + r.status); return true; });
    });
  }

  function remove(row) {
    return session().then(function (s) {
      if (!s) throw new Error('需要登录');
      var del = function (path) {
        if (!path) return Promise.resolve();
        return fetch(STORE + '/storage/v1/object/knowledge/' + path, {
          method: 'DELETE', headers: authHeaders(s.access_token)
        }).catch(function () {});
      };
      return del(row.video_path).then(function () { return del(row.cover_path); }).then(function () {
        return fetch(api('/rest/v1/knowledge_videos?id=eq.' + encodeURIComponent(row.id)), {
          method: 'DELETE', headers: authHeaders(s.access_token)
        });
      }).then(function (r) { if (!r.ok) throw new Error('删除失败 HTTP ' + r.status); return true; });
    });
  }

  return {
    configured: !!(BASE && KEY),
    list: list, upload: upload, addBilibili: addBilibili, update: update, remove: remove,
    publicUrl: publicUrl, coverUrl: coverUrl, session: session,
    makeCover: makeCover, compressVideo: compressVideo,
    parseBili: parseBili, biliEmbed: biliEmbed
  };
})();
