/**
 * Vertrise 跃升 · 本地数据层
 * 个人信息 / 评估结果 / 训练计划 / 每日训练记录，全部存本机（localStorage）。
 * 登录后可选同步到云端（由页面自行调用 JTAuth），这里只保证离线可用。
 */
window.JTStore = (function () {
  'use strict';
  var K = {
    profile: 'vt_profile_v2',
    assess: 'vt_assess_v1',
    plan: 'vt_plan_v1',
    daily: 'vt_daily_v1'
  };

  function read(k, def) {
    try {
      var s = localStorage.getItem(k);
      return s ? JSON.parse(s) : def;
    } catch (e) { return def; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  function getProfile() { return read(K.profile, null); }
  function saveProfile(p) {
    p = p || {};
    p.updatedAt = new Date().toISOString();
    write(K.profile, p);
    return p;
  }
  function hasProfile() {
    var p = getProfile();
    return !!(p && p.height && p.weight);
  }

  function getAssessment() { return read(K.assess, null); }
  function saveAssessment(a) {
    if (a) a.createdAt = new Date().toISOString();
    write(K.assess, a);
    return a;
  }

  function getPlan() { return read(K.plan, null); }
  function savePlan(p) {
    if (p) p.createdAt = new Date().toISOString();
    write(K.plan, p);
    return p;
  }
  function clearPlan() { write(K.plan, null); }

  function todayKey(d) {
    var t = d ? new Date(d) : new Date();
    var m = ('0' + (t.getMonth() + 1)).slice(-2);
    var day = ('0' + t.getDate()).slice(-2);
    return t.getFullYear() + '-' + m + '-' + day;
  }

  function getDaily(dateKey) {
    var all = read(K.daily, {});
    return all[dateKey || todayKey()] || null;
  }
  function saveDaily(rec, dateKey) {
    var all = read(K.daily, {});
    all[dateKey || todayKey()] = rec;
    write(K.daily, all);
    return rec;
  }
  function getHistory() {
    return read(K.daily, {});
  }

  function reset() {
    [K.profile, K.assess, K.plan, K.daily].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  return {
    keys: K,
    getProfile: getProfile, saveProfile: saveProfile, hasProfile: hasProfile,
    getAssessment: getAssessment, saveAssessment: saveAssessment,
    getPlan: getPlan, savePlan: savePlan, clearPlan: clearPlan,
    todayKey: todayKey, getDaily: getDaily, saveDaily: saveDaily, getHistory: getHistory,
    reset: reset
  };
})();
