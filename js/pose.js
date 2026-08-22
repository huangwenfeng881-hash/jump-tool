/**
 * [升级] Vertrise跃升 · 人体动作分析核心引擎（MediaPipe Tasks PoseLandmarker）
 * ------------------------------------------------------------
 * 职责：
 * - 本地姿态识别（MediaPipe Tasks PoseLandmarker，CPU delegate，纯前端，数据不出本机）
 * - 逐帧采样分析：抽帧缩小后送模型 → 计算膝角 / 髋角 / 重心高度 / 起跳角度等
 * - 骨架分层绘制（视频底图 + 骨骼层，青色风格与站点统一）
 * - 容错：单帧无检出/遮挡 → lost 帧断点；连续丢失超阈值自动停止
 * - AI 动作评估 / AI 弹跳分析：姿态时序 + 指标 → GLM
 *
 * 依赖：@mediapipe/tasks-vision（页面 head 用 <script type="module"> 引入
 *       vision_bundle.mjs 并挂到 window.__VT_VISION__，资源已本地化到 mediapipe/tasks-vision/）
 * 暴露：window.VTPose
 */
window.VTPose = (function () {
  'use strict';

  var CONFIG = window.JTConfig || {};
  var TASKS_BASE = (CONFIG.MEDIAPIPE_BASE || './mediapipe/') + 'tasks-vision/';
  // CDN 兜底（本机 file:// 或资源缺失时自动回退）
  var CDN_TASKS_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

  var poseLandmarker = null;
  var latestResults = null;
  var usedCdnFallback = false;
  var inferSeq = 0;   // detectForVideo 要求时间戳严格递增

  // 等待页面把 tasks-vision bundle 挂到 window.__VT_VISION__
  function visionReady(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (window.__VT_VISION__ && window.__VT_VISION__.PoseLandmarker) return resolve(window.__VT_VISION__);
      var t0 = Date.now();
      var timer = setInterval(function () {
        if (window.__VT_VISION__ && window.__VT_VISION__.PoseLandmarker) {
          clearInterval(timer); resolve(window.__VT_VISION__);
        } else if (Date.now() - t0 > (timeoutMs || 60000)) {
          clearInterval(timer);
          // file:// 下 ES module 的 import 会被浏览器 CORS 限制拦截，必须走 HTTP 访问
          var isFile = typeof location !== 'undefined' && location.protocol === 'file:';
          reject(new Error(isFile
            ? '无法在 file:// 下加载识别模型（浏览器禁止 file 页面的模块/资源请求）。请用本地服务器打开本站：双击项目根目录的「启动本站.bat」，再刷新本页重试。'
            : 'MediaPipe Tasks 未加载（请检查网络/CDN）'));
        }
      }, 150);
    });
  }

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

  // 创建 PoseLandmarker（CPU delegate：不依赖 WebGL/GPU，环境兼容性最好）
  function createLandmarker(vision, modelPath) {
    var opts = {
      baseOptions: {
        modelAssetPath: modelPath,
        delegate: 'CPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      // 放宽置信度阈值，提升画面中人物较小时的检出率
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
      // 关闭内置时序平滑：本引擎逐帧 seek 送帧，内置平滑会污染状态导致结果不稳定，
      // 改为在指标层做确定性后处理平滑（见 smoothSeries）
      smoothLandmarks: false
    };
    // forVisionTasks 是 async 函数（返回 Promise），必须等待其 resolve
    return vision.FilesetResolver.forVisionTasks(TASKS_BASE).then(function (fileset) {
      return vision.PoseLandmarker.createFromOptions(fileset, opts);
    });
  }

  function initPose(modelComplexity) {
    return visionReady().then(function (vision) {
      // 本地模型优先；失败（file:// 禁止 fetch 本地 .task 等）自动回退 CDN wasm + CDN 模型
      var local = TASKS_BASE + 'pose_landmarker_lite.task';
      return createLandmarker(vision, local).catch(function (err) {
        if (usedCdnFallback) throw err;
        usedCdnFallback = true;
        console.log('[Pose] 本地模型加载失败，已自动回退 CDN: ' + (err && err.message || err));
        var cdnOpts = {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
          smoothLandmarks: false
        };
        return vision.FilesetResolver.forVisionTasks(CDN_TASKS_BASE).then(function (fileset) {
          return vision.PoseLandmarker.createFromOptions(fileset, cdnOpts);
        });
      });
    }).then(function (lm) {
      poseLandmarker = lm;
      return lm;
    });
  }

  function loadModel(modelComplexity) {
    if (poseLandmarker) return Promise.resolve(poseLandmarker);
    // 60s 超时：模型加载（下载/编译 WASM）卡住时明确报错而非无限等待
    return withTimeout(initPose(modelComplexity), 60000, '模型加载超时，请检查网络后重试');
  }

  // 单帧推理：15s 超时。超时/异常不抛错，标记 timedOut 由调用方按丢失帧处理。
  // Tasks API 的 detectForVideo 同步返回 {landmarks: [[33 点]]}（与旧版 poseLandmarks 字段兼容）；
  // 这里同时兼容异步返回（个别构建/未来版本返回 Promise），统一收敛为 Promise。
  function sendFrame(frame) {
    if (!poseLandmarker) return Promise.resolve({ timedOut: true });
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { done = true; resolve({ timedOut: true }); }, 15000);
      var ts = ++inferSeq; // VIDEO 模式要求时间戳严格递增（与视频真实时间无关）
      function finish(res) {
        if (!done) { done = true; clearTimeout(timer); resolve({ timedOut: false, res: res }); }
      }
      function fail(e) {
        if (!done) { done = true; clearTimeout(timer); resolve({ timedOut: false, error: e }); }
      }
      try {
        var ret = poseLandmarker.detectForVideo(frame, ts);
        if (ret && typeof ret.then === 'function') ret.then(finish, fail);
        else finish(ret);
      } catch (e) { fail(e); }
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

  // nextFrame：帧真正显示后 resolve，并返回该帧的真实时间戳（mediaTime）。
  // 用途：抽帧时用它作为样本时间，使姿态与帧严格一致，抵消 VFR/seek 落点微差造成的
  // 同一视频两次分析结果不一致（离地/落地帧摆动、单/双脚翻转）。
  function nextFrame(video) {
    return new Promise(function (r) {
      if (typeof video.requestVideoFrameCallback === 'function') {
        var called = false;
        var t = setTimeout(function () { if (!called) { called = true; r(null); } }, 400);
        try {
          video.requestVideoFrameCallback(function (now, meta) {
            if (!called) { called = true; clearTimeout(t); r(meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : null); }
          });
        } catch (e) { if (!called) { called = true; clearTimeout(t); r(null); } }
      } else {
        requestAnimationFrame(function () { requestAnimationFrame(function () { r(video.currentTime || null); }); });
      }
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
  // 双侧同名关键点中点（任一不可见则返回 null）
  function midOf(a, b) {
    if (!a || !b || !visible(a) || !visible(b)) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function computeFrame(lm) {
    if (!lm || lm.length < 33) return null;
    var Lh = lm[23], Lk = lm[25], La = lm[27];
    var Rh = lm[24], Rk = lm[26], Ra = lm[28];
    var kneeL = (visible(Lh) && visible(Lk) && visible(La)) ? angleAt(Lh, Lk, La) : null;
    var kneeR = (visible(Rh) && visible(Rk) && visible(Ra)) ? angleAt(Rh, Rk, Ra) : null;
    // [新增] 髋角（肩-髋-膝，顶点为髋）：用于屈髋深度与曲线图
    var hipL = (visible(lm[11]) && visible(lm[23]) && visible(lm[25])) ? angleAt(lm[11], lm[23], lm[25]) : null;
    var hipR = (visible(lm[12]) && visible(lm[24]) && visible(lm[26])) ? angleAt(lm[12], lm[24], lm[26]) : null;
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
    // [新增] 左右脚各自的最低点（区分单脚/双脚起跳：27/29/31 左脚，28/30/32 右脚）
    var leftFeetY = null, rightFeetY = null;
    for (var j2 = 27; j2 <= 32; j2++) {
      if (!visible(lm[j2])) continue;
      var isLeft = (j2 === 27 || j2 === 29 || j2 === 31);
      if (isLeft) { if (leftFeetY === null || lm[j2].y > leftFeetY) leftFeetY = lm[j2].y; }
      else { if (rightFeetY === null || lm[j2].y > rightFeetY) rightFeetY = lm[j2].y; }
    }
    // [新增] 供 AI 弹跳分析使用的关键点（归一化坐标）：
    // 髋中点 / 踝中点 / 肩中点 / 腕中点，用于起跳角度、摆臂速度、落地稳定性等指标
    var hipM = midOf(lm[23], lm[24]);
    var ankM = midOf(lm[27], lm[28]);
    var shM = midOf(lm[11], lm[12]);
    var wrM = midOf(lm[15], lm[16]);
    var norm = function (v) { return v === null ? null : Math.round(v * 1000) / 1000; };
    return {
      kneeL: kneeL,
      kneeR: kneeR,
      hipL: hipL,
      hipR: hipR,
      comH: comY === null ? null : Math.round((1 - comY) * 1000) / 10,
      comX: comX === null ? null : Math.round(comX * 1000) / 10,
      feetY: feetY,
      leftFeetY: leftFeetY === null ? null : Math.round(leftFeetY * 1000) / 1000,
      rightFeetY: rightFeetY === null ? null : Math.round(rightFeetY * 1000) / 1000,
      hipX: hipM ? norm(hipM.x) : null,
      hipY: hipM ? norm(hipM.y) : null,
      ankleX: ankM ? norm(ankM.x) : null,
      ankleY: ankM ? norm(ankM.y) : null,
      shX: shM ? norm(shM.x) : null,
      shY: shM ? norm(shM.y) : null,
      wrX: wrM ? norm(wrM.x) : null,
      wrY: wrM ? norm(wrM.y) : null
    };
  }

  // [新增] 丢失帧回填：把上一帧的关键点几何字段复制进新条目（曲线保持连续）
  function geomOf(f) {
    return {
      hipX: f ? f.hipX : null, hipY: f ? f.hipY : null,
      ankleX: f ? f.ankleX : null, ankleY: f ? f.ankleY : null,
      shX: f ? f.shX : null, shY: f ? f.shY : null,
      wrX: f ? f.wrX : null, wrY: f ? f.wrY : null
    };
  }
  // [丢帧不伪装] 丢失帧的测量字段全部置 null（曲线由图表 spanGaps 断开），
  // 不再沿用上一帧数值冒充测量值；检测侧本就按 d.lost 忽略这些帧。
  function entryOf(t, prev, lost) {
    if (lost) {
      return {
        t: t,
        kneeL: null, kneeR: null, hipL: null, hipR: null,
        comH: null, comX: null,
        feetY: null, leftFeetY: null, rightFeetY: null,
        hipX: null, hipY: null, ankleX: null, ankleY: null,
        shX: null, shY: null, wrX: null, wrY: null,
        lost: true
      };
    }
    var g = geomOf(prev);
    return {
      t: t,
      kneeL: prev ? prev.kneeL : null,
      kneeR: prev ? prev.kneeR : null,
      hipL: prev ? prev.hipL : null,
      hipR: prev ? prev.hipR : null,
      comH: prev ? prev.comH : null,
      comX: prev ? prev.comX : null,
      feetY: prev ? prev.feetY : null,
      leftFeetY: prev ? prev.leftFeetY : null,
      rightFeetY: prev ? prev.rightFeetY : null,
      hipX: g.hipX, hipY: g.hipY,
      ankleX: g.ankleX, ankleY: g.ankleY,
      shX: g.shX, shY: g.shY,
      wrX: g.wrX, wrY: g.wrY,
      lost: false
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
          var actualTime = t;   // 实际抽到帧的真实时间（rVFC mediaTime），优先作样本时间戳
          if (t > ce + 1e-6) { resolve({ cancelled: false, data: data }); return; }
          seekTo(video, t)
            .then(function () { return nextFrame(video); })
            .then(function (mt) {
              if (mt !== null && mt !== undefined) actualTime = mt;
              if (cancelled) { resolve({ cancelled: true, data: data }); return; }
              // 有框选时按框裁剪放大人物（含外扩），否则整帧分析。
              // 过小的框（误点产生的 8px 小框）视为无效，回退整帧分析，避免裁剪到无人物区域导致全帧丢失
              var box = boxes ? boxAtTime(boxes, t) : null;
              if (box && (box.w < 40 || box.h < 40)) box = null;
              frame = box ? makeBoxFrame(video, box, analysisDim()) : makeFrameCanvas(video, analysisDim());
              if (!frame) {
                var curT0 = Math.max(0, Math.min(actualTime - cs, ce - cs));
                data.push(entryOf(Math.round(curT0 * 1000) / 1000, prev, true));
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
                var curT1 = Math.max(0, Math.min(actualTime - cs, ce - cs));
                curT1 = Math.round(curT1 * 1000) / 1000;
                timeoutLost++;
                lostStreak++;
                data.push(entryOf(curT1, prev, true));
                if (lostStreak >= maxLost) { resolve({ cancelled: false, data: data, aborted: true, abortedReason: 'timeout' }); return; }
                if (opts.onProgress) opts.onProgress(i, total, curT1, lostStreak);
                setTimeout(function () { step(i + 1); }, 0);
                return;
              }
              // 新版 Tasks API：detectForVideo 同步返回 { landmarks: [[33 点]] }
              var lm = null;
              if (r && r.res && r.res.landmarks && r.res.landmarks.length) lm = r.res.landmarks[0];
              // 框选裁剪时，把关键点从裁剪画布坐标映射回整帧视频坐标
              if (lm && frame && frame._crop) lm = mapBoxLandmarks(lm, frame._crop, video.videoWidth, video.videoHeight);
              var curT = Math.max(0, Math.min(actualTime - cs, ce - cs));
              curT = Math.round(curT * 1000) / 1000;
              var f = computeFrame(lm);
              if (f) {
                lostStreak = 0;
                prev = f;
                data.push(entryOf(curT, f, false));
                if (opts.onFrame) opts.onFrame({ t: curT, lm: lm, f: f });
              } else {
                lostStreak++;
                // 人物离开画面/遮挡：标记 lost 帧，沿用上一帧值保证曲线连续
                data.push(entryOf(curT, prev, true));
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
    }).catch(function (err) {
      // 模型加载失败等前置错误：收敛为可处理的 { error }，各页面统一走 res.error 分支
      return { cancelled: false, data: [], error: err };
    });
    return { promise: promise, cancel: function () { cancelled = true; } };
  }

  // ---------- 关键帧渲染（JPEG dataURL） ----------
  function renderKeyframe(video, t, maxDim) {
    return seekTo(video, t).then(function () { return nextFrame(video); }).then(function () {
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
  // 实测校准（test.mp4 30fps ground truth：倒数第二步 43-51 / 最后一步 47-51 / 腾空 52-80）：
  // 脚部关键点在快速起跳瞬间会滞后 4-5 帧（帧 52 已腾空但 feetY 仍显示在地面），
  // 而髋部(≈重心)上升起点与真实起跳帧对齐（帧 52），落地帧则与脚部速度骤降对齐（帧 81）。
  // 因此采用双信号：
  // ① 落地（主信号）：脚部持续下落段（连续 3 帧 ΔfeetY≥0.005）→ 下落速度骤降帧（≤0.35×段内中位速度）= 触地；
  // ② 起跳：落地前 1.2s~0.05s 窗口内的髋部最低点（下蹲蓄力）之后，髋部首次持续抬升（>min+1.5）的帧；
  // ③ 髋部单峰拱形校验：腾空段内髋部只能先升后降（过滤助跑抬髋+下蹲的假组合）；
  // ④ 髋部抬升幅度确认（跑动步/抖动不抬髋，真跳明显抬升）；
  // ⑤ 兜底：脚部信号全程不可用（丢失/遮挡）时用髋部峰值+基准穿越。
  // 返回 [{liftoffTime, landingTime, flightTime, heightCm, contactTime, rsi}]，按高度降序。
  function medianFilter(raw, n) {
    var s = new Array(n);
    for (var i = 0; i < n; i++) {
      var win = [];
      for (var k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) {
        if (raw[k] !== null) win.push(raw[k]);
      }
      if (win.length) { win.sort(function (a, b) { return a - b; }); s[i] = win[Math.floor(win.length / 2)]; }
      else s[i] = null;
    }
    return s;
  }
  function jumpHeightFromTime(ft) { return (9.81 * ft * ft / 8) * 100; }

  // 腾空段 [a,b] 内髋部峰值 相对 起跳前 0.3s 髋基准 的抬升（单位：comH 的百分比值）
  function hipRiseIn(sH, data, a, b) {
    var peak = null;
    for (var i = a; i <= b; i++) {
      if (sH[i] === null) continue;
      if (peak === null || sH[i] > peak) peak = sH[i];
    }
    if (peak === null) return null;
    var baseVals = [];
    var t0 = data[a].t - 0.3;
    for (var j = a - 1; j >= 0; j--) {
      if (data[j].t < t0) break;
      if (sH[j] !== null) baseVals.push(sH[j]);
    }
    if (!baseVals.length) return null;
    baseVals.sort(function (x, y) { return x - y; });
    return peak - baseVals[Math.floor(baseVals.length / 2)];
  }

  // 脚部关键点丢失时的兜底：髋部峰值 + 回到基准高度即视为落地
  function hipOnlyJumps(sH, data, riseTh, minAir, maxAir) {
    var n = sH.length;
    var vals = [];
    for (var i = 0; i < n; i++) if (sH[i] !== null) vals.push(sH[i]);
    if (vals.length < 5) return [];
    vals.sort(function (a, b) { return a - b; });
    var base = vals[Math.floor(vals.length * 0.5)]; // 全片髋高中位数 ≈ 站立/跑动水平
    var out = [];
    var i = 1;
    while (i < n - 1) {
      var v0 = sH[i - 1], v1 = sH[i], v2 = sH[i + 1];
      if (v0 === null || v1 === null || v2 === null) { i++; continue; }
      if (v1 >= v0 && v1 > v2 && (v1 - base) >= riseTh) {
        var lo = -1, la = -1;
        for (var k = i - 1; k >= 0; k--) {
          if (sH[k] === null) break;
          if (sH[k] <= base) { lo = k; break; }
        }
        for (var k2 = i + 1; k2 < n; k2++) {
          if (sH[k2] === null) break;
          if (sH[k2] <= base) { la = k2; break; }
        }
        if (lo >= 0 && la > lo) {
          var ft = data[la].t - data[lo].t;
          if (ft >= minAir && ft <= maxAir) {
            out.push({ a: lo, b: la, ft: ft, heightCm: jumpHeightFromTime(ft), source: 'hip' });
          }
        }
        i = la > 0 ? la : i + 1;
        continue;
      }
      i++;
    }
    return out;
  }

  function detectJump(data, opts) {
    opts = opts || {};
    var minAir = opts.minAirSec || 0.15;   // <0.15s 的“腾空”视为噪声
    var maxAir = opts.maxAirSec || 1.5;
    var n = data.length;
    if (n < 10) return [];

    // 原始信号（lost 帧记为 null）
    var rawF = data.map(function (d) { return (!d.lost && d.feetY !== null && d.feetY !== undefined) ? d.feetY : null; });
    var rawH = data.map(function (d) { return (!d.lost && d.comH !== null && d.comH !== undefined) ? d.comH : null; });
    // 5 帧中值滤波（对单帧尖峰稳健，远优于均值）
    var sF = medianFilter(rawF, n);
    var sH = medianFilter(rawH, n);

    // 人体尺度：髋到脚的中位距离（≈半身高），让阈值随拍摄远近自适应
    var hf = [];
    for (var i2 = 0; i2 < n; i2++) {
      if (sF[i2] !== null && sH[i2] !== null) {
        var dist = sF[i2] - (1 - sH[i2] / 100); // comH=(1-hipY)*100 → hipY=1-comH/100
        if (dist > 0.02 && dist < 0.8) hf.push(dist);
      }
    }
    var scale = 0.12;
    if (hf.length) { hf.sort(function (a, b) { return a - b; }); scale = hf[Math.floor(hf.length / 2)]; }
    scale = Math.max(0.04, Math.min(0.35, scale));
    var riseTh = Math.max(scale * 12, 3);

    // ---- ① 落地检测：脚部持续下落段 → 下落速度骤降帧（触地） ----
    // 下落段：连续 3 帧 ΔfeetY ≥ 0.005（原始信号；快速起跳瞬间脚部信号滞后，但下落段可靠）
    var descs = [];
    for (var i3 = 0; i3 < n - 3; i3++) {
      if (rawF[i3] === null || rawF[i3 + 1] === null || rawF[i3 + 2] === null || rawF[i3 + 3] === null) continue;
      var d1 = rawF[i3 + 1] - rawF[i3], d2 = rawF[i3 + 2] - rawF[i3 + 1], d3 = rawF[i3 + 3] - rawF[i3 + 2];
      if (d1 >= 0.005 && d2 >= 0.005 && d3 >= 0.005) descs.push(i3);
    }
    // 相邻下落段合并：跟踪每个段的下落跨度（起点 i3 覆盖到 i3+3），
    // 新起点落在上一段跨度+1 内即视为同一段（长下落段起点可跨多帧）
    var descSegs = [];
    descs.forEach(function (s0) {
      var last = descSegs[descSegs.length - 1];
      if (last && s0 <= last.end + 1) {
        descSegs[descSegs.length - 1] = { start: Math.min(last.start, s0), end: Math.max(last.end, s0 + 3) };
      } else {
        descSegs.push({ start: s0, end: s0 + 3 });
      }
    });

    var dbg = { flightSegs: descSegs.length, rejected: 0, descs: [] };
    var cands = [];
    descSegs.forEach(function (seg) {
      var s0 = seg.start;
      var dInfo = { s0: s0 };
      // 找触地：Δ ≤ 0.5×段内中位速度 或 Δ ≤ 0.006（触地减速起点）。
      // 相对/绝对双阈值 + 持续低速确认（随后 3 帧 < 0.7×中位）。
      // 历史：2 帧确认会把空中减速段误判为触地（提前 4~14 帧）；4 帧确认又让
      // 真实触地后的缓冲微动拖慢判定（实测晚 2 帧）——折中 3 帧。
      var deltas = [];
      var landing = -1;
      for (var j = s0; j < n - 1; j++) {
        if (rawF[j] === null || rawF[j + 1] === null) break;   // 丢失帧中断下落段
        var dv = rawF[j + 1] - rawF[j];
        if (deltas.length >= 3) {
          var sorted = deltas.slice().sort(function (a, b) { return a - b; });
          var med = sorted[Math.floor(sorted.length / 2)];
          if ((dv <= med * 0.7 || dv <= 0.008) && j + 4 < n && rawF[j + 2] !== null && rawF[j + 3] !== null && rawF[j + 4] !== null) {
            var d2 = rawF[j + 2] - rawF[j + 1];
            var d3 = rawF[j + 3] - rawF[j + 2];
            var d4 = rawF[j + 4] - rawF[j + 3];
            if (d2 < med * 0.7 && d3 < med * 0.7 && d4 < med * 0.7) {
              landing = (dv < 0.002) ? j + 1 : j;   // 骤停（Δ<0.002）触地在 j→j+1 之间
              dInfo.med = med; dInfo.triggerDv = dv;
              break;
            }
          }
        }
        if (dv >= 0.004) deltas.push(dv);
      }
      if (landing < 0 || landing >= n) {
        // 脚信号失效（落地后脚 landmark 仍大幅移动，如深蹲缓冲）：用髋部加速下降定位
        // 落地（深蹲缓冲起点，comH 每帧降 ≥2.5）
        for (var hc = s0 + 3; hc < n - 1; hc++) {
          if (rawH[hc] === null || rawH[hc + 1] === null || rawH[hc - 1] === null) continue;
          var dc1 = rawH[hc + 1] - rawH[hc];
          if (dc1 <= -2.5) { landing = hc; dInfo.hipFallback = true; break; }
        }
        if (landing < 0 || landing >= n) { dbg.rejected++; dInfo.rejected = 'no-landing'; dbg.descs.push(dInfo); return; }
      }
      dInfo.landing = landing;

      // ---- ② 起跳：落地前窗口内髋部最低点（下蹲蓄力）之后的持续抬升帧 ----
      var tLo = data[landing].t - 1.2, tHi = data[landing].t - 0.05;
      var m0 = -1, mVal = Infinity;
      for (var p = 0; p < n; p++) {
        if (data[p].t < tLo) continue;
        if (data[p].t > tHi) break;
        if (sH[p] !== null && sH[p] < mVal) { mVal = sH[p]; m0 = p; }
      }
      if (m0 < 0) { dbg.rejected++; dInfo.rejected = 'no-hip-min'; dbg.descs.push(dInfo); return; }
      var lo = -1;
      // 起跳检测：髋部从最低点抬升。阈值 1.5 → 1.0 → 0.8（实测单脚视频 48 帧起跳，
      // 1.0 阈值在 49 帧才触发，晚 1 帧）；确认帧阈值 0.6 → 0.5。
      for (var q = m0 + 1; q < n - 1; q++) {
        if (sH[q] === null) continue;
        if (sH[q] > mVal + 0.6 && sH[q + 1] !== null && sH[q + 1] >= mVal + 0.4) { lo = q; break; }
      }
      if (lo < 0 || lo >= landing) { dbg.rejected++; dInfo.rejected = 'no-liftoff'; dbg.descs.push(dInfo); return; }
      // 脚法精修起跳：实测校准（test video 10 组标注）——GT「离地时刻」= 脚信号开始
      // 持续下降的起点（连续 2 帧 Δ≤-0.003）。深蹲漂移在髋升前，窗口 [髋升, +8]；
      // 且脚法必须明显晚于髋升（分离 ≥4 帧）才采用——分离恰为 3 帧时脚信号
      // 只滞后 1-2 帧（倍帧/单脚渐变起跳），脚法反而不如髋法接近 GT（实测 52→54 变晚）。
      var fDrop = -1;
      for (var fd = lo; fd < Math.min(n - 1, lo + 8); fd++) {
        if (fd < 1 || sF[fd - 1] === null || sF[fd] === null || sF[fd + 1] === null) continue;
        if (sF[fd] - sF[fd - 1] <= -0.003 && sF[fd + 1] - sF[fd] <= -0.003) { fDrop = fd; break; }
      }
      if (fDrop >= lo + 4) lo = fDrop;

      var ft = data[landing].t - data[lo].t;
      if (ft < minAir || ft > maxAir) { dbg.rejected++; dInfo.rejected = 'ft=' + Math.round(ft * 1000) / 1000; dbg.descs.push(dInfo); return; }

      // ---- ③ 髋部单峰拱形校验：腾空段髋部只能先升后降 ----
      // 过滤「助跑抬髋（逐渐升高）+ 下蹲（髋下降）+ 再抬升」这类假组合：
      // 全局最高点之后找最深谷点，若谷后再抬升 ≥1.0，视为多峰 → 拒绝。
      var maxIdx = -1, maxVal = -Infinity;
      for (var r = lo; r <= landing; r++) {
        if (sH[r] !== null && sH[r] > maxVal) { maxVal = sH[r]; maxIdx = r; }
      }
      if (maxIdx < 0) { dbg.rejected++; dInfo.rejected = 'no-arch-max'; dbg.descs.push(dInfo); return; }
      // 落地帧髋部必须比腾空最高点低 ≥1.0：真跳物理上必然先升后降，
      // 过滤「助跑走近镜头（髋部持续升高）+ 假下落段」这类组合（最高点恰在落地帧）。
      if (sH[landing] === null || sH[landing] > maxVal - 1.0) { dbg.rejected++; dInfo.rejected = 'arch-flat'; dbg.descs.push(dInfo); return; }
      var valleyIdx = -1, valleyVal = Infinity;
      for (var u = maxIdx + 1; u <= landing; u++) {
        if (sH[u] !== null && sH[u] < valleyVal) { valleyVal = sH[u]; valleyIdx = u; }
      }
      if (valleyIdx >= 0 && valleyIdx > maxIdx) {
        var rebounded = false;
        // 检查到 landing+2：落地帧即谷底时，髋部回升可能发生在落地后 1-2 帧
        var wEnd2 = Math.min(n - 1, landing + 2);
        for (var w = valleyIdx + 1; w <= wEnd2; w++) {
          if (sH[w] !== null && sH[w] >= valleyVal + 1.0) { rebounded = true; break; }
        }
        if (rebounded) { dbg.rejected++; dInfo.rejected = 'arch-rebound'; dbg.descs.push(dInfo); return; }
      }

      // ---- ④ 髋部抬升确认：跑动步/抖动的髋几乎不上升，真跳才会明显抬升 ----
      var rise = hipRiseIn(sH, data, lo, landing);
      if (rise === null || rise < riseTh) { dbg.rejected++; dInfo.rejected = 'rise=' + (rise === null ? 'null' : Math.round(rise * 10) / 10); dbg.descs.push(dInfo); return; }

      cands.push({ a: lo, b: landing, ft: ft, heightCm: jumpHeightFromTime(ft), source: 'feet' });
      dbg.descs.push(dInfo);
    });

    // ---- ⑤ 兜底 A：无脚下落段（脚信号平缓/丢失，Δ 达不到 0.005）时用髋抛物线 ----
    // 髋部升→峰→降的完整抛物线即一次弹跳；落地 = 髋降结束（触地后髋停止快速下降）。
    if (!cands.length && !descSegs.length) {
      var upStart = -1;
      for (var u2 = 1; u2 < n - 5; u2++) {
        if (sH[u2 - 1] === null || sH[u2] === null || sH[u2 + 1] === null || sH[u2 + 2] === null || sH[u2 + 3] === null || sH[u2 + 4] === null) continue;
        if (sH[u2] - sH[u2 - 1] > 0.3 && sH[u2 + 1] - sH[u2] > 0.3 && sH[u2 + 2] - sH[u2 + 1] > 0.3 && sH[u2 + 3] - sH[u2 + 2] > 0.3 && sH[u2 + 4] - sH[u2 + 3] > 0.3) { upStart = u2; break; }
      }
      if (upStart >= 0) {
        var pk = upStart + 4, pkV = sH[pk];
        for (var p2 = upStart + 5; p2 < n; p2++) {
          if (sH[p2] === null) break;
          if (sH[p2] > pkV) { pkV = sH[p2]; pk = p2; }
          else if (sH[p2] < pkV - 0.5) break;
        }
        var dnStart = -1;
        for (var d2 = pk + 1; d2 < n - 4; d2++) {
          if (sH[d2] === null || sH[d2 + 1] === null || sH[d2 + 2] === null || sH[d2 + 3] === null) continue;
          if (sH[d2 + 1] - sH[d2] < -0.15 && sH[d2 + 2] - sH[d2 + 1] < -0.15 && sH[d2 + 3] - sH[d2 + 2] < -0.15) { dnStart = d2; break; }
        }
        if (dnStart >= 0) {
          var la2 = dnStart + 3;
          for (var d3 = dnStart + 4; d3 < n - 1; d3++) {
            if (sH[d3] === null || sH[d3 + 1] === null) break;
            var dcv = sH[d3 + 1] - sH[d3];
            if (dcv > -0.15) { la2 = d3; break; }   // 髋降结束（触地后髋不再快速下降）
          }
          var lo2 = upStart + 1;
          var ft2 = data[la2].t - data[lo2].t;
          if (ft2 >= minAir && ft2 <= maxAir) {
            var rise2 = pkV - (sH[upStart - 1] !== null ? sH[upStart - 1] : sH[upStart]);
            if (rise2 >= riseTh) {
              cands.push({ a: lo2, b: la2, ft: ft2, heightCm: jumpHeightFromTime(ft2), source: 'hip-arch' });
              dbg.hipArch = true;
            }
          }
        }
      }
    }

    // ---- ⑥ 兜底 B：脚部关键点丢失/信号不可用时，用髋部峰值定位弹跳 ----
    if (!cands.length) {
      // 兜底阈值更严（≈5%~18% 画面高度），避免跑动被误判为弹跳
      var hipJumps = hipOnlyJumps(sH, data, Math.max(scale * 18, 5), 0.2, 1.2);
      dbg.hipFallback = hipJumps.length;
      cands = cands.concat(hipJumps);
    }

    // 合并地面间隔极短（<0.06s，噪声断裂）的相邻段（要求不重叠、后段起点在前段落地之后）；
    // 完全相同的重复候选（同一下落段被拆出的重复飞行）直接丢弃。
    cands.sort(function (x, y) { return data[x.a].t - data[y.a].t; });
    var merged = [];
    cands.forEach(function (c) {
      var last = merged[merged.length - 1];
      if (last && data[c.a].t === data[last.a].t && data[c.b].t === data[last.b].t) {
        return;   // 重复候选
      }
      // 同一起跳的多个落地候选（缓降段与真腾空段都被检测到时）：取落地较晚者
      if (last && data[c.a].t === data[last.a].t) {
        if (data[c.b].t > data[last.b].t) {
          last.b = c.b;
          last.ft = Math.round((data[last.b].t - data[last.a].t) * 1000) / 1000;
          last.heightCm = jumpHeightFromTime(last.ft);
        }
        return;
      }
      // 起跳接近（<0.35s）且落地接近（<0.6s）的双候选 = 同一次跳跃的误拆段：
      // 空中缓降段常被误判为提前落地，真腾空段起跳/落地都更晚 → 合并取较晚组合
      if (last && Math.abs(data[c.a].t - data[last.a].t) < 0.35 && Math.abs(data[c.b].t - data[last.b].t) < 0.6) {
        if (data[c.a].t > data[last.a].t) last.a = c.a;
        if (data[c.b].t > data[last.b].t) last.b = c.b;
        last.ft = Math.round((data[last.b].t - data[last.a].t) * 1000) / 1000;
        last.heightCm = jumpHeightFromTime(last.ft);
        return;
      }
      if (last && data[c.a].t >= data[last.b].t && data[c.a].t - data[last.b].t < 0.06) {
        last.b = c.b;
        last.ft = Math.round((data[last.b].t - data[last.a].t) * 1000) / 1000;
        last.heightCm = jumpHeightFromTime(last.ft);
      } else {
        merged.push(c);
      }
    });
    cands = merged;

    var jumps = cands.map(function (c) {
      return {
        liftoffTime: Math.round(data[c.a].t * 1000) / 1000,
        landingTime: Math.round(data[c.b].t * 1000) / 1000,
        flightTime: Math.round(c.ft * 1000) / 1000,
        heightCm: Math.round(c.heightCm * 10) / 10,
        source: c.source || 'feet'
      };
    });

    // 触地时间（RSI）：相邻两次弹跳的 落地→下次离地
    for (var m2 = 1; m2 < jumps.length; m2++) {
      var contact = jumps[m2].liftoffTime - jumps[m2 - 1].landingTime;
      if (contact > 0 && contact < 2) {
        jumps[m2].contactTime = Math.round(contact * 1000) / 1000;
        jumps[m2].rsi = Math.round(((jumps[m2].heightCm / 100) / contact) * 100) / 100;
      }
    }
    jumps.sort(function (a, b) { return b.heightCm - a.heightCm; });
    // 诊断信息（供页面提示更具体的失败原因）
    if (opts.debugOut) {
      opts.debugOut.flightSegs = dbg.flightSegs;
      opts.debugOut.rejected = dbg.rejected;
      opts.debugOut.hipFallback = dbg.hipFallback || 0;
      opts.debugOut.descs = dbg.descs || [];
    }
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
          { label: '左膝角(°)', data: data.map(function (d) { return d.kneeL; }), borderColor: '#00c6ff', backgroundColor: 'rgba(0,198,255,0.08)', pointRadius: 0, borderWidth: 2, tension: 0.2, fill: false, spanGaps: true },
          { label: '右膝角(°)', data: data.map(function (d) { return d.kneeR; }), borderColor: '#ffb347', backgroundColor: 'rgba(255,179,71,0.08)', pointRadius: 0, borderWidth: 2, tension: 0.2, fill: false, spanGaps: true },
          { label: '重心高度(%)', data: data.map(function (d) { return d.comH; }), borderColor: '#3ddc84', backgroundColor: 'rgba(61,220,132,0.08)', pointRadius: 0, borderWidth: 2, tension: 0.2, fill: false, yAxisID: 'y1', spanGaps: true }
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

  // ============================================================
  // [新增] AI 弹跳分析：专项指标计算（起跳角度/屈膝深度/摆臂速度/
  //        最后两步节奏/落地稳定性）+ 类型判断与短板诊断的 AI 评估
  // ============================================================

  // 动态读取技术要点文本：发送给 AI 的提示词会随 jump knowledge.txt 内容实时变化。
  // 读取失败（如 file:// 直接打开）时回退到内置副本，并在返回里标记来源。
  function fetchKnowledge() {
    var FALLBACK =
      '双脚起跳：助跑阶段重心自然前倾，速度逐渐加快，倒数第二步全力蹬地，另一条腿前伸（尽量伸直）手臂同时后摆，同时已经屈髋（想象胸口压住膝盖）还可以防止膝盖前伸，最后一步前脚掌刺向地面（0.1到0.2秒内必须完成起跳）同时手臂前摆（最后一步刚触地，手臂已经在身体前面）\n' +
      '单脚起跳：起跳前要有足够的水平速度，起跳时，起跳腿要像一根钢筋一样（同时摆动腿和手臂快速上摆）0.15秒左右完成起跳';
    if (typeof fetch !== 'function') {
      return Promise.resolve({ text: FALLBACK, source: 'fallback', time: Date.now(), file: '' });
    }
    // 文件名含空格：显式编码；加时间戳绕过静态缓存，保证“改完文件立刻生效”
    var url = 'jump%20knowledge.txt?v=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var t = (txt || '').trim();
      if (t.length < 20) throw new Error('内容过短');
      return { text: t, source: 'file', time: Date.now(), file: 'jump knowledge.txt' };
    }).catch(function () {
      return { text: FALLBACK, source: 'fallback', time: Date.now(), file: '' };
    });
  }

  // 距时刻 t 最近的帧下标
  function idxNear(data, t) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < data.length; i++) {
      var d = Math.abs(data[i].t - t);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // 连线与垂直方向的夹角（dy 向下为正；0°=竖直）
  function angleFromVertical(dx, dy) {
    if (dx === null || dy === null || (dx === 0 && dy === 0)) return null;
    return Math.round(Math.atan2(Math.abs(dx), Math.abs(dy)) * 180 / Math.PI * 10) / 10;
  }

  // 最后一次弹跳前的最后两步节奏（倒数第二步/最后一步触地时间）
  // 实测校准（test.mp4，ground truth：倒数第二步触地=帧43、最后一步触地=帧47、起跳=帧52）：
  // - 局部地面基准：起跳前 0.6s 内脚部高分位（运动员已跑近镜头，全局地面基准会失真）；
  // - 触地段 = 脚部 ≥ 地面−0.02（2-of-3 容错），最后一段起点 = 最后一步触地 T_last；
  // - 若倒数第二段与最后一段之间有“真腾空”（脚部明显离地且持续 ≥2 帧）：
  //   常规助跑，T_pen = 倒数第二段起点，penContact = T_last − T_pen（两步间隔）；
  // - 否则（两次触地无间隔：双脚起跳的连续支撑，深蹲踮脚时脚部不会回到地面）：
  //   T_pen = 起跳前 0.95s~0.1s 内膝角最深处（下蹲蓄力帧），penContact = liftoff − T_pen。
  // 说明：平滑滤波会抹掉低采样率下跑动步的短促离地，这里全部用原始信号。
  function detectLastSteps(data, liftoffTime, dbg) {
    var n = data.length;
    if (n < 10) { if (dbg) dbg.fail = 'n<10'; return { found: 0 }; }
    var rawF = data.map(function (d) { return (!d.lost && d.feetY !== null) ? d.feetY : null; });
    var rawH = data.map(function (d) { return (!d.lost && d.comH !== null) ? d.comH : null; });
    // 人体尺度：髋→脚中位距离
    var hf = [];
    for (var i2 = 0; i2 < n; i2++) {
      if (rawF[i2] !== null && rawH[i2] !== null) {
        var dist = rawF[i2] - (1 - rawH[i2] / 100);
        if (dist > 0.02 && dist < 0.8) hf.push(dist);
      }
    }
    var scale = 0.12;
    if (hf.length) { hf.sort(function (a, b) { return a - b; }); scale = hf[Math.floor(hf.length / 2)]; }
    scale = Math.max(0.04, Math.min(0.35, scale));

    // 局部地面：起跳前 [0.35s, 0.02s) 内脚部 85 分位
    // （窗口不能太宽：更早的助跑帧人离镜头远、脚在画面更低位，会抬高地面基准）
    var win = [];
    for (var i = 0; i < n; i++) {
      if (rawF[i] === null) continue;
      if (data[i].t < liftoffTime - 0.35 || data[i].t >= liftoffTime - 0.02) continue;
      win.push(rawF[i]);
    }
    if (win.length < 4) { if (dbg) dbg.fail = 'win<4'; return { found: 0 }; }
    win.sort(function (a, b) { return a - b; });
    var ground = win[Math.floor(win.length * 0.85)];
    var th = ground - 0.02;

    // 触地段（2-of-3 容错，抗单帧抖动）
    var contact = new Array(n);
    for (var j = 0; j < n; j++) {
      if (rawF[j] === null) { contact[j] = false; continue; }
      var c = 0;
      if (j > 0 && rawF[j - 1] !== null && rawF[j - 1] >= th) c++;
      if (rawF[j] >= th) c++;
      if (j < n - 1 && rawF[j + 1] !== null && rawF[j + 1] >= th) c++;
      contact[j] = c >= 2;
    }
    var segs = [];
    var st = -1;
    for (var k = 0; k < n; k++) {
      if (contact[k] && st < 0) st = k;
      else if (!contact[k] && st >= 0) { segs.push([st, k - 1]); st = -1; }
    }
    if (st >= 0) segs.push([st, n - 1]);

    // 起跳前的最后一段（起点须在 liftoff−0.7s ~ liftoff−0.02s 内）
    var lastSeg = null;
    for (var s2 = segs.length - 1; s2 >= 0; s2--) {
      var seg = segs[s2];
      if (data[seg[0]].t >= liftoffTime - 0.7 && data[seg[0]].t < liftoffTime - 0.02) { lastSeg = seg; break; }
    }
    if (dbg) {
      dbg.ground = Math.round(ground * 1000) / 1000;
      dbg.th = Math.round(th * 1000) / 1000;
      dbg.segs = segs.map(function (s) { return [s[0], s[1]]; });
      dbg.lastSeg = lastSeg ? [lastSeg[0], lastSeg[1]] : null;
    }
    if (!lastSeg) { if (dbg) dbg.fail = 'no-lastSeg'; return { found: 0 }; }
    var T_last = data[lastSeg[0]].t;
    var lastContact = Math.round((liftoffTime - T_last) * 1000) / 1000;
    var out = { found: 0 };
    if (!(lastContact > 0.04 && lastContact < 0.9)) return out;

    // 倒数第二段与最后一段之间的“真腾空”？
    var penSeg = null;
    var idxLast = -1;
    for (var si = 0; si < segs.length; si++) if (segs[si] === lastSeg) { idxLast = si; break; }
    if (idxLast > 0) {
      var gapA = segs[idxLast - 1][1] + 1, gapB = lastSeg[0] - 1;
      var gapTh = ground - Math.max(scale * 0.4, 0.045);
      var deep = 0;
      for (var g = gapA; g <= gapB; g++) if (rawF[g] !== null && rawF[g] <= gapTh) deep++;
      if (deep >= 2) penSeg = segs[idxLast - 1];
    }

    if (penSeg) {
      // 常规助跑：两步之间有真腾空，倒数第二步 = 倒数第二段起点 → 最后一段起点
      var penContact = Math.round((T_last - data[penSeg[0]].t) * 1000) / 1000;
      if (penContact > 0.04 && penContact < 1.5) {
        out = {
          found: 2,
          lastContact: lastContact,
          penultimateContact: penContact,
          gap: Math.round((data[lastSeg[0]].t - data[penSeg[1]].t) * 1000) / 1000,
          ratio: Math.round((lastContact / penContact) * 100) / 100
        };
      } else {
        out = { found: 1, lastContact: lastContact };
      }
    } else {
      // 两次触地无间隔（双脚起跳连续支撑）：倒数第二步 = 起跳前膝角最深处（下蹲蓄力帧）
      var kneeMin = null, kneeIdx = -1;
      for (var km = 0; km < n; km++) {
        if (data[km].lost) continue;
        if (data[km].t < liftoffTime - 0.95 || data[km].t > liftoffTime - 0.1) continue;
        var kv = Math.min(data[km].kneeL === null ? 999 : data[km].kneeL, data[km].kneeR === null ? 999 : data[km].kneeR);
        if (kv < 999 && (kneeMin === null || kv < kneeMin)) { kneeMin = kv; kneeIdx = km; }
      }
      if (kneeIdx >= 0) {
        // 膝角最深处须比全片膝角中位明显更屈（≥30°），才算真正的下蹲蓄力
        var kneeAll = [];
        for (var ka = 0; ka < n; ka++) {
          if (data[ka].lost) continue;
          var kav = Math.min(data[ka].kneeL === null ? 999 : data[ka].kneeL, data[ka].kneeR === null ? 999 : data[ka].kneeR);
          if (kav < 999) kneeAll.push(kav);
        }
        kneeAll.sort(function (a, b) { return a - b; });
        var kneeMed = kneeAll.length ? kneeAll[Math.floor(kneeAll.length / 2)] : 170;
        if (kneeMed - kneeMin >= 30) {
          var penContact2 = Math.round((liftoffTime - data[kneeIdx].t) * 1000) / 1000;
          if (penContact2 > 0.04 && penContact2 < 1.2) {
            out = {
              found: 2,
              lastContact: lastContact,
              penultimateContact: penContact2,
              gap: null,   // 两次触地无间隔
              ratio: Math.round((lastContact / penContact2) * 100) / 100
            };
          } else {
            out = { found: 1, lastContact: lastContact };
          }
        } else {
          out = { found: 1, lastContact: lastContact };
        }
      } else {
        out = { found: 1, lastContact: lastContact };
      }
    }
    return out;
  }

  // 落地稳定性：落地膝角 / 髋部横向摆动 / 稳定用时
  function analyzeLanding(data, iLa, fps) {
    var out = {};
    var winEnd = Math.min(data.length - 1, iLa + Math.round(0.8 * fps));
    var kneeMin = null, hipXs = [];
    for (var i = iLa; i <= winEnd; i++) {
      var d = data[i];
      if (!d || d.lost) continue;
      if ((d.kneeL !== null || d.kneeR !== null) && i - iLa <= Math.round(0.35 * fps)) {
        var k = Math.min(d.kneeL === null ? 999 : d.kneeL, d.kneeR === null ? 999 : d.kneeR);
        if (k < 999 && (kneeMin === null || k < kneeMin)) kneeMin = k;
      }
      if (d.hipX !== null) hipXs.push({ t: d.t, x: d.hipX });
    }
    out.landingKnee = kneeMin;
    var leg = 0, legN = 0;
    for (var j = iLa; j <= winEnd; j++) {
      var e = data[j];
      if (e && !e.lost && e.hipY !== null && e.ankleY !== null && e.ankleY > e.hipY) {
        leg += e.ankleY - e.hipY; legN++;
      }
    }
    var legLen = legN ? leg / legN : 0.25;
    if (hipXs.length >= 3) {
      var xs = hipXs.map(function (h) { return h.x; });
      var range = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      out.swayPct = legLen > 0.001 ? Math.round((range / legLen) * 1000) / 10 : null;
      var med = xs.slice().sort(function (a, b) { return a - b; })[Math.floor(xs.length / 2)];
      var stableAt = null;
      for (var m = hipXs.length - 1; m >= 0; m--) {
        if (Math.abs(hipXs[m].x - med) > 0.02) { stableAt = hipXs[m].t; break; }
      }
      out.settleTime = stableAt === null ? 0 : Math.round((stableAt - data[iLa].t) * 1000) / 1000;
    }
    return out;
  }

  // 起跳方式：单脚 / 双脚（2D 关键点即可可靠判断）
  // 核心判据：起跳瞬间（含前 1~2 帧）两脚本最低点的高度差。
  //   - 单脚起跳：起跳腿蹬地时摆动腿抬在空中，两脚高度差大；
  //   - 双脚起跳：两脚本着地（含并步后同时发力），高度差小。
  // 注意不能用“窗口内两脚本着地帧数”当主判据——跑动中摆动腿经过支撑脚时
  // 两脚本会短暂同高，会误伤单脚起跳；故以“起跳瞬间高度差”优先。
  function detectTakeoffType(data, iLo, fps) {
    var unk = { type: 'unknown', gapMax: null, lastGap: null, bothGround: 0 };
    var w0 = Math.max(0, iLo - Math.round(0.2 * fps));
    // 用起跳附近帧估算人体尺度（髋→脚距离）
    var hf = [];
    for (var s = w0; s <= Math.min(data.length - 1, iLo + Math.round(0.3 * fps)); s++) {
      var e = data[s];
      if (e && !e.lost && e.feetY !== null && e.comH !== null) {
        var dist = e.feetY - (1 - e.comH / 100);
        if (dist > 0.02 && dist < 0.8) hf.push(dist);
      }
    }
    var scale = 0.12;
    if (hf.length) { hf.sort(function (a, b) { return a - b; }); scale = hf[Math.floor(hf.length / 2)]; }
    scale = Math.max(0.04, Math.min(0.35, scale));
    // 地面基准：窗口内两脚本低点的高分位
    var gs = [];
    for (var g = w0; g <= iLo; g++) {
      var dg = data[g];
      if (dg && !dg.lost && dg.feetY !== null) gs.push(dg.feetY);
    }
    if (gs.length < 3) return unk;
    gs.sort(function (a, b) { return a - b; });
    var ground = gs[Math.floor(gs.length * 0.9)];
    // 窗口统计
    var gaps = [], bothGround = 0;
    for (var i = w0; i <= iLo; i++) {
      var d = data[i];
      if (!d || d.lost) continue;
      if (d.leftFeetY !== null && d.rightFeetY !== null) {
        gaps.push({ t: d.t, gap: Math.abs(d.leftFeetY - d.rightFeetY) });
        if (d.leftFeetY >= ground - 0.04 && d.rightFeetY >= ground - 0.04) bothGround++;
      }
    }
    if (gaps.length < 2) return unk;
    var gap90 = gaps.map(function (x) { return x.gap; }).sort(function (a, b) { return a - b; });
    gap90 = gap90[Math.floor(gap90.length * 0.9)];
    // 起跳瞬间（最后 0.07s 内 + 起跳后 2 帧）两脚高度差的最大值。
    // 窗口必须含起跳后 1~2 帧：单脚起跳时摆动腿在离地瞬间才明显抬起，
    // 只看到起跳帧时两脚本可能还贴地（尤其 lo 提前 1 帧时），会把单脚误判成双脚。
    var lastWin = Math.max(w0, iLo - Math.round(0.07 * fps));
    var lastEnd = Math.min(data.length - 1, iLo + 2);
    var lastGapMax = 0;
    for (var i2 = lastWin; i2 <= lastEnd; i2++) {
      var e2 = data[i2];
      if (e2 && !e2.lost && e2.leftFeetY !== null && e2.rightFeetY !== null) {
        var gg = Math.abs(e2.leftFeetY - e2.rightFeetY);
        if (gg > lastGapMax) lastGapMax = gg;
      }
    }
    var singleTh = Math.max(scale * 0.28, 0.05);
    var type;
    if (lastGapMax > singleTh) type = 'single';        // 起跳瞬间一只脚本在空中 → 单脚
    else if (bothGround >= 2) type = 'double';         // 起跳前两脚本着地 → 双脚
    else if (gap90 > singleTh) type = 'single';        // 起跳帧数据缺失，窗口显示摆动腿明显抬起
    else type = 'double';                               // 两脚本贴近地面 → 双脚
    return { type: type, gapMax: Math.round(gap90 * 1000) / 1000, lastGap: Math.round(lastGapMax * 1000) / 1000, bothGround: bothGround };
  }

  // 对单次弹跳做六项指标分析
  function analyzeJump(data, jump, opts) {
    var fps = (opts && opts.fps) || 30;
    var out = { jump: jump };
    var lo = jump.liftoffTime;
    var iLo = idxNear(data, lo), iLa = idxNear(data, jump.landingTime);

    // ① 屈膝深度 + 屈髋深度：起跳前 0.7s 内最深处膝角 / 髋角
    var iStart = Math.max(0, iLo - Math.round(0.7 * fps));
    var deepest = null, hipDeepest = null;
    for (var i = iStart; i <= iLo; i++) {
      if (data[i] && !data[i].lost) {
        if (data[i].kneeL !== null && data[i].kneeR !== null) {
          var k = Math.min(data[i].kneeL, data[i].kneeR);
          if (!deepest || k < deepest.k) deepest = { k: k, i: i };
        }
        if (data[i].hipL !== null && data[i].hipR !== null) {
          var h = Math.min(data[i].hipL, data[i].hipR);
          if (!hipDeepest || h < hipDeepest.k) hipDeepest = { k: h, i: i };
        }
      }
    }
    out.kneeMin = deepest ? deepest.k : null;
    out.kneeMinTime = deepest ? Math.round((data[deepest.i].t - lo) * 1000) / 1000 : null;
    out.hipMin = hipDeepest ? hipDeepest.k : null;
    out.hipMinTime = hipDeepest ? Math.round((data[hipDeepest.i].t - lo) * 1000) / 1000 : null;

    // ② 起跳角度：起跳瞬间 髋→踝 连线与垂直夹角（身体前倾角）+ 腾空轨迹角
    var fl = data[iLo];
    if (fl && !fl.lost) {
      out.leanAngle = angleFromVertical(fl.ankleX - fl.hipX, fl.ankleY - fl.hipY);
      out.torsoLean = angleFromVertical(fl.shX - fl.hipX, fl.shY - fl.hipY);
    }
    var later = null;
    for (var j = Math.min(data.length - 1, iLo + 4); j > iLo; j--) {
      if (data[j] && !data[j].lost && data[j].hipX !== null && data[j].hipY !== null) { later = data[j]; break; }
    }
    if (fl && later && fl.hipX !== null && fl.hipY !== null && later.hipX !== null && later.hipY !== null) {
      var dx = later.hipX - fl.hipX, dy = -(later.hipY - fl.hipY); // 上为正
      out.trajAngle = (dx === null || dy === null) ? null : Math.round(Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI * 10) / 10;
    }

    // ③ 摆臂速度：起跳前 0.45s 内 肩→腕 向量相对竖直的角速度峰值（°/s）与摆幅
    // atan2 返回 ±180°，手臂越过竖直方向时角度会环绕跳变（+179°→−179°），
    // 先对序列做 unwrap（相邻差 >180° 时 ±360 修正），避免把环绕当成超大摆速/摆幅。
    var armWin = [];
    for (var a = Math.max(0, iLo - Math.round(0.45 * fps)); a <= iLo; a++) {
      var d = data[a];
      if (d && !d.lost && d.shX !== null && d.shY !== null && d.wrX !== null && d.wrY !== null) {
        var ang = Math.atan2(d.wrX - d.shX, -(d.wrY - d.shY)) * 180 / Math.PI;
        var prevAng = armWin.length ? armWin[armWin.length - 1].ang : null;
        if (prevAng !== null) {
          while (ang - prevAng > 180) ang -= 360;
          while (ang - prevAng < -180) ang += 360;
        }
        armWin.push({ i: a, ang: ang });
      }
    }
    var maxSwing = 0, amp = 0;
    if (armWin.length >= 2) {
      var angs = armWin.map(function (x) { return x.ang; });
      amp = Math.max.apply(null, angs) - Math.min.apply(null, angs);
      for (var m = 1; m < armWin.length; m++) {
        var dt = (data[armWin[m].i].t - data[armWin[m - 1].i].t) || (1 / fps);
        var v = Math.abs(armWin[m].ang - armWin[m - 1].ang) / dt;
        if (v > maxSwing) maxSwing = v;
      }
    }
    out.armSwingDegS = Math.round(maxSwing);
    out.armSwingAmp = Math.round(amp * 10) / 10;

    // ④ 最后两步节奏
    out.steps = detectLastSteps(data, lo);

    // ⑤ 落地稳定性
    out.landing = analyzeLanding(data, iLa, fps);

    // ⑥ 起跳方式：单脚 / 双脚
    out.takeoff = detectTakeoffType(data, iLo, fps);

    return out;
  }

  // 弹跳专项指标总入口：识别弹跳 → 对最高一跳逐项分析
  function computeJumpMetrics(data, opts) {
    var fps = (opts && opts.fps) || 30;
    var dbg = {};
    var jumps = detectJump(data, { fps: fps, debugOut: dbg });
    var st = computeStats(data);
    var lostPct = st.total ? Math.round(st.lost / st.total * 100) : 0;
    if (!jumps.length) {
      return {
        ok: false,
        msg: '未识别到弹跳',
        jumps: [],
        debug: {
          flightSegs: dbg.flightSegs || 0,
          rejected: dbg.rejected || 0,
          hipFallback: dbg.hipFallback || 0,
          lostPct: lostPct,
          total: st.total
        }
      };
    }
    // best 选择：腾空段脚部抬升最大者（起跳前 0.3s 脚中位 − 腾空最低脚）。
    // 过滤「助跑走近镜头」型假候选——其脚从未真正离地，但腾空时间虚长、高度虚高，
    // 若按 flightTime 排序会被误选为最佳弹跳。
    var bestIdx = 0, bestLift = -1;
    jumps.forEach(function (j, idx) {
      var iLo = idxNear(data, j.liftoffTime), iLa = idxNear(data, j.landingTime);
      var base = [];
      for (var b = Math.max(0, iLo - Math.round(0.3 * fps)); b < iLo; b++) {
        if (!data[b].lost && data[b].feetY !== null) base.push(data[b].feetY);
      }
      if (base.length < 2) return;
      base.sort(function (a, b2) { return a - b2; });
      var ground = base[Math.floor(base.length / 2)];
      var minF = Infinity;
      for (var m = iLo; m <= iLa && m < data.length; m++) {
        if (!data[m].lost && data[m].feetY !== null && data[m].feetY < minF) minF = data[m].feetY;
      }
      var lift = ground - minF;
      if (lift > bestLift) { bestLift = lift; bestIdx = idx; }
    });
    var best = analyzeJump(data, jumps[bestIdx], { fps: fps });
    var rsiMax = 0;
    jumps.forEach(function (j) { if (j.rsi && j.rsi > rsiMax) rsiMax = j.rsi; });
    best.jumpCount = jumps.length;
    best.rsiMax = rsiMax || null;
    best.contactTime = jumps[bestIdx].contactTime || null;
    best.usedHipFallback = !!(jumps[bestIdx].source === 'hip');
    best.bestLift = Math.round(bestLift * 1000) / 1000;
    return { ok: true, jumps: jumps, best: best, debug: { lostPct: lostPct, hipFallback: dbg.hipFallback || 0 } };
  }

  // 把指标整理成发给 AI 的中文数据摘要
  function buildMetricsText(data, metrics) {
    var st = computeStats(data);
    var lostPct = st.total ? Math.round(st.lost / st.total * 100) : 0;
    var m = metrics.best;
    var L = [];
    var tk = m.takeoff || {};
    L.push('起跳方式：' + (tk.type === 'single' ? '单脚起跳（起跳瞬间一只脚蹬地，摆动腿在空中）' : tk.type === 'double' ? '双脚起跳（起跳前两脚本着地同时发力）' : '数据不足'));
    L.push('弹跳高度：' + m.jump.heightCm + 'cm' + (m.jumpCount > 1 ? '，共识别 ' + m.jumpCount + ' 次弹跳' : ''));
    if (m.contactTime) L.push('触地时间：' + m.contactTime + 's（连续两次弹跳之间）');
    L.push('屈膝深度：起跳前最深处膝角 ' + (m.kneeMin === null ? '--' : m.kneeMin + '°') + (m.kneeMinTime !== null ? '（出现在起跳前 ' + Math.abs(m.kneeMinTime) + 's）' : ''));
    L.push('屈髋深度：起跳前髋角最深处 ' + (m.hipMin === null ? '--' : m.hipMin + '°') + (m.hipMinTime !== null ? '（出现在起跳前 ' + Math.abs(m.hipMinTime) + 's）' : ''));
    L.push('起跳角度：身体前倾 ' + (m.leanAngle === null ? '--' : m.leanAngle + '°') + '（竖直为0°）' + (m.trajAngle !== null ? '；腾空轨迹角 ' + m.trajAngle + '°（水平为0°）' : ''));
    L.push('摆臂速度：峰值角速度 ' + (m.armSwingDegS ? m.armSwingDegS + '°/s' : '--') + (m.armSwingAmp ? '，摆幅 ' + m.armSwingAmp + '°' : ''));
    var stp = m.steps || {};
    if (stp.found >= 2) {
      L.push('最后两步节奏：倒数第二步触地 ' + stp.penultimateContact + 's，最后一步触地 ' + stp.lastContact + 's，最后一步/倒数第二步 = ' + stp.ratio + (stp.gap !== null ? '，两步间腾空 ' + stp.gap + 's' : '') + (stp.approx ? '（估算值）' : ''));
    } else if (stp.found === 1) {
      L.push('最后两步节奏：仅识别到最后一步触地 ' + stp.lastContact + 's（可能是原地起跳、单脚起跳或助跑步数不足）');
    } else {
      L.push('最后两步节奏：未能从脚部轨迹识别出助跑步');
    }
    var ld = m.landing || {};
    L.push('落地稳定性：落地膝角 ' + (ld.landingKnee === null ? '--' : ld.landingKnee + '°') + '，落地后髋部横向摆动 ' + (ld.swayPct === null ? '--' : ld.swayPct + '%腿长') + '，稳定用时 ' + (ld.settleTime === null ? '--' : ld.settleTime + 's'));
    L.push('识别质量：有效帧 ' + st.valid + '/' + st.total + '，丢失率 ' + lostPct + '%');
    return L.join('\n');
  }

  // AI 弹跳分析评估（GLM 文本流式；消耗 AI 额度，失败自动退回）
  // opts: { data, fps, metrics?, knowledge?, onChunk? }
  function evaluateJump(opts) {
    var data = opts.data || [];
    if (!data.length) return Promise.resolve({ ok: false, msg: '暂无姿态数据，请先完成分析' });
    if (!window.GLM || !window.GLM.isConfigured()) {
      return Promise.resolve({ ok: false, msg: 'AI接口未配置（js/supabase-config.js → GLM_API_KEY）' });
    }
    var consume = (window.JTAuth && window.JTAuth.consumeAI)
      ? window.JTAuth.consumeAI('evaluation')
      : Promise.resolve({ ok: true, used_kind: 'free' });
    var usedKind = '';
    return consume.then(function (r) {
      if (!r.ok) {
        if (r.needLogin) location.href = 'login.html?next=' + location.pathname.split('/').pop();
        return { ok: false, msg: r.msg || '今日 AI 分析次数已用完', needUpgrade: true };
      }
      usedKind = r.used_kind || 'free';
      var metrics = opts.metrics || computeJumpMetrics(data, { fps: opts.fps });
      if (!metrics.ok) return { ok: false, msg: metrics.msg || '未能计算出弹跳指标' };
      var knowledge = (opts.knowledge && opts.knowledge.text) ? opts.knowledge.text : APPROACH_JUMP_KNOWLEDGE;
      var sys = '你是 Vertrise跃升 的 AI 弹跳分析专家（资深弹跳/力量/体能教练）。你根据一段助跑起跳视频的姿态识别数据，给出专业、简洁、可执行的中文分析报告。\n' +
        '【弹跳技术要点（评估标准以此为准）】\n' + knowledge + '\n\n' +
        '规则：\n' +
        '1. 严格按【】分节输出，六项指标逐项给评分（满分10分）与一句点评；\n' +
        '2. 判断我的弹跳类型（力量型/速度型/弹性型）时，结合屈膝深度、屈髋深度、触地时间、摆臂速度、腾空时间等数据说明依据，不要凭空猜测；\n' +
        '3. 数据缺失的项目明确说明“数据不足”，不要编造；\n' +
        '4. 训练建议要具体（动作名称、组数×次数、要点），注意安全。';
      var user = '我的弹跳姿态数据如下（由 AI 自动识别）：\n' + buildMetricsText(data, metrics) +
        '\n\n请按以下格式输出报告（不要省略任何一节）：\n' +
        '【逐项分析】\n起跳角度：分数/10 一句点评\n屈膝深度：分数/10 一句点评\n摆臂速度：分数/10 一句点评\n最后两步节奏：分数/10 一句点评\n落地稳定性：分数/10 一句点评\n' +
        '【弹跳类型】力量型/速度型/弹性型 + 判断依据\n' +
        '【弹跳短板】按优先级列出 1-3 个最需要改进的短板，每条说明原因\n' +
        '【训练建议】针对短板的具体训练动作与要点';
      var chatOpts = { temperature: 0.4, stream: true, max_tokens: 1600 };
      if (opts.onChunk) chatOpts.onChunk = opts.onChunk;
      return window.GLM.chat([
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ], chatOpts).then(function (res) {
        if (!res.ok) return res;
        if (res.fallback && res.usedModel) {
          res.text = res.text + '\n\n（模型繁忙，已自动切换至 ' + res.usedModel + '）';
        }
        return res;
      });
    }).then(function (res) {
      if (!res.ok && usedKind) {
        window.JTAuth && window.JTAuth.refundAI(usedKind);
      }
      return res;
    });
  }

  // ---------- 膝盖角度 + 髋角曲线（围绕起跳瞬间） ----------
  // 供 AI 弹跳分析页展示：默认绘制 起跳前 1.2s → 起跳后 0.6s 的 左/右膝角、左/右髋角
  function buildJumpChart(chartCanvas, data, jump, opts) {
    if (window.__jumpChart) { window.__jumpChart.destroy(); window.__jumpChart = null; }
    if (!window.Chart) return null;
    opts = opts || {};
    var lo = jump.liftoffTime;
    var before = opts.beforeSec || 1.2;
    var after = opts.afterSec || 0.6;
    var pts = data.filter(function (d) { return d.t >= lo - before && d.t <= lo + after && !d.lost; });
    var labels = pts.map(function (d) { return d.t.toFixed(2); });
    var mk = function (label, color, get) {
      return { label: label, data: pts.map(get), borderColor: color, pointRadius: 0, borderWidth: 2, tension: 0.25, spanGaps: true };
    };
    var c = new window.Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          mk('左膝角°', '#00c6ff', function (d) { return d.kneeL; }),
          mk('右膝角°', '#ffb347', function (d) { return d.kneeR; }),
          mk('左髋角°', '#3ddc84', function (d) { return d.hipL; }),
          mk('右髋角°', '#c58cff', function (d) { return d.hipR; })
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9aa3b2', usePointStyle: true, boxWidth: 8 } } },
        scales: {
          x: { title: { display: true, text: '时间 (s)', color: '#6b7484' }, ticks: { color: '#6b7484' } },
          y: { type: 'linear', min: 0, max: 180, title: { display: true, text: '角度 (°)', color: '#6b7484' }, ticks: { color: '#6b7484' } }
        }
      }
    });
    window.__jumpChart = c;
    return c;
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
    // [新增] AI 弹跳分析：指标计算 + 动态知识库 + 评估
    computeJumpMetrics: computeJumpMetrics,
    detectLastSteps: detectLastSteps,
    analyzeJump: analyzeJump,
    buildMetricsText: buildMetricsText,
    buildJumpChart: buildJumpChart,
    evaluateJump: evaluateJump,
    fetchKnowledge: fetchKnowledge,
    isConfigured: isConfigured,
    angleAt: angleAt,
    // 框选人物相关
    createBoxController: createBoxController,
    boxAtTime: boxAtTime,
    analysisDim: analysisDim
  };
})();
