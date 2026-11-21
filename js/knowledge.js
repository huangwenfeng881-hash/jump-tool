/**
 * Vertrise 跃升 · 弹跳知识科普（公开视频库）
 * 视频存在 Supabase Storage 公共桶 knowledge，元信息在 knowledge_videos 表。
 * 浏览：任何人；上传/编辑/删除：需要登录（仅本人可改）。
 */
window.JTKnowledge = (function () {
  'use strict';
  var CFG = window.JTConfig || {};
  var BASE = (CFG.PROXY_URL || CFG.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = CFG.SUPABASE_ANON_KEY || '';
  var CACHE_KEY = 'vt_kv_cache_v1';

  function api(path) { return BASE + path; }
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
    return api('/storage/v1/object/public/knowledge/' + p.split('/').map(encodeURIComponent).join('/'));
  }

  function list() {
    var url = api('/rest/v1/knowledge_videos?select=id,user_id,creator_name,title,note,video_path,cover_path,created_at,size_bytes&published=eq.true&order=created_at.desc&limit=200');
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
      xhr.open('POST', api('/storage/v1/object/knowledge/' + path));
      xhr.setRequestHeader('apikey', KEY);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
      if (onProgress) xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(path);
        else reject(new Error('上传失败 HTTP ' + xhr.status + ' ' + (xhr.responseText || '').slice(0, 120)));
      };
      xhr.onerror = function () { reject(new Error('网络错误，上传失败')); };
      xhr.send(blob);
    });
  }

  function upload(file, meta, onProgress) {
    return session().then(function (s) {
      if (!s || !s.user) {
        var e = new Error('需要先登录才能上传公开视频');
        e.needLogin = true;
        throw e;
      }
      var uid = s.user.id;
      var token = s.access_token;
      var ts = Date.now();
      var ext = (String(file.name || '').match(/\.[a-zA-Z0-9]+$/) || ['.mp4'])[0].toLowerCase();
      var videoPath = uid + '/v' + ts + ext;
      return makeCover(file).then(function (coverBlob) {
        return uploadBlob(videoPath, file, file.type || 'video/mp4', token, onProgress).then(function () {
          var coverPath = null;
          var p = Promise.resolve();
          if (coverBlob) {
            coverPath = uid + '/c' + ts + '.jpg';
            p = uploadBlob(coverPath, coverBlob, 'image/jpeg', token).catch(function () { coverPath = null; });
          }
          return p.then(function () {
            var row = {
              user_id: uid,
              creator_name: (meta.creator || (s.user.email || '').split('@')[0] || '创作者'),
              title: meta.title || '未命名',
              note: meta.note || '',
              video_path: videoPath,
              cover_path: coverPath,
              size_bytes: file.size || null,
              published: true
            };
            return fetch(api('/rest/v1/knowledge_videos'), {
              method: 'POST',
              headers: authHeaders(token, true),
              body: JSON.stringify(row)
            }).then(function (r) {
              if (!r.ok) return r.text().then(function (t) { throw new Error('保存失败 HTTP ' + r.status + ' ' + t.slice(0, 120)); });
              return row;
            });
          });
        });
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
        return fetch(api('/storage/v1/object/knowledge/' + path), {
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
    list: list, upload: upload, update: update, remove: remove,
    publicUrl: publicUrl, session: session, makeCover: makeCover
  };
})();
