/**
 * Jump Tools 统一认证模块
 * 纯前端演示实现（localStorage），后续可无缝替换为真实后端 API。
 * 密码仅做简单哈希后存储于浏览器本地，正式上线请务必接入服务端认证。
 */
(function () {
  'use strict';
  var USERS_KEY = 'jt_users';
  var SESSION_KEY = 'jt_session';
  var PLAN_KEY = 'jt_plan';

  // 简单演示哈希（djb2 变体），非加密用途
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return 'h' + (h >>> 0).toString(36);
  }

  var Auth = {
    users: function () {
      try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch (e) { return []; }
    },
    saveUsers: function (u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); },
    session: function () {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
    },
    saveSession: function (s) {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    },
    // 会员状态（暂不启用收费，全部 free，预留切换）
    getPlan: function () { return localStorage.getItem(PLAN_KEY) || 'free'; },
    setPlan: function (p) { localStorage.setItem(PLAN_KEY, p); },

    register: function (username, email, password) {
      username = (username || '').trim();
      email = (email || '').trim();
      if (username.length < 2) return { ok: false, msg: '用户名至少 2 个字符' };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, msg: '邮箱格式不正确' };
      if ((password || '').length < 6) return { ok: false, msg: '密码至少 6 位' };
      var users = this.users();
      if (users.some(function (u) { return u.username === username; })) return { ok: false, msg: '用户名已存在' };
      if (users.some(function (u) { return u.email === email; })) return { ok: false, msg: '邮箱已注册' };
      users.push({ username: username, email: email, password: hash(password), createdAt: Date.now(), plan: 'free' });
      this.saveUsers(users);
      this.saveSession({ username: username, email: email });
      return { ok: true, msg: '注册成功，已自动登录' };
    },

    login: function (account, password) {
      account = (account || '').trim();
      var users = this.users();
      var u = null;
      for (var i = 0; i < users.length; i++) {
        if (users[i].username === account || users[i].email === account) { u = users[i]; break; }
      }
      if (!u || u.password !== hash(password || '')) return { ok: false, msg: '账号或密码错误' };
      this.saveSession({ username: u.username, email: u.email });
      return { ok: true, msg: '登录成功' };
    },

    logout: function () { this.saveSession(null); },
    current: function () { return this.session(); },

    // 登录守卫：未登录跳转首页登录
    requireAuth: function () {
      if (this.session()) return true;
      location.href = 'index.html?login=1';
      return false;
    }
  };

  window.JTAuth = Auth;
})();
