/**
 * Vertrise跃升 · 弹跳知识科普
 * 本地视频库：视频 / 封面 / 标题 / 简介全部保存在浏览器 IndexedDB，不上传服务器。
 *
 * 逻辑记录结构：{ id, title, note, blob, coverDataUrl, createdAt }
 * 存储技巧：视频字节单独放在 blobs 表，编辑标题/简介时不会重写视频数据，
 *          避免同一段视频被反复写入数据库而白白占用空间。
 *
 * 依赖：无（仅 jQuery 时代的原生 API），ES5 + Promise，无构建。
 */
window.JTKnowledge = (function () {
  'use strict';

  var DB_NAME = 'vertrise-knowledge';
  var DB_VER = 1;
  var STORE_META = 'videos';   // { id, title, note, size, coverDataUrl, createdAt, updatedAt }
  var STORE_BLOB = 'blobs';    // { id, blob }
  var BIG_FILE = 200 * 1024 * 1024; // 超过 200MB 给个提示，不阻止
  var COVER_W = 480;           // 封面最大宽度（px）

  var dbPromise = null;
  var state = { items: [], keyword: '', playingUrl: '', editingId: '' };
  var el = {};

  /* ============ 基础工具 ============ */

  function $(id) { return document.getElementById(id); }

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDate(ts) {
    var d = new Date(ts || Date.now());
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n <= 0) return '';
    if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function stripExt(name) {
    var s = String(name || '').trim();
    if (!s) return '未命名视频';
    return s.replace(/\.[A-Za-z0-9]{1,5}$/, '') || '未命名视频';
  }

  function toast(msg, type) {
    var t = el.toast;
    if (!t) return;
    t.textContent = msg;
    t.className = 'jt-toast show ' + (type || '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.className = 'jt-toast'; }, 2600);
  }

  function closestUp(node, sel) {
    while (node && node !== document) {
      if (node.nodeType === 1) {
        if (node.matches && node.matches(sel)) return node;
        if (node.msMatchesSelector && node.msMatchesSelector(sel)) return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function isVideoFile(file) {
    if (!file) return false;
    var type = file.type || '';
    if (type.indexOf('video/') === 0) return true;
    // 部分 WebView / 文件管理器不给 MIME，按扩展名兜底
    return /\.(mp4|webm|mov|m4v|ogv|ogg|3gp|mkv|avi)$/i.test(file.name || '');
  }

  /* ============ IndexedDB 封装 ============ */

  function openDB() {
    if (dbPromise) return dbPromise;

    var promise = new Promise(function (resolve, reject) {
      var idb = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.msIndexedDB;
      if (!idb) { reject(new Error('当前浏览器不支持 IndexedDB')); return; }

      var req;
      try { req = idb.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }

      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_BLOB)) {
          db.createObjectStore(STORE_BLOB, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打开本地数据库失败')); };
      req.onblocked = function () { reject(new Error('本地数据库被其它标签页占用')); };
    });

    dbPromise = promise;
    // 失败后清掉缓存，下次可以重试（例如刚退出无痕模式）
    promise.then(null, function () { dbPromise = null; });
    return promise;
  }

  // 在若干对象仓库上跑一个写事务，等事务真正提交后再 resolve
  function txRun(db, stores, mode, run) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(stores, mode);
      } catch (e) { reject(e); return; }

      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('本地数据库操作失败')); };
      tx.onabort = function () { reject(tx.error || new Error('本地写入被中止（可能空间不足）')); };

      try { run(tx); } catch (e) {
        try { tx.abort(); } catch (e2) {}
        reject(e);
      }
    });
  }

  // 读出全部视频（meta 与 blob 拼成逻辑记录）
  function loadAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction([STORE_META, STORE_BLOB], 'readonly');
        } catch (e) { reject(e); return; }

        var metaReq = tx.objectStore(STORE_META).getAll();
        var blobReq = tx.objectStore(STORE_BLOB).getAll();

        tx.oncomplete = function () {
          var blobs = {};
          (blobReq.result || []).forEach(function (row) {
            if (row && row.id) blobs[row.id] = row.blob;
          });

          var items = [];
          (metaReq.result || []).forEach(function (m) {
            if (!m || !m.id || !blobs[m.id]) return; // 视频字节丢失的脏记录直接跳过
            items.push({
              id: m.id,
              title: m.title || '未命名视频',
              note: m.note || '',
              blob: blobs[m.id],
              coverDataUrl: m.coverDataUrl || '',
              size: m.size || (blobs[m.id].size || 0),
              createdAt: m.createdAt || Date.now()
            });
          });
          items.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
          resolve(items);
        };
        tx.onerror = function () { reject(tx.error || new Error('读取视频列表失败')); };
        tx.onabort = function () { reject(tx.error || new Error('读取视频列表失败')); };
      });
    });
  }

  function writeRecord(rec) {
    return openDB().then(function (db) {
      return txRun(db, [STORE_META, STORE_BLOB], 'readwrite', function (tx) {
        tx.objectStore(STORE_META).put({
          id: rec.id,
          title: rec.title,
          note: rec.note,
          size: rec.size,
          coverDataUrl: rec.coverDataUrl,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt || rec.createdAt
        });
        tx.objectStore(STORE_BLOB).put({ id: rec.id, blob: rec.blob });
      });
    });
  }

  // 只更新元信息，不碰视频字节
  function updateMeta(id, patch) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE_META, 'readwrite');
        } catch (e) { reject(e); return; }

        var store = tx.objectStore(STORE_META);
        var got = store.get(id);
        got.onsuccess = function () {
          var m = got.result;
          if (!m) return;
          if (patch && has(patch, 'title')) m.title = String(patch.title || '').slice(0, 80);
          if (patch && has(patch, 'note')) m.note = String(patch.note || '').slice(0, 500);
          m.updatedAt = Date.now();
          store.put(m);
        };
        got.onerror = function () { try { tx.abort(); } catch (e) {} };

        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('保存失败')); };
        tx.onabort = function () { reject(tx.error || new Error('保存失败')); };
      });
    });
  }

  function removeRecord(id) {
    return openDB().then(function (db) {
      return txRun(db, [STORE_META, STORE_BLOB], 'readwrite', function (tx) {
        tx.objectStore(STORE_META).delete(id);
        tx.objectStore(STORE_BLOB).delete(id);
      });
    });
  }

  /* ============ 用首帧生成封面 ============ */

  function makeCover(blob) {
    return new Promise(function (resolve) {
      var url = null, video = null, finished = false, timer = null, seekTimer = null;

      function done(dataUrl) {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (seekTimer) clearTimeout(seekTimer);
        if (video) {
          try { video.removeAttribute('src'); video.load(); } catch (e) {}
          video = null;
        }
        if (url) { try { URL.revokeObjectURL(url); } catch (e) {} url = null; }
        resolve(dataUrl || '');
      }

      function draw() {
        if (finished || !video) return;
        try {
          var w = video.videoWidth || 0;
          var h = video.videoHeight || 0;
          if (!w || !h) { done(''); return; }
          var tw = Math.min(COVER_W, w);
          var th = Math.max(1, Math.round(h * tw / w));
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          if (!ctx) { done(''); return; }
          ctx.drawImage(video, 0, 0, tw, th);
          done(canvas.toDataURL('image/jpeg', 0.72));
        } catch (e) {
          done('');
        }
      }

      try {
        url = URL.createObjectURL(blob);
        video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.playsInline = true;

        video.addEventListener('loadeddata', function () {
          // 跳过纯黑的开头，取稍后一点的一帧
          try {
            var d = video.duration;
            var t = (isFinite(d) && d > 0.6) ? Math.min(0.3, d / 3) : 0;
            if (t > 0) video.currentTime = t;
          } catch (e) {}
          if (seekTimer) clearTimeout(seekTimer);
          seekTimer = setTimeout(draw, 420); // seeked 不一定触发，兜底画一次
        });
        video.addEventListener('seeked', draw);
        video.addEventListener('error', function () { done(''); });

        video.src = url;
        if (video.load) { try { video.load(); } catch (e) {} }
        timer = setTimeout(function () { done(''); }, 9000); // 解码不出来就别卡住上传
      } catch (e) {
        done('');
      }
    });
  }

  /* ============ 上传 ============ */

  function addFile(file) {
    var now = Date.now();
    var rec = {
      id: 'v' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      title: stripExt(file.name),
      note: '',
      blob: file,
      coverDataUrl: '',
      size: file.size || 0,
      createdAt: now,
      updatedAt: now
    };
    return makeCover(file).then(function (cover) {
      rec.coverDataUrl = cover || '';
      return writeRecord(rec);
    }).then(function () { return rec; });
  }

  function onFilesPicked(files) {
    var list = [];
    for (var i = 0; i < files.length; i++) {
      if (isVideoFile(files[i])) list.push(files[i]);
    }
    if (!list.length) {
      toast('请选择视频文件（MP4 / WebM / MOV 等）', 'err');
      return;
    }

    var big = null;
    for (var j = 0; j < list.length; j++) {
      if (list[j].size > BIG_FILE) { big = list[j]; break; }
    }
    if (big) toast('视频较大（' + fmtSize(big.size) + '），浏览器可能保存失败', '');

    el.btnUpload.disabled = true;
    var okCount = 0;
    var failCount = 0;
    var chain = Promise.resolve();

    list.forEach(function (file) {
      chain = chain.then(function () {
        toast('正在保存 ' + (okCount + failCount + 1) + '/' + list.length + ' …', '');
        return addFile(file).then(function () {
          okCount++;
        }).catch(function (err) {
          failCount++;
          if (window.console) console.warn('[knowledge] 保存失败', file && file.name, err);
        });
      });
    });

    chain.then(function () {
      el.btnUpload.disabled = false;
      el.fileInput.value = '';
      return refresh();
    }).then(function () {
      if (okCount && !failCount) toast('已保存 ' + okCount + ' 个视频到本机', 'ok');
      else if (okCount) toast('已保存 ' + okCount + ' 个，' + failCount + ' 个失败（可能空间不足）', 'err');
      else toast('保存失败：本地空间不足或格式不支持', 'err');
    });
  }

  /* ============ 渲染 ============ */

  function find(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  function cardHtml(rec) {
    var cover = rec.coverDataUrl
      ? '<img src="' + esc(rec.coverDataUrl) + '" alt="' + esc(rec.title) + '" loading="lazy">'
      : '<span class="kn-cover-ico">🎬</span>';
    var note = rec.note
      ? '<p class="kn-note">' + esc(rec.note) + '</p>'
      : '<p class="kn-note kn-note-empty">暂无简介</p>';

    return '' +
      '<article class="kn-card" data-id="' + esc(rec.id) + '">' +
        '<button class="kn-cover' + (rec.coverDataUrl ? '' : ' kn-noimg') + '" type="button" data-act="play" aria-label="播放 ' + esc(rec.title) + '">' +
          cover +
          '<span class="kn-play" aria-hidden="true">▶</span>' +
        '</button>' +
        '<div class="kn-body">' +
          '<h3 class="kn-title">' + esc(rec.title || '未命名视频') + '</h3>' +
          note +
          '<div class="kn-meta"><span>' + esc(fmtDate(rec.createdAt)) + '</span><span>' + esc(fmtSize(rec.size)) + '</span></div>' +
          '<div class="kn-actions">' +
            '<button class="jt-btn jt-btn-outline jt-btn-sm" type="button" data-act="play">播放</button>' +
            '<button class="jt-btn jt-btn-ghost jt-btn-sm" type="button" data-act="edit">编辑</button>' +
            '<button class="jt-btn jt-btn-danger jt-btn-sm" type="button" data-act="del">删除</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function showEmpty(title, sub) {
    if (!el.empty) return;
    if (el.emptyTitle) el.emptyTitle.textContent = title || '';
    if (el.emptySub) el.emptySub.textContent = sub || '';
    el.empty.hidden = false;
  }

  function hideEmpty() {
    if (el.empty) el.empty.hidden = true;
  }

  function render() {
    var all = state.items;
    var kw = state.keyword.trim().toLowerCase();
    var list = kw ? all.filter(function (it) {
      return String(it.title || '').toLowerCase().indexOf(kw) >= 0;
    }) : all;

    if (el.countLabel) {
      el.countLabel.textContent = kw
        ? (list.length + ' / ' + all.length + ' 个视频')
        : (all.length + ' 个视频');
    }

    if (!all.length) {
      el.list.innerHTML = '';
      showEmpty('还没有视频，点右上角上传', '支持 MP4 / WebM / MOV 等浏览器能播放的格式，视频只保存在本机');
      return;
    }
    if (!list.length) {
      el.list.innerHTML = '';
      showEmpty('没有标题包含「' + state.keyword.trim() + '」的视频', '换个关键词试试，或清空搜索框');
      return;
    }

    hideEmpty();
    el.list.innerHTML = list.map(cardHtml).join('');
  }

  function refresh() {
    return loadAll().then(function (items) {
      state.items = items;
      render();
    }).catch(function (err) {
      if (window.console) console.warn('[knowledge] 读取本地视频失败', err);
      state.items = [];
      if (el.list) el.list.innerHTML = '';
      if (el.countLabel) el.countLabel.textContent = '0 个视频';
      showEmpty('本地存储不可用', '当前浏览器可能处于无痕模式或禁用了 IndexedDB，无法保存视频');
    });
  }

  /* ============ 弹层 ============ */

  function syncLock() {
    var locked = !!(el.playerModal && !el.playerModal.hidden) ||
      !!(el.editModal && !el.editModal.hidden);
    document.body.classList.toggle('kn-lock', locked);
  }

  function openModal(node) {
    if (!node) return;
    node.hidden = false;
    syncLock();
  }

  function closeModal(node) {
    if (!node) return;
    node.hidden = true;
    syncLock();
  }

  function stopPlayback() {
    if (el.playerVideo) {
      try { el.playerVideo.pause(); } catch (e) {}
      try { el.playerVideo.removeAttribute('src'); el.playerVideo.load(); } catch (e) {}
    }
    if (state.playingUrl) {
      try { URL.revokeObjectURL(state.playingUrl); } catch (e) {}
      state.playingUrl = '';
    }
  }

  function play(id) {
    var rec = find(id);
    if (!rec || !rec.blob) { toast('视频文件丢失，请重新上传', 'err'); return; }

    stopPlayback();
    try {
      state.playingUrl = URL.createObjectURL(rec.blob);
    } catch (e) {
      toast('无法播放该视频', 'err');
      return;
    }

    if (el.playerTitle) el.playerTitle.textContent = rec.title || '未命名视频';
    if (el.playerNote) {
      el.playerNote.textContent = rec.note || '暂无简介';
      el.playerNote.style.display = rec.note ? '' : 'none';
    }
    el.playerVideo.src = state.playingUrl;
    openModal(el.playerModal);
  }

  function closePlayer() {
    stopPlayback();
    closeModal(el.playerModal);
  }

  function openEdit(id) {
    var rec = find(id);
    if (!rec) return;
    state.editingId = id;
    el.editTitle.value = rec.title || '';
    el.editNote.value = rec.note || '';
    openModal(el.editModal);
    setTimeout(function () {
      try { el.editTitle.focus(); } catch (e) {}
    }, 30);
  }

  function closeEdit() {
    state.editingId = '';
    closeModal(el.editModal);
  }

  function saveEdit() {
    var id = state.editingId;
    if (!id) return;
    var title = (el.editTitle.value || '').trim() || '未命名视频';
    var note = (el.editNote.value || '').trim();

    el.btnSaveEdit.disabled = true;
    updateMeta(id, { title: title, note: note }).then(function () {
      el.btnSaveEdit.disabled = false;
      closeEdit();
      return refresh().then(function () { toast('已更新', 'ok'); });
    }).catch(function (err) {
      el.btnSaveEdit.disabled = false;
      if (window.console) console.warn('[knowledge] 保存失败', err);
      toast('保存失败，请重试', 'err');
    });
  }

  function onRemove(id) {
    var rec = find(id);
    if (!rec) return;
    if (!window.confirm('确定删除「' + (rec.title || '未命名视频') + '」？删除后无法恢复。')) return;

    if (state.editingId === id) closeEdit();
    removeRecord(id).then(function () {
      return refresh().then(function () { toast('已删除', 'ok'); });
    }).catch(function (err) {
      if (window.console) console.warn('[knowledge] 删除失败', err);
      toast('删除失败，请重试', 'err');
    });
  }

  /* ============ 事件绑定 / 初始化 ============ */

  function onListClick(e) {
    var btn = closestUp(e.target, '[data-act]');
    if (!btn) return;
    var card = closestUp(btn, '.kn-card');
    var id = card ? card.getAttribute('data-id') : '';
    if (!id) return;
    var act = btn.getAttribute('data-act');
    if (act === 'play') play(id);
    else if (act === 'edit') openEdit(id);
    else if (act === 'del') onRemove(id);
  }

  function bind() {
    el.btnUpload.addEventListener('click', function () { el.fileInput.click(); });

    el.fileInput.addEventListener('change', function () {
      var files = el.fileInput.files;
      if (files && files.length) onFilesPicked(files);
      else el.fileInput.value = '';
    });

    el.searchInput.addEventListener('input', function () {
      state.keyword = el.searchInput.value || '';
      render();
    });

    el.list.addEventListener('click', onListClick);

    el.btnClosePlayer.addEventListener('click', closePlayer);
    el.playerModal.addEventListener('click', function (e) {
      if (e.target === el.playerModal) closePlayer();
    });

    el.btnCancelEdit.addEventListener('click', closeEdit);
    el.btnSaveEdit.addEventListener('click', saveEdit);
    el.editModal.addEventListener('click', function (e) {
      if (e.target === el.editModal) { closeEdit(); return; }
      var btn = closestUp(e.target, '[data-act]');
      if (btn && btn.getAttribute('data-act') === 'close-edit') closeEdit();
    });
    el.editTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      if (el.editModal && !el.editModal.hidden) { closeEdit(); return; }
      if (el.playerModal && !el.playerModal.hidden) closePlayer();
    });

    // 页面离开时释放 blob URL，避免 WebView 里残留内存
    window.addEventListener('pagehide', stopPlayback);
  }

  function init() {
    el = {
      list: $('knList'),
      empty: $('knEmpty'),
      emptyTitle: $('emptyTitle'),
      emptySub: $('emptySub'),
      countLabel: $('countLabel'),
      searchInput: $('searchInput'),
      btnUpload: $('btnUpload'),
      fileInput: $('fileInput'),
      toast: $('toast'),
      playerModal: $('playerModal'),
      playerTitle: $('playerTitle'),
      playerNote: $('playerNote'),
      playerVideo: $('playerVideo'),
      btnClosePlayer: $('btnClosePlayer'),
      editModal: $('editModal'),
      editTitle: $('editTitle'),
      editNote: $('editNote'),
      btnSaveEdit: $('btnSaveEdit'),
      btnCancelEdit: $('btnCancelEdit')
    };

    if (!el.list) return; // 不是本页，静默退出
    bind();
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init: init,
    list: loadAll,
    add: addFile,
    update: updateMeta,
    remove: removeRecord,
    refresh: refresh
  };
})();
