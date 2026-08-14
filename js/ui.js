/**
 * Vertrise跃升 · 全局 UI 小工具
 * - 全站深浅色切换（localStorage 持久化）
 * - 移动端导航汉堡菜单开关（展开时暂停 Lenis 平滑滚动）
 * - 模块交错入场动画（IntersectionObserver，进视口才执行）
 * - 数字滚动动画（UX.animateNumber）
 * - 阶段二：GSAP 高级动画 + Lenis 平滑滚动（动态加载，仅桌面 + 非减弱动画）
 * - 导航栏滚动毛玻璃效果、折叠面板高度平滑展开（CSS grid 0fr→1fr）
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'vertrise-theme';
  var GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
  var LENIS_URL = 'https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js';

  function currentTheme() {
    return (document.documentElement.getAttribute('data-theme') || 'light');
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }

  function initTheme() {
    var toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var links = document.querySelector('.jt-nav-links');
    if (!toggle || !links) return;

    function setOpen(open) {
      links.classList.toggle('open', open);
      // 抽屉式菜单展开时暂停平滑滚动，收起恢复
      if (open) UX.lenisPause(); else UX.lenisResume();
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!links.classList.contains('open'));
    });

    // 分组下拉：点击触发展开/收起（桌面 hover 已展开，点击用于移动端与显式切换）
    var triggers = links.querySelectorAll('.jt-nav-trigger');
    for (var i = 0; i < triggers.length; i++) {
      triggers[i].addEventListener('click', function (e) {
        e.stopPropagation();
        var grp = this.parentElement;
        if (!grp) return;
        var open = grp.classList.toggle('open');
        if (open) {
          var sibs = links.querySelectorAll('.jt-nav-group.open');
          for (var j = 0; j < sibs.length; j++) {
            if (sibs[j] !== grp) sibs[j].classList.remove('open');
          }
        }
      });
    }

    // 点击菜单外部：收起菜单与所有分组
    document.addEventListener('click', function (e) {
      if (!links.contains(e.target) && !toggle.contains(e.target)) {
        setOpen(false);
        var opens = links.querySelectorAll('.jt-nav-group.open');
        for (var j = 0; j < opens.length; j++) opens[j].classList.remove('open');
      }
    });

    // 点击菜单项收起
    var items = links.querySelectorAll('a');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function () {
        setOpen(false);
        var opens = links.querySelectorAll('.jt-nav-group.open');
        for (var j = 0; j < opens.length; j++) opens[j].classList.remove('open');
      });
    }
  }

  // ---------- 系统减弱动画检测 ----------
  // 用户已明确要求“追求效果、不管约束”：此开关恒为 false，所有动效无条件启用
  function reducedMotion() { return false; }

  // 是否具备鼠标 hover 能力（部分浏览器/WebView 不支持 any-hover，默认视为可 hover）
  function canHover() {
    if (!window.matchMedia) return true;
    try { return window.matchMedia('(any-hover: hover)').matches; } catch (e) { return true; }
  }

  // ---------- 模块交错入场动画 ----------
  var MODULE_SEL = 'header, section, .jt-card, .jt-guide, .ld-tool-card, .ld-price-card, .pl-card, .pg-card, .pf-card, .ck-card, .record-card, .gap-card, .result, .auto-box, .card, .ps-card, .timeline, .frame-nav, .ctrl-row';

  function moduleIndex(parent, el) {
    var kids = parent.querySelectorAll(MODULE_SEL);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === el) return i;
    }
    return 0;
  }

  function initMotion() {
    if (reducedMotion() || !('IntersectionObserver' in window)) return;
    var els = document.querySelectorAll(MODULE_SEL);
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('ux-in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) {
      if (el.classList.contains('ux-enter')) return;
      if (el.offsetParent === null) return;
      var idx = el.parentElement ? moduleIndex(el.parentElement, el) : 0;
      el.style.setProperty('--ux-delay', (Math.min(idx, 4) * 100) + 'ms');
      el.classList.add('ux-enter');
      io.observe(el);
    });
  }

  // ---------- 数字滚动动画（easeOutCubic） ----------
  function animateNumber(el, to, opts) {
    opts = opts || {};
    if (!el) return;
    if (reducedMotion()) { el.textContent = to; return; }
    var from = (opts.from !== undefined) ? opts.from : (parseFloat(el.dataset.val) || 0);
    var dur = opts.duration || 700;
    var dec = (opts.decimals !== undefined) ? opts.decimals : ((Math.round(to) !== to) ? 1 : 0);
    var start = performance.now();
    el.dataset.val = to;
    function step(now) {
      var k = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * eased).toFixed(dec);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---------- 列表项入场（新增记录/刷新后平滑插入，CSS 实现，无闪烁） ----------
  function staggerIn(root, selector) {
    if (reducedMotion() || !root) return;
    var items = root.querySelectorAll(selector);
    [].forEach.call(items, function (el, i) {
      if (el.classList.contains('ux-enter')) return;
      el.classList.add('ux-enter');
      el.style.setProperty('--ux-delay', (Math.min(i, 6) * 60) + 'ms');
      requestAnimationFrame(function () { el.classList.add('ux-in'); });
    });
  }

  // ---------- 折叠面板：非 summary 内容包一层，配 CSS grid 0fr→1fr 平滑展开 ----------
  function initDetailsWrap() {
    [].forEach.call(document.querySelectorAll('details'), function (d) {
      var kids = [];
      for (var i = 0; i < d.children.length; i++) {
        if (d.children[i].tagName !== 'SUMMARY') kids.push(d.children[i]);
      }
      if (!kids.length) return;
      if (kids.length === 1 && kids[0].classList.contains('ux-dcontent')) return;
      var wrap = document.createElement('div');
      wrap.className = 'ux-dcontent';
      kids.forEach(function (k) { wrap.appendChild(k); });
      d.appendChild(wrap);
    });
  }

  // ---------- 导航栏滚动：向下滚动开启毛玻璃 + 阴影，回顶恢复透明 ----------
  function initNavScroll() {
    var nav = document.querySelector('.jt-nav');
    if (!nav) return;
    var onScroll = function () { nav.classList.toggle('ux-scrolled', (window.scrollY || 0) > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- GSAP / Lenis 动态加载（仅桌面 + 非减弱动画） ----------
  var lenis = null;
  var _gsap = window.gsap || null;   // index 等页面 head 已加载 GSAP 时立即可用，避免首屏闪烁
  var _queue = [];

  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = onload;
    document.head.appendChild(s);
  }

  function isTouch() {
    return ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  function flushQueue() {
    var q = _queue; _queue = [];
    q.forEach(function (fn) { try { fn(_gsap); } catch (e) {} });
  }

  function initLenis() {
    if (!window.Lenis) return;
    lenis = new window.Lenis({ duration: 1.1, smoothWheel: true });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
  }

  function initAdvanced() {
    if (reducedMotion()) return;          // 系统减弱动画：高级动效全部关闭
    if (!_gsap) loadScript(GSAP_URL, function () { _gsap = window.gsap || null; flushQueue(); });
    if (isTouch()) return;                // 手机端保持原生滚动（降级）
    if (window.Lenis) initLenis();
    else loadScript(LENIS_URL, initLenis);
  }

  // ---------- 空间感背景：注入漂浮光晕（固定定位 + transform 动画，合成器执行） ----------
  function injectBackground() {
    if (document.getElementById('ux-orb-wrap')) return;
    var wrap = document.createElement('div');
    wrap.id = 'ux-orb-wrap';
    wrap.innerHTML = '<div class="ux-orb ux-orb-1"></div><div class="ux-orb ux-orb-3"></div>';
    document.body.appendChild(wrap);
  }

  // ---------- 光晕漂浮 + 鼠标视差（JS 统一驱动 transform，替代 CSS 动画） ----------
  function initOrbMotion() {
    if (reducedMotion()) return;
    var orbs = document.querySelectorAll('.ux-orb');
    if (!orbs.length) return;
    var mx = 0, my = 0, t0 = performance.now();
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX / innerWidth - 0.5;
      my = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    (function raf(now) {
      var t = (now - t0) / 1000;
      [].forEach.call(orbs, function (orb, i) {
        var depth = (i + 1) * 18;
        var fx = Math.sin(t * 0.15 + i * 2.1) * 26;
        var fy = Math.cos(t * 0.12 + i * 1.7) * 20;
        orb.style.transform = 'translate3d(' + (fx - mx * depth).toFixed(1) + 'px,' + (fy - my * depth).toFixed(1) + 'px,0)';
      });
      requestAnimationFrame(raf);
    })(t0);
  }

  // ---------- 磁吸按钮（主 CTA 靠近鼠标轻微吸附） ----------
  function initMagnetic() {
    if (!canHover()) return;
    [].forEach.call(document.querySelectorAll('.ld-hero-cta .jt-btn, .jt-btn-lg'), function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var dx = (e.clientX - r.left - r.width / 2) * 0.22;
        var dy = (e.clientY - r.top - r.height / 2) * 0.22;
        btn.style.transition = 'transform .14s ease-out';
        btn.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.transition = '';
        btn.style.transform = '';
      });
    });
  }

  // ---------- 顶部滚动进度条 ----------
  function initProgress() {
    var bar = document.createElement('div');
    bar.className = 'ux-progress';
    document.body.appendChild(bar);
    var ticking = false;
    var update = function () {
      ticking = false;
      var max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, scrollY / max) : 0) + ')';
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }
  // ---------- 卡牌 3D 倾斜（hover 跟随鼠标；触屏跳过；扣篮差距模块除外） ----------
  var TILT_SEL = '.ld-tool-card, .ld-price-card, .pl-card, .pg-card, .pf-card, .ck-card, .record-card, .jt-card, .gap-card';
  function initTilt() {
    if (!canHover()) return;
    [].forEach.call(document.querySelectorAll(TILT_SEL), function (el) {
      if (el.classList.contains('ux-tilt')) return;
      el.classList.add('ux-tilt');
      var rafId = null, rx = 0, ry = 0;
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        rx = -py * 7;
        ry = px * 7;
        // 扫光跟随光标
        el.style.setProperty('--mx', ((px + 0.5) * 100) + '%');
        el.style.setProperty('--my', ((py + 0.5) * 100) + '%');
        if (el.style.transition !== 'transform .1s linear, box-shadow .3s ease, border-color .3s ease') {
          el.style.transition = 'transform .1s linear, box-shadow .3s ease, border-color .3s ease';
        }
        if (!rafId) {
          rafId = requestAnimationFrame(function () {
            rafId = null;
            el.style.transform = 'perspective(1000px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-3px)';
          });
        }
      });
      el.addEventListener('mouseleave', function () {
        el.style.transition = '';   // 恢复 CSS 弹簧过渡，平滑回弹
        el.style.transform = '';
      });
    });
  }

  // ---------- 按钮点击水波（轻微，从点击位置扩散）+ 全页面任意点击水波 ----------
  function initRipple() {
    // 按钮专属水波（被按钮形状裁剪）
    [].forEach.call(document.querySelectorAll('.jt-btn, .btn'), function (btn) {
      if (btn.dataset.uxRipple) return;
      btn.dataset.uxRipple = '1';
      btn.classList.add('ux-ripple-btn', 'ux-shine');
      btn.addEventListener('click', function (e) {
        var r = btn.getBoundingClientRect();
        var d = Math.max(r.width, r.height) * 1.5 + 20; // 按钮水波更大
        var span = document.createElement('span');
        span.className = 'ux-ripple';
        span.style.width = span.style.height = d + 'px';
        span.style.left = (e.clientX - r.left - d / 2) + 'px';
        span.style.top = (e.clientY - r.top - d / 2) + 'px';
        btn.appendChild(span);
        setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, 650);
      });
    });
    // 全页面任意位置点击都有水波（按钮除外，避免双水波）
    var layer = document.createElement('div');
    layer.className = 'ux-ripple-layer';
    document.body.appendChild(layer);
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.jt-btn, .btn')) return;
      var d = 190; // 页面任意点击：水波小一点
      var span = document.createElement('span');
      span.className = 'ux-ripple';
      span.style.width = span.style.height = d + 'px';
      span.style.left = (e.clientX - d / 2) + 'px';
      span.style.top = (e.clientY - d / 2) + 'px';
      layer.appendChild(span);
      setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, 650);
    });
    // 站内跳转按钮/导航：延迟 220ms 再跳转，让水波可见（点昼夜切换无跳转，水波直接可见）
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      if (!a.classList.contains('jt-btn') && !a.classList.contains('btn') && !a.classList.contains('jt-nav-link')) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('.html') < 0 || href.charAt(0) === '#') return;
      var url = a.href;
      if (!url || url.split('#')[0] === location.href.split('#')[0]) return;
      e.preventDefault();
      setTimeout(function () { location.href = url; }, 220);
    });
  }

  var UX = {
    /** GSAP 就绪后执行 fn(gsap)；减弱动画时直接跳过 */
    gsap: function (fn) {
      if (reducedMotion()) return;
      if (_gsap) { try { fn(_gsap); } catch (e) {} } else _queue.push(fn);
    },
    /** GSAP 是否立即可用（用于“数据操作不能依赖动画”的页面回退判断） */
    gsapReady: function () { return !!_gsap && !reducedMotion(); },
    reduced: reducedMotion,
    staggerIn: staggerIn,
    animateNumber: animateNumber,
    scan: initMotion,
    lenisPause: function () { if (lenis) lenis.stop(); },
    lenisResume: function () { if (lenis) lenis.start(); }
  };
  window.UX = UX;

  // 逐个初始化并隔离异常：单个效果失败不影响其它效果
  function boot() {
    var fns = [initTheme, initNav, injectBackground, initOrbMotion, initProgress,
               initMotion, initDetailsWrap, initNavScroll, initTilt, initRipple, initMagnetic, initAdvanced];
    fns.forEach(function (fn) { try { fn(); } catch (e) { console.error('[UX] init error:', e); } });
    console.log('[UX] 动效层已加载');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
