/**
 * [新增] Vertrise跃升 · 人体动作分析核心引擎（MediaPipe Pose）
 * ------------------------------------------------------------
 * 职责：
 * - 本地姿态识别（MediaPipe Pose，纯前端，数据不出本机）
 * - 逐帧采样分析：抽帧缩小后送模型 → 计算膝角 / 重心高度 / 重心横移
 * - 骨架分层绘制（视频底图 + 骨骼层，青色风格与站点统一）
 * - 容错：单帧无检出/遮挡 → lost 帧断点；连续丢失超阈值自动停止
 * - AI 动作评估：组装关键帧图片 + 姿态时序 JSON → POST POSE_API_URL
 *
 * 依赖：@mediapipe/pose（页面 head 引入 pose.js + pose_solution_packed_assets_loader.js）
 * 暴露：window.VTPose
 */
window.VTPose = (function () {
  'use strict';

  var CONFIG = window.JTConfig || {};
  var MEDIAPIPE_BASE = CONFIG.MEDIAPIPE_BASE || './mediapipe/';
  // CDN 兜底资源（本机 file:// 打开时浏览器禁止 fetch 本地 .data/.wasm，
  // 自动回退到 CDN；线上部署 CDN 被墙时本地优先正常加载）
  var CDN_MEDIAPIPE_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/';

  var poseInstance = null;
  var latestResults = null;
  var usedCdnFallback = false;

  // MediaPipe Pose 33 关键点骨架连接表（上身/躯干/下肢）
  var CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
    [25, 27], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32], [25, 26]
  ];

  // [新增] 助跑起跳动作的 AI 内置知识（来源：jump knowledge.txt，AI 天然具备，无需问时现发）
  var APPROACH_JUMP_KNOWLEDGE =
    '双脚起跳：助跑阶段重心自然前倾，速度逐渐加快，倒数第二步全力蹬地，另一条腿前伸（尽量伸直）手臂同时后摆，同时已经屈髋（想象胸口压住膝盖）还可以防止膝盖前伸，最后一步前脚掌刺向地面（0.1到0.2秒内必须完成起跳）同时手臂前摆（最后一步刚触地，手臂已经在身体前面）\n' +
    '单脚起跳：起跳前要有足够的水平速度，起跳时，起跳腿要像一根钢筋一样（同时摆动腿和手臂快速上摆）0.15秒左右完成起跳';

  // ---------- 模型加载（懒加载，复用单例） ----------
  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(msg || '操作超时')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function initPose(modelComplexity, base) {
    poseInstance = new window.Pose({
      locateFile: function (file) { return base + file; }
    });
    poseInstance.setOptions({
      modelComplexity: modelComplexity || 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      // 放宽置信度阈值，提升画面中人物较小时的检出率
      minDetectionConfidence: 0.3,
      minTrackingConfidence: 0.3
    });
    poseInstance.onResults(function (r) { latestResults = r; });
    var init = poseInstance.initialize ? poseInstance.initialize() : Promise.resolve();
    // 30s 超时：模型加载（下载/编译 WASM）卡住时明确报错而非无限等待
    return withTimeout(init, 30000, '模型加载超时，请检查网络后重试');
  }

  function loadModel(modelComplexity) {
    if (poseInstance) return Promise.resolve();
    if (!window.Pose) return Promise.reject(new Error('MediaPipe Pose 未加载（请检查网络/CDN）'));
    // 先尝试本地自托管资源（线上部署秒加载）；失败（本机 file:// 禁止 fetch 本地文件等）自动回退 CDN
    return initPose(modelComplexity, MEDIAPIPE_BASE).catch(function (err) {
      if (usedCdnFallback) throw err;
      usedCdnFallback = true;
      console.log('[Pose] 本地模型资源加载失败，已自动回退 CDN: ' + err.message);
      return initPose(modelComplexity, CDN_MEDIAPIPE_BASE);
    });
  }

  // 单帧推理：15s 超时（普通设备 640px 推理约 1-5s，留足余量）。
  // 超时/异常不抛错，标记 timedOut 由调用方按丢失帧处理
  function sendFrame(frame) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { done = true; resolve({ timedOut: true }); }, 15000);
      poseInstance.send({ image: frame }).then(function () {
        if (!done) { done = true; clearTimeout(timer); resolve({ timedOut: false }); }
      }, function (e) {
        if (!done) { done = true; clearTimeout(timer); resolve({ timedOut: false, error: e }); }
      });
    });
  }

  // ---------- 几何 ----------
  // 三点夹角（b 为顶点），返回角度或 null
  function angleAt(a, b, c) {
    if (!a || !b || !c) return null;
    var v1x = a.x - b.x, v1y = a.y - b.y;
    var v2x = c.x - b.x, v2y = c.y - b.y;
    var m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    var m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (!m1 || !m2) return null;
    var dot = v1x * v2x + v1y * v2y;
    var deg = Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
    return Math.round(deg * 10) / 10;
  }

  function visible(p) {
    return p && (p.visibility === undefined || p.visibility > 0.5);
  }

  // ---------- 视频辅助 ----------
  function seekTo(video, t, timeout) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; video.removeEventListener('seeked', onS); resolve(); }
      }, timeout || 1500);
      function onS() {
        if (!done) { done = true; clearTimeout(timer); video.removeEventListener('seeked', onS); resolve(); }
      }
      video.addEventListener('seeked', onS);
      try { video.currentTime = Math.max(0, Math.min(t, video.duration || 0)); }
      catch (e) { done = true; clearTimeout(timer); video.removeEventListener('seeked', onS); resolve(); }
    });
  }

  function nextFrame() {
    return new Promise(function (r) {
      requestAnimationFrame(function () { requestAnimationFrame(r); });
    });
  }

  // 分析帧最长边分辨率（JTConfig.POSE_ANALYZE_MAXDIM 可调，默认 480）
  function analysisDim() {
    return CONFIG.POSE_ANALYZE_MAXDIM || 480;
  }

  // 抽帧缩小（maxDim 最大边长），降低 MediaPipe 计算量。
  // 分辨率默认 480（JTConfig.POSE_ANALYZE_MAXDIM 可调）：
  // 人物较小时建议用「框选人物」裁剪放大，识别更稳且不拖慢整体。
  function makeFrameCanvas(video, maxDim) {
    var w = video.videoWidth || 320, h = video.videoHeight || 240;
    var scale = Math.min(1, (maxDim || analysisDim()) / Math.max(w, h));
    var cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, cw, ch);
    return c;
  }

  // ---------- 骨架绘制（分层：本画布即骨架层，视频为底图） ----------
  // 线宽 / 关节点半径按人物实际大小（landmark 包围盒高度占比）自适应：
  // 人物在画面中小时用细线小点，清晰不糊；人物大时用粗线大点，便于查看。
  function drawSkeleton(ctx, lm, w, h) {
    ctx.clearRect(0, 0, w, h);
    if (!lm || !lm.length) return;
    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < lm.length; i++) {
      if (!visible(lm[i])) continue;
      if (lm[i].y < minY) minY = lm[i].y;
      if (lm[i].y > maxY) maxY = lm[i].y;
    }
    var frac = (maxY > minY && (maxY - minY) > 0.01) ? (maxY - minY) : 0.5;
    var lineW = Math.max(1.5, Math.min(4, 1.5 + frac * 4));
    var nodeR = Math.max(1.5, Math.min(4, 2 + frac * 3));
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,198,255,0.9)';
    ctx.lineWidth = lineW;
    ctx.shadowColor = 'rgba(0,198,255,0.6)';
    ctx.shadowBlur = 6;
    CONNECTIONS.forEach(function (edge) {
      var a = lm[edge[0]], b = lm[edge[1]];
      if (!a || !b || !visible(a) || !visible(b)) return;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3fd4ff';
    lm.forEach(function (p) {
      if (!visible(p)) return;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, nodeR, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---------- 单帧计算 ----------
  function computeFrame(lm) {
    if (!lm || lm.length < 33) return null;
    var Lh = lm[23], Lk = lm[25], La = lm[27];
    var Rh = lm[24], Rk = lm[26], Ra = lm[28];
    var kneeL = (visible(Lh) && visible(Lk) && visible(La)) ? angleAt(Lh, Lk, La) : null;
    var kneeR = (visible(Rh) && visible(Rk) && visible(Ra)) ? angleAt(Rh, Rk, Ra) : null;
    // 重心近似：髋部中心（左右髋中点）
    var comY = null, comX = null;
    if (visible(lm[23]) && visible(lm[24])) {
      comY = (lm[23].y + lm[24].y) / 2;
      comX = (lm[23].x + lm[24].x) / 2;
    } else if (visible(lm[23])) { comY = lm[23].y; comX = lm[23].x; }
    // 脚部最低点 y（画面坐标，1=底部）：脚踝/脚跟/脚尖中可见的最低点，用于自动识别离地/落地
    var feetY = null;
    for (var i = 27; i <= 32; i++) {
      if (visible(lm[i]) && (feetY === null || lm[i].y > feetY)) feetY = lm[i].y;
    }
    return {
      kneeL: kneeL,
      kneeR: kneeR,
      comH: comY === null ? null : Math.round((1 - comY) * 1000) / 10,
      comX: comX === null ? null : Math.round(comX * 1000) / 10,
      feetY: feetY
    };
  }

  // ---------- 框选人物（ROI）辅助 ----------
  // 关键帧框插值：boxes = [{t, box:{x,y,w,h}}]（视频像素坐标），
  // 返回时刻 t 的插值框；无关键帧返回 null。人物不必完整在框内（分析时会外扩）。
  function boxAtTime(boxes, t) {
    if (!boxes || !boxes.length) return null;
    if (boxes.length === 1) return boxes[0].box;
    var prev = boxes[0], next = boxes[boxes.length - 1];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].t <= t) prev = boxes[i];
      if (boxes[i].t >= t) { next = boxes[i]; break; }
    }
    if (prev === next) return prev.box;
    var span = (next.t - prev.t) || 1;
    var k = Math.max(0, Math.min(1, (t - prev.t) / span));
    var b = prev.box, nb = next.box;
    return {
      x: b.x + (nb.x - b.x) * k,
      y: b.y + (nb.y - b.y) * k,
      w: b.w + (nb.w - b.w) * k,
      h: b.h + (nb.h - b.h) * k
    };
  }

  // 按框裁剪分析帧：取框所在区域（外扩 45%，人物不一定要完整在框内），
  // 缩放至分析分辨率。返回带 _crop 标记的画布，_crop 记录裁剪原点与原始尺寸。
  function makeBoxFrame(video, box, maxDim) {
    var vw = video.videoWidth || 320, vh = video.videoHeight || 240;
    var mx = Math.round(box.w * 0.45), my = Math.round(box.h * 0.45);
    var sx = Math.max(0, Math.floor(box.x - mx));
    var sy = Math.max(0, Math.floor(box.y - my));
    var cw = Math.min(vw - sx, Math.round(box.w + mx * 2));
    var ch = Math.min(vh - sy, Math.round(box.h + my * 2));
    if (cw < 8 || ch < 8 || sx >= vw || sy >= vh) return null;
    var scale = Math.min(1, (maxDim || analysisDim()) / Math.max(cw, ch));
    var tw = Math.max(2, Math.round(cw * scale)), th = Math.max(2, Math.round(ch * scale));
    var c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(video, sx, sy, cw, ch, 0, 0, tw, th);
    c._crop = { sx: sx, sy: sy, cw: cw, ch: ch };
    return c;
  }

  // 把裁剪画布上的归一化关键点映射回整帧视频的归一化坐标
  function mapBoxLandmarks(lm, crop, vw, vh) {
    if (!crop || !lm) return lm;
    return lm.map(function (p) {
      if (!p) return p;
      return {
        x: (crop.sx + p.x * crop.cw) / vw,
        y: (crop.sy + p.y * crop.ch) / vh,
        z: p.z,
        visibility: p.visibility
      };
    });
  }

  // ---------- 框选人物控制器（可调大小/位置，支持关键帧插值） ----------
  // zone：视频容器（含视频/画布），canvas：姿态画布（尺寸=视频尺寸），video：视频元素。
  // 返回：{ startDraw, saveKeyframe, clear, getKeyframes, setPlayTime, setVisible, hasBox }
  function createBoxController(zone, canvas, video) {
    var keyframes = [];   // [{t, box:{x,y,w,h}}] 视频像素坐标
    var currentBox = null;
    var drawing = false, moving = false, resizing = false;
    var startClient = null, startBox = null;
    var visible = true;

    var el = document.createElement('div');
    el.className = 'vt-box';
    var handle = document.createElement('div');
    handle.className = 'vt-box-handle';
    el.appendChild(handle);
    zone.appendChild(el);
    el.style.display = 'none';

    function clampV(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function canvasRect() {
      return canvas.getBoundingClientRect();
    }

    function toVideo(clientX, clientY) {
      var r = canvasRect();
      if (!r.width || !r.height) return { x: 0, y: 0 };
      return {
        x: clampV((clientX - r.left) / r.width, 0, 1) * video.videoWidth,
        y: clampV((clientY - r.top) / r.height, 0, 1) * video.videoHeight
      };
    }

    function renderBox(box) {
      if (!box || !visible) { el.style.display = 'none'; return; }
      var r = canvasRect();
      var zr = zone.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var sx = r.width / (video.videoWidth || r.width);
      var sy = r.height / (video.videoHeight || r.height);
      el.style.display = 'block';
      el.style.left = (r.left - zr.left + box.x * sx) + 'px';
      el.style.top = (r.top - zr.top + box.y * sy) + 'px';
      el.style.width = (box.w * sx) + 'px';
      el.style.height = (box.h * sy) + 'px';
    }

    function nearestKeyframe(t) {
      if (!keyframes.length) return null;
      var best = keyframes[0], bd = Math.abs(best.t - t);
      for (var i = 1; i < keyframes.length; i++) {
        var d = Math.abs(keyframes[i].t - t);
        if (d < bd) { bd = d; best = keyframes[i]; }
      }
      return best;
    }

    // 保存/更新一个关键帧：当前时刻附近的已有帧就地更新，否则新增
    function commitBox(box, forceNew) {
      if (!box) return;
      var t = video.currentTime || 0;
      var kf = forceNew ? null : nearestKeyframe(t);
      if (kf && Math.abs(kf.t - t) < 0.6) {
        kf.box = { x: box.x, y: box.y, w: box.w, h: box.h };
      } else {
        keyframes.push({ t: t, box: { x: box.x, y: box.y, w: box.w, h: box.h } });
        keyframes.sort(function (a, b) { return a.t - b.t; });
      }
      currentBox = box;
    }

    function applyMoveResize(dx, dy, dw, dh) {
      var box = startBox;
      var base = { x: box.x + dx, y: box.y + dy, w: Math.max(20, box.w + dw), h: Math.max(20, box.h + dh) };
      base.x = clampV(base.x, 0, Math.max(0, video.videoWidth - base.w));
      base.y = clampV(base.y, 0, Math.max(0, video.videoHeight - base.h));
      commitBox(base, false);
      renderBox(base);
    }

    function onDown(e, mode) {
      if (!visible) return;
      e.preventDefault();
      e.stopPropagation();
      drawing = mode === 'draw';
      moving = mode === 'move';
      resizing = mode === 'resize';
      startClient = { x: e.clientX, y: e.clientY };
      if (drawing) {
        startBox = toVideo(e.clientX, e.clientY);
        currentBox = null;
        el.style.display = 'none';
      } else {
        var ref = currentBox || (nearestKeyframe(video.currentTime) ? nearestKeyframe(video.currentTime).box : null);
        startBox = ref ? { x: ref.x, y: ref.y, w: ref.w, h: ref.h } : null;
      }
    }

    function onMove(e) {
      if (!drawing && !moving && !resizing) return;
      if (!startBox) return; // 尚未按下/未选到框时忽略
      var now = { x: e.clientX, y: e.clientY };
      var dx = now.x - startClient.x, dy = now.y - startClient.y;
      if (drawing) {
        var cur = toVideo(e.clientX, e.clientY);
        var x = Math.min(startBox.x, cur.x), y = Math.min(startBox.y, cur.y);
        var w = Math.abs(cur.x - startBox.x), h = Math.abs(cur.y - startBox.y);
        currentBox = { x: x, y: y, w: Math.max(8, w), h: Math.max(8, h) };
        renderBox(currentBox);
      } else if (moving) {
        var dxv = dx * (video.videoWidth / canvasRect().width), dyv = dy * (video.videoHeight / canvasRect().height);
        applyMoveResize(dxv, dyv, 0, 0);
      } else if (resizing) {
        var dxr = dx * (video.videoWidth / canvasRect().width), dyr = dy * (video.videoHeight / canvasRect().height);
        applyMoveResize(0, 0, dxr, dyr);
      }
    }

    function onUp() {
      // 过小（纯点击/误拖）不产生框，避免 8px 小框影响后续分析
      if (drawing && currentBox) {
        if (currentBox.w >= 40 && currentBox.h >= 40) commitBox(currentBox, true);
        else currentBox = null;
      }
      drawing = moving = resizing = false;
      startClient = null; startBox = null;
      renderBox(currentBox || (keyframes.length ? boxAtTime(keyframes, video.currentTime || 0) : null));
    }

    zone.addEventListener('mousedown', function (e) { if (e.target === el || el.contains(e.target)) return; onDown(e, 'draw'); });
    el.addEventListener('mousedown', function (e) { onDown(e, 'move'); });
    handle.addEventListener('mousedown', function (e) { onDown(e, 'resize'); });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', function () { renderBox(currentBox || (keyframes.length ? boxAtTime(keyframes, video.currentTime || 0) : null)); });

    return {
      startDraw: function () { drawing = true; currentBox = null; el.style.display = 'none'; },
      saveKeyframe: function () {
        var box = currentBox || nearestKeyframe(video.currentTime) || boxAtTime(keyframes, video.currentTime);
        if (!box) return false;
        commitBox({ x: box.x, y: box.y, w: box.w, h: box.h }, true);
        renderBox(box);
        return true;
      },
      clear: function () { keyframes = []; currentBox = null; el.style.display = 'none'; },
      getKeyframes: function () { return keyframes.map(function (k) { return { t: k.t, box: { x: k.box.x, y: k.box.y, w: k.box.w, h: k.box.h } }; }); },
      setPlayTime: function (t) { if (!moving && !drawing && !resizing) renderBox(keyframes.length ? boxAtTime(keyframes, t) : currentBox); },
      setVisible: function (v) { visible = v; if (!v) el.style.display = 'none'; else renderBox(currentBox || (keyframes.length ? boxAtTime(keyframes, video.currentTime || 0) : null)); },
      hasBox: function () { return !!(keyframes.length || currentBox); }
    };
  }

  // ---------- 逐帧分析（返回 { promise, cancel }） ----------
  function analyze(opts) {
    var cancelled = false;
    if (opts.onPhase) opts.onPhase('loading-model');
    var promise = loadModel(opts.modelComplexity).then(function () {
      if (opts.onPhase) opts.onPhase('analyzing');
      var video = opts.video;
      var sampleEvery = Math.max(1, opts.sampleEvery || 2);
      var fps = opts.fps || 30;
      var cs = opts.clipStart || 0;
      var ce = (opts.clipEnd !== undefined && isFinite(opts.clipEnd)) ? opts.clipEnd : (video.duration || 0);
      var frameInterval = 1 / fps;
      var total = Math.floor((ce - cs) / (frameInterval * sampleEvery));
      var data = [];
      var lostStreak = 0;
      var timeoutLost = 0;   // 连续丢失中由推理超时导致的帧数
      var maxLost = Math.max(10, Math.round(total * 0.3));
      var prev = null;

      return new Promise(function (resolve) {
        var boxes = opts.boxes;   // 框选关键帧（可为空）
        var frame = null;         // 当前帧输入画布（含裁剪标记）
        function step(i) {
          if (cancelled) { resolve({ cancelled: true, data: data }); return; }
          if (i > total) { resolve({ cancelled: false, data: data }); return; }
          var t = cs + i * frameInterval * sampleEvery;
          t = Math.round(t * fps) / fps; // 对齐到精确帧，保证多次运行时间轴一致
          if (t > ce + 1e-6) { resolve({ cancelled: false, data: data }); return; }
          seekTo(video, t)
            .then(nextFrame)
            .then(function () {
              if (cancelled) { resolve({ cancelled: true, data: data }); return; }
              // 有框选时按框裁剪放大人物（含外扩），否则整帧分析。
              // 过小的框（误点产生的 8px 小框）视为无效，回退整帧分析，避免裁剪到无人物区域导致全帧丢失
              var box = boxes ? boxAtTime(boxes, t) : null;
              if (box && (box.w < 40 || box.h < 40)) box = null;
              frame = box ? makeBoxFrame(video, box, analysisDim()) : makeFrameCanvas(video, analysisDim());
              if (!frame) {
                var curT0 = Math.max(0, Math.min(t - cs, ce - cs));
                data.push({ t: Math.round(curT0 * 1000) / 1000, kneeL: prev ? prev.kneeL : null, kneeR: prev ? prev.kneeR : null, comH: prev ? prev.comH : null, comX: prev ? prev.comX : null, feetY: prev ? prev.feetY : null, lost: true });
                lostStreak++;
                if (lostStreak >= maxLost) { resolve({ cancelled: false, data: data, aborted: true, abortedReason: 'lost' }); return; }
                if (opts.onProgress) opts.onProgress(i, total, curT0, lostStreak);
                setTimeout(function () { step(i + 1); }, 0);
                return;
              }
              return sendFrame(frame);
            })
            .then(function (r) {
              // 单帧推理超时/异常：按丢失帧处理并继续，避免卡死
              if (r && (r.timedOut || r.error)) {
                var curT1 = Math.max(0, Math.min(t - cs, ce - cs));
                curT1 = Math.round(curT1 * 1000) / 1000;
                timeoutLost++;
                lostStreak++;
                data.push({ t: curT1, kneeL: prev ? prev.kneeL : null, kneeR: prev ? prev.kneeR : null, comH: prev ? prev.comH : null, comX: prev ? prev.comX : null, feetY: prev ? prev.feetY : null, lost: true });
                if (lostStreak >= maxLost) { resolve({ cancelled: false, data: data, aborted: true, abortedReason: 'timeout' }); return; }
                if (opts.onProgress) opts.onProgress(i, total, curT1, lostStreak);
                setTimeout(function () { step(i + 1); }, 0);
                return;
              }
              var res = latestResults;
              var lm = res && res.poseLandmarks ? res.poseLandmarks : null;
              // 框选裁剪时，把关键点从裁剪画布坐标映射回整帧视频坐标
              if (lm && frame && frame._crop) lm = mapBoxLandmarks(lm, frame._crop, video.videoWidth, video.videoHeight);
              var curT = Math.max(0, Math.min(t - cs, ce - cs));
              curT = Math.round(curT * 1000) / 1000;
              var f = computeFrame(lm);
              if (f) {
                lostStreak = 0;
                prev = f;
                data.push({ t: curT, kneeL: f.kneeL, kneeR: f.kneeR, comH: f.comH, comX: f.comX, feetY: f.feetY, lost: false });
                if (opts.onFrame) opts.onFrame({ t: curT, lm: lm, f: f });
              } else {
                lostStreak++;
                // 人物离开画面/遮挡：标记 lost 帧，沿用上一帧值保证曲线连续
                data.push({
                  t: curT,
                  kneeL: prev ? prev.kneeL : null,
                  kneeR: prev ? prev.kneeR : null,
                  comH: prev ? prev.comH : null,
                  comX: prev ? prev.comX : null,
                  feetY: prev ? prev.feetY : null,
                  lost: true
                });
                if (lostStreak >= maxLost) {
                  resolve({ cancelled: false, data: data, aborted: true, abortedReason: timeoutLost > 0 ? 'timeout' : 'lost' });
                  return;
                }
              }
              if (opts.onProgress) opts.onProgress(i, total, curT, lostStreak);
              setTimeout(function () { step(i + 1); }, 0);
            })
            .catch(function (err) {
              resolve({ cancelled: false, data: data, error: err });
            });
        }
        step(0);
      });
    });
    return { promise: promise, cancel: function () { cancelled = true; } };
  }

  // ---------- 关键帧渲染（JPEG dataURL） ----------
  function renderKeyframe(video, t, maxDim) {
    return seekTo(video, t).then(nextFrame).then(function () {
      return makeFrameCanvas(video, maxDim || 720).toDataURL('image/jpeg', 0.7);
    });
  }

  // ---------- 统计 ----------
  function computeStats(data) {
    var valid = data.filter(function (d) { return !d.lost && (d.kneeL !== null || d.kneeR !== null); }).length;
    var lost = data.filter(function (d) { return d.lost; }).length;
    var kneeVals = [];
    data.forEach(function (d) {
      if (d.kneeL !== null) kneeVals.push(d.kneeL);
      if (d.kneeR !== null) kneeVals.push(d.kneeR);
    });
    var comVals = data.map(function (d) { return d.comH; }).filter(function (v) { return v !== null; });
    var minKnee = kneeVals.length ? Math.min.apply(null, kneeVals) : null;
    var avgKnee = kneeVals.length ? kneeVals.reduce(function (a, b) { return a + b; }, 0) / kneeVals.length : null;
    return {
      valid: valid,
      total: data.length,
      lost: lost,
      minKnee: minKnee,
      avgKnee: avgKnee,
      maxCom: comVals.length ? Math.max.apply(null, comVals) : null,
      minCom: comVals.length ? Math.min.apply(null, comVals) : null
    };
  }

  // ---------- 自动识别弹跳（离地/落地帧 → 腾空时间 → 高度） ----------
  // 依据脚部最低点 feetY（画面坐标，0=顶 1=底）：脚离地时 feetY 明显上移。
  // 稳健策略：5 帧中值滤波 + 按人体身高自适应阈值 + 滞回 + 最短腾空过滤，
  // 避免把姿态识别的正常抖动误判成“几厘米的假跳跃”，并保证多次运行结果稳定。
  // 返回 [{liftoffTime, landingTime, flightTime, heightCm, contactTime, rsi}]，按高度降序。
  function detectJump(data, opts) {
    opts = opts || {};
    var minAir = opts.minAirSec || 0.15;   // <0.15s 的“腾空”视为噪声
    var maxAir = opts.maxAirSec || 1.5;
    var n = data.length;
    if (n < 5) return [];

    // 原始脚部信号（lost 帧记为 null）
    var raw = data.map(function (d) { return (!d.lost && d.feetY !== null && d.feetY !== undefined) ? d.feetY : null; });

    // 5 帧中值滤波（对单帧尖峰稳健，远优于均值）
    var s = new Array(n);
    for (var i = 0; i < n; i++) {
      var win = [];
      for (var k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
        if (raw[k] !== null) win.push(raw[k]);
      }
      if (win.length) { win.sort(function (a, b) { return a - b; }); s[i] = win[Math.floor(win.length / 2)]; }
      else s[i] = null;
    }

    // 地面基准：脚着地占多数时间，取较高分位
    var ys = s.filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
    if (ys.length < 5) return [];
    var ground = ys[Math.floor(ys.length * 0.9)];

    // 人体尺度：髋到脚的中位距离（≈半身高），让阈值随拍摄远近自适应
    var hf = [];
    for (var i2 = 0; i2 < n; i2++) {
      var d2 = data[i2];
      if (d2.feetY !== null && d2.feetY !== undefined && d2.comH !== null && d2.comH !== undefined) {
        var dist = d2.feetY - (1 - d2.comH / 100); // comH=(1-hipY)*100 → hipY=1-comH/100
        if (dist > 0.02 && dist < 0.8) hf.push(dist);
      }
    }
    var scale = 0.12;
    if (hf.length) { hf.sort(function (a, b) { return a - b; }); scale = hf[Math.floor(hf.length / 2)]; }
    scale = Math.max(0.04, Math.min(0.35, scale));

    // 滞回阈值：进入腾空需脚明显上移，退出更宽松，避免边界抖动。
    // 混用相对值 + 绝对下限：人站得远（画面里小）时也不会退化成过度灵敏。
    var enter = ground - Math.max(scale * 0.14, 0.03);
    var exit = ground - Math.max(scale * 0.06, 0.012);

    // 找腾空段（平滑信号 + 滞回）
    var segs = [];
    var start = null;
    for (var i3 = 0; i3 < n; i3++) {
      var v = s[i3];
      if (start === null && v !== null && v < enter) start = i3;
      else if (start !== null && (v === null || v >= exit)) { segs.push([start, Math.max(start, i3 - 1)]); start = null; }
    }
    if (start !== null) segs.push([start, n - 1]);

    // 过滤 + 计算
    var jumps = [];
    segs.forEach(function (seg) {
      var a = seg[0], b = seg[1];
      var ft = data[b].t - data[a].t;
      if (ft < minAir || ft > maxAir) return;
      jumps.push({
        liftoffTime: Math.round(data[a].t * 1000) / 1000,
        landingTime: Math.round(data[b].t * 1000) / 1000,
        flightTime: Math.round(ft * 1000) / 1000,
        heightCm: Math.round((9.81 * ft * ft / 8) * 1000) / 10
      });
    });

    // 合并地面间隔极短（<0.06s，噪声断裂）的相邻段
    jumps.sort(function (a, b) { return a.liftoffTime - b.liftoffTime; });
    var merged = [];
    jumps.forEach(function (j) {
      var last = merged[merged.length - 1];
      if (last && j.liftoffTime - last.landingTime < 0.06) {
        last.landingTime = j.landingTime;
        last.flightTime = Math.round((last.landingTime - last.liftoffTime) * 1000) / 1000;
        last.heightCm = Math.round((9.81 * last.flightTime * last.flightTime / 8) * 1000) / 10;
      } else {
        merged.push(j);
      }
    });
    jumps = merged;

    // 触地时间（RSI）：相邻两次弹跳的 落地→下次离地
    for (var m2 = 1; m2 < jumps.length; m2++) {
      var contact = jumps[m2].liftoffTime - jumps[m2 - 1].landingTime;
      if (contact > 0 && contact < 2) {
        jumps[m2].contactTime = Math.round(contact * 1000) / 1000;
        jumps[m2].rsi = Math.round(((jumps[m2].heightCm / 100) / contact) * 100) / 100;
      }
    }
    jumps.sort(function (a, b) { return b.heightCm - a.heightCm; });
    return jumps;
  }

  // ---------- 髋部最高点测弹跳（需要身高做像素→厘米标定） ----------
  // 原理：弹跳高度 = 起跳后髋部(≈重心)最高点 − 站立髋部基准，再用身高换算成厘米。
  // 相比“腾空时间法”，挂框/抓篮不会让它虚高，适合扣篮等非纯抛物线场景。
  // 关键：标定在每个顶点附近“局部”进行（人在画面里走近/走远时全局标定会失真）。
  // opts: { heightCm: 必填, count: 可选(预期跳跃次数) }
  function measureJumpByHip(data, opts) {
    opts = opts || {};
    var heightCm = parseFloat(opts.heightCm);
    if (!heightCm || heightCm <= 0) return { ok: false, msg: '请先填写身高', jumps: [] };
    var count = parseInt(opts.count, 10) || 0;
    var n = data.length;
    if (n < 5) return { ok: false, msg: '数据不足', jumps: [] };

    // 髋部 y（0=顶 1=底，由 comH=(1-hipY)*100 反推）与脚部 y
    var hip = data.map(function (d) { return (!d.lost && d.comH !== null && d.comH !== undefined) ? (1 - d.comH / 100) : null; });
    var foot = data.map(function (d) { return (!d.lost && d.feetY !== null && d.feetY !== undefined) ? d.feetY : null; });

    // 5 帧中值平滑髋部（仅用于找顶点）
    var s = new Array(n);
    for (var j = 0; j < n; j++) {
      var win = [];
      for (var k = Math.max(0, j - 2); k <= Math.min(n - 1, j + 2); k++) if (hip[k] !== null) win.push(hip[k]);
      if (win.length) { win.sort(function (a, b) { return a - b; }); s[j] = win[Math.floor(win.length / 2)]; } else s[j] = null;
    }

    // 找髋部最高点（y 局部最小）作为候选顶点
    var peaks = [];
    for (var m = 1; m < n - 1; m++) {
      if (s[m] === null || s[m - 1] === null || s[m + 1] === null) continue;
      if (s[m] < s[m - 1] && s[m] <= s[m + 1]) {
        var bestM = m, bestV = hip[m];
        for (var q = Math.max(0, m - 2); q <= Math.min(n - 1, m + 2); q++) {
          if (hip[q] !== null && hip[q] < bestV) { bestV = hip[q]; bestM = q; }
        }
        peaks.push({ idx: bestM, t: data[bestM].t, hipY: bestV });
      }
    }
    // 相邻极近的峰合并（保留更高者）
    peaks.sort(function (a, b) { return a.t - b.t; });
    var merged = [];
    peaks.forEach(function (p) {
      var last = merged[merged.length - 1];
      if (last && p.t - last.t < 0.15) { if (p.hipY < last.hipY) merged[merged.length - 1] = p; return; }
      merged.push(p);
    });
    peaks = merged;

    // 对每个顶点：在其附近 ±1s 窗口内局部标定 + 局部基准
    var out = [];
    var endT = data[n - 1].t;
    peaks.forEach(function (p) {
      var t0 = Math.max(0, p.t - 1.0), t1 = Math.min(endT, p.t + 1.0);
      var legs = [], feets = [];
      for (var i = 0; i < n; i++) {
        if (data[i].t < t0 || data[i].t > t1) continue;
        if (hip[i] !== null && foot[i] !== null && foot[i] > hip[i]) legs.push(foot[i] - hip[i]);
        if (foot[i] !== null) feets.push(foot[i]);
      }
      if (legs.length < 5 || feets.length < 5) return;
      legs.sort(function (a, b) { return a - b; });
      feets.sort(function (a, b) { return a - b; });
      var legNorm = legs[Math.floor(legs.length * 0.9)];     // 站直时髋→脚长度
      var ground = feets[Math.floor(feets.length * 0.9)];    // 局部地面线（脚最低处）
      // 髋→脚 占身高的比例：MediaPipe 的“髋”关键点比解剖髋关节靠上（接近腰线），
      // 实测约 0.63（若整体仍偏小/偏大，微调此系数即可）。
      var HIP_FRAC = 0.63;
      var scale = heightCm / (legNorm / HIP_FRAC);               // 厘米 / 单位画面高度（局部）
      var baseHip = ground - legNorm;                        // 站立髋高 = 地面 − 站直腿长（不受腾空帧影响）
      var riseCm = (baseHip - p.hipY) * scale;
      if (riseCm > 2) out.push({ heightCm: Math.round(riseCm * 10) / 10, peakTime: Math.round(p.t * 1000) / 1000 });
    });

    // 给了次数：取最高的 N 次；没给：过滤掉跑步起伏等小抖动
    if (count > 0) {
      out.sort(function (a, b) { return b.heightCm - a.heightCm; });
      out = out.slice(0, count);
      out.sort(function (a, b) { return a.peakTime - b.peakTime; });
    } else {
      var minCm = Math.max(10, heightCm * 0.06);
      out = out.filter(function (p) { return p.heightCm > minCm; });
    }
    out.sort(function (a, b) { return b.heightCm - a.heightCm; });
    return { ok: true, jumps: out };
  }

  // ---------- 曲线图（Chart.js，宿主页面复用） ----------
  function buildChart(chartCanvas, data) {
    if (window.__poseChart) { window.__poseChart.destroy(); window.__poseChart = null; }
    if (!window.Chart) return null;
    var labels = data.map(function (d) { return d.t; });
    var c = new window.Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: '左膝角(°)', data: data.map(function (d) { return d.kneeL; }), borderColor: '#00c6ff', backgroundColor: 'rgba(0,198,255,0.08)', pointRadius: 0, borderWidth: 2, tension: 0.2, fill: false },
          { label: '右膝角(°)', data: data.map(function (d) { return d.kneeR; }), borderColor: '#ffb347', backgroundColor: 'rgba(255,179,71,0.08)', pointRadius: 0, borderWidth: 2, tension: 0.2, fill: false },
          { label: '重心高度(%)', data: data.map(function (d) { return d.comH; }), borderColor: '#3ddc84', backgroundColor: 'rgba(61,220,132,0.08)', pointRadius: 0, borderWidth: 2, tension: 0.2, fill: false, yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9aa3b2', usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { type: 'linear', title: { display: true, text: '时间 (s)', color: '#6b7484' }, ticks: { color: '#6b7484' } },
          y: { type: 'linear', position: 'left', title: { display: true, text: '膝角 (°)', color: '#00c6ff' }, ticks: { color: '#6b7484' }, min: 0, max: 180 },
          y1: { type: 'linear', position: 'right', title: { display: true, text: '重心高度 (%)', color: '#3ddc84' }, ticks: { color: '#6b7484' }, min: 0, max: 100, grid: { display: false } }
        }
      }
    });
    window.__poseChart = c;
    return c;
  }

  // ---------- AI 动作评估（预留后端接口；优先 Worker，其次 GLM-4.7-Flash） ----------
  function evaluate(opts) {
    var data = opts.data || [];
    if (!data.length) return Promise.resolve({ ok: false, msg: '暂无姿态数据，请先完成分析' });
    var url = (CONFIG.POSE_API_URL || '').trim();
    var glmReady = !!(window.GLM && window.GLM.isConfigured());
    if (!url && !glmReady) {
      return Promise.resolve({ ok: false, msg: 'AI评估接口未配置（js/supabase-config.js → POSE_API_URL 或 GLM_API_KEY）' });
    }

    // [计费] 消耗一次 AI 分析额度（免费每日2次 → 余额 → VIP 无限）
    var usedKind = '';
    var consume = (window.JTAuth && window.JTAuth.consumeAI)
      ? window.JTAuth.consumeAI('evaluation')
      : Promise.resolve({ ok: true, used_kind: 'free' });
    return consume.then(function (r) {
      if (!r.ok) {
        if (r.needLogin) location.href = 'login.html?next=' + location.pathname.split('/').pop();
        return { ok: false, msg: r.msg || '今日 AI 分析次数已用完', needUpgrade: true };
      }
      usedKind = r.used_kind || 'free';
      return runEvaluate(url, glmReady, opts, data);
    }).then(function (res) {
      // GLM 请求失败（网络/超时等）退回本次消耗
      if (!res.ok && usedKind) {
        window.JTAuth && window.JTAuth.refundAI(usedKind);
      }
      return res;
    });
  }

  function runEvaluate(url, glmReady, opts, data) {
    // 时序降采样 ≤ 500 点，控制上传体积
    var step = Math.max(1, Math.ceil(data.length / 500));
    var series = [];
    for (var i = 0; i < data.length; i += step) series.push(data[i]);
    if (series.length && series[series.length - 1] !== data[data.length - 1]) series.push(data[data.length - 1]);

    // 路径一：GLM 文本评估（姿态时序 + 统计，不传图片）
    if (!url && glmReady) {
      var st = computeStats(data);
      var lostPct = st.total ? Math.round(st.lost / st.total * 100) : 0;
      var dense = [];
      var s2 = Math.max(1, Math.ceil(data.length / 80));
      for (var j = 0; j < data.length; j += s2) dense.push(data[j]);
      if (dense.length && dense[dense.length - 1] !== data[data.length - 1]) dense.push(data[data.length - 1]);
      var prompt =
        '请根据一段运动动作的姿态时序数据，给出动作缺陷点评与训练建议。\n' +
        '动作类型：' + (opts.activity || 'generic') + '\n' +
        '统计：最深处膝角 ' + (st.minKnee === null ? '--' : st.minKnee + '°') +
        '，平均膝角 ' + (st.avgKnee === null ? '--' : st.avgKnee.toFixed(1) + '°') +
        '，重心最高 ' + (st.maxCom === null ? '--' : st.maxCom + '%') +
        '，有效帧 ' + st.valid + '/' + st.total + '，丢失率 ' + lostPct + '%\n' +
        '时序（t, 左膝角, 右膝角, 重心高度%, lost）：\n' +
        dense.map(function (d) {
          return d.t + ',' + (d.kneeL === null ? '-' : d.kneeL) + ',' + (d.kneeR === null ? '-' : d.kneeR) +
            ',' + (d.comH === null ? '-' : d.comH) + ',' + (d.lost ? 1 : 0);
        }).join('\n') +
        '\n请分两部分输出：1) 动作缺陷点评（膝关节角度变化、重心轨迹、丢失段可能问题）；2) 具体训练建议。';
      var sys = '你是运动科学专家，点评简洁专业、可执行。';
      if (opts.activity === 'approach-jump') {
        // 助跑起跳：注入内置技术要点知识
        sys += '\n【助跑起跳动作要点·内置知识】\n' + APPROACH_JUMP_KNOWLEDGE;
      }
      var chatOpts = { temperature: 0.4, stream: true };
      if (opts.onChunk) chatOpts.onChunk = opts.onChunk;
      return window.GLM.chat([
        { role: 'system', content: sys },
        { role: 'user', content: prompt }
      ], chatOpts).then(function (res) {
        if (!res.ok) return res;
        if (res.fallback && res.usedModel) {
          res.text = res.text + '\n\n（模型繁忙，已自动切换至 ' + res.usedModel + '）';
        }
        return res;
      });
    }

    // 路径二：Cloudflare Worker（POSE_API_URL）：上传关键帧图片 + 姿态时序 JSON
    // 找出最深处（膝角最小）与重心最高帧作为关键帧
    var deepest = -1, best = Infinity, highest = -1, hb = -1;
    for (var idx = 0; idx < data.length; idx++) {
      var dd = data[idx];
      var kk = Math.min(dd.kneeL === null ? 999 : dd.kneeL, dd.kneeR === null ? 999 : dd.kneeR);
      if (kk < best) { best = kk; deepest = idx; }
      if (dd.comH !== null && dd.comH > hb) { hb = dd.comH; highest = idx; }
    }
    var cs = opts.clipStart || 0;
    var keys = [
      { name: 'start', time: data[0] ? data[0].t + cs : 0 },
      { name: 'deepest', time: deepest >= 0 ? data[deepest].t + cs : 0 },
      { name: 'highest', time: highest >= 0 ? data[highest].t + cs : 0 }
    ];
    return Promise.all(keys.map(function (k) {
      return renderKeyframe(opts.video, k.time, 720).then(function (img) { k.image = img; return k; });
    })).then(function (keyframes) {
      var payload = {
        activity: opts.activity || 'generic',
        meta: {
          sampleEvery: opts.sampleEvery || 1,
          frames: data.length,
          lostFrames: data.filter(function (x) { return x.lost; }).length,
          clipStart: opts.clipStart || 0,
          clipEnd: opts.clipEnd || 0
        },
        keyframes: keyframes,
        series: series
      };
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(function (txt) {
        var res = null;
        try { res = JSON.parse(txt); } catch (e) { res = null; }
        var out = res ? (res.evaluation || res.text || res.result || JSON.stringify(res)) : txt;
        return { ok: true, text: out };
      });
    }).catch(function (e) {
      return { ok: false, msg: 'AI请求失败: ' + e.message };
    });
  }

  function isConfigured() {
    if (CONFIG.POSE_API_URL && CONFIG.POSE_API_URL.trim()) return true;
    return !!(window.GLM && window.GLM.isConfigured());
  }

  return {
    loadModel: loadModel,
    analyze: analyze,
    drawSkeleton: drawSkeleton,
    renderKeyframe: renderKeyframe,
    computeStats: computeStats,
    computeFrame: computeFrame,
    detectJump: detectJump,
    measureJumpByHip: measureJumpByHip,
    buildChart: buildChart,
    evaluate: evaluate,
    isConfigured: isConfigured,
    angleAt: angleAt,
    // 框选人物相关
    createBoxController: createBoxController,
    boxAtTime: boxAtTime,
    analysisDim: analysisDim
  };
})();
