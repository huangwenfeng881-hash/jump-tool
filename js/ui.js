/**
 * Vertrise跃升 · 全局 UI 小工具
 * - 全站深浅色切换（localStorage 持久化）
 * - 移动端导航汉堡菜单开关
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'vertrise-theme';

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

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      links.classList.toggle('open');
    });

    // 点击菜单外部收起
    document.addEventListener('click', function (e) {
      if (!links.contains(e.target) && !toggle.contains(e.target)) {
        links.classList.remove('open');
      }
    });

    // 点击菜单项收起
    var items = links.querySelectorAll('a');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function () {
        links.classList.remove('open');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initTheme();
      initNav();
    });
  } else {
    initTheme();
    initNav();
  }
})();
