/**
 * Jump Tools 统一认证模块（Supabase 版）
 * ------------------------------------------------------------
 * 替换原 localStorage 假认证，基于 @supabase/supabase-js。
 * - 账号注册 / 邮箱登录 / 忘记密码（邮箱重置基础框架）
 * - 登录状态保持：刷新页面自动恢复会话（supabase-js localStorage 持久化 + 自动刷新 token）
 * - 训练数据（弹跳记录 / 杠铃速度曲线）与用户 ID 绑定写入 Supabase，
 *   由 RLS 行级权限保证用户只能读写自己的数据（建表 SQL 见 supabase-config.js）
 *
 * 依赖加载顺序（各页面统一）：
 *   1) supabase UMD CDN（暴露全局 supabase）
 *   2) js/supabase-config.js（window.JTConfig）
 *   3) js/auth.js（本文件，暴露 window.JTAuth）
 */
(function () {
  'use strict';

  var CONFIG = window.JTConfig || {};
  // Cloudflare Workers 代理预留：若配置了 PROXY_URL，则优先使用代理地址，
  // 由 Worker 转发到真实 Supabase，解决国内网络访问不稳定 / 跨域问题。
  var BASE_URL = CONFIG.PROXY_URL || CONFIG.SUPABASE_URL || '';
  var ANON_KEY = CONFIG.SUPABASE_ANON_KEY || '';

  var client = null;
  var _session = null;
  var _listeners = [];

  function isConfigured() {
    return !!(BASE_URL && ANON_KEY);
  }

  function getClient() {
    if (client) return client;
    if (!isConfigured()) return null;
    if (!window.supabase) return null;
    client = window.supabase.createClient(BASE_URL, ANON_KEY, {
      auth: {
        persistSession: true, // localStorage 持久化，刷新页面自动维持登录状态
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  function notify(session) {
    _session = session || null;
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](_session); } catch (e) {}
    }
  }

  function friendlyAuthError(err) {
    if (!err || !err.message) return '操作失败，请重试';
    var m = err.message.toLowerCase();
    if (m.indexOf('already registered') >= 0) return '该邮箱已注册，请直接登录';
    if (m.indexOf('invalid login credentials') >= 0) return '邮箱或密码错误';
    if (m.indexOf('email not confirmed') >= 0) return '邮箱尚未验证，请先查收确认邮件';
    if (m.indexOf('rate limit') >= 0) return '操作过于频繁，请稍后再试';
    if (m.indexOf('failed to fetch') >= 0 || m.indexOf('network') >= 0) return '网络异常，无法连接服务器';
    return err.message;
  }

  var Auth = {
    configured: isConfigured,

    /** 初始化：恢复登录状态 + 注册监听。cb(session) 在会话变化时回调。 */
    init: function (cb) {
      if (typeof cb === 'function') _listeners.push(cb);
      var c = getClient();
      if (!c) { notify(null); return; }
      // 刷新页面 / 首次加载：从本地恢复会话
      c.auth.getSession().then(function (res) {
        var s = res && res.data ? res.data.session : null;
        notify(s);
        // 会话恢复后补一次推广码兑换（覆盖“邮箱确认链接直接登录”的情况）
        if (s) Auth.redeemPendingInvite();
      }).catch(function () { notify(null); });
      // 登录 / 退出 / token 刷新时自动通知各页刷新导航
      c.auth.onAuthStateChange(function (event, session) {
        notify(session);
      });
    },

    /** 订阅登录状态变化。cb(event, session)，返回取消订阅函数。 */
    onAuthStateChange: function (cb) {
      var c = getClient();
      if (!c) return function () {};
      var sub = c.auth.onAuthStateChange(function (event, session) {
        cb(event, session);
      });
      return function () {
        if (sub && sub.data && sub.data.subscription) sub.data.subscription.unsubscribe();
      };
    },

    /** 获取当前会话（异步，刷新页面后可自动恢复） */
    getSession: function () {
      var c = getClient();
      if (!c) return Promise.resolve(null);
      return c.auth.getSession().then(function (res) {
        _session = res && res.data ? res.data.session : null;
        return _session;
      });
    },

    /** 同步返回最近一次已知会话（可能为 null） */
    current: function () { return _session; },

    /** 会员等级：读取用户 metadata 中 plan（默认 free；pro 走 LLM 训练师） */
    getPlan: function () {
      if (!_session || !_session.user || !_session.user.user_metadata) return 'free';
      return _session.user.user_metadata.plan || 'free';
    },

    /** 返回当前登录用户；未登录返回 null（不抛错） */
    getCurrentUser: async function () {
      var c = getClient();
      if (!c) return null;
      try {
        var res = await c.auth.getUser();
        if (res.error || !res.data || !res.data.user) return null;
        return res.data.user;
      } catch (e) { return null; }
    },

    /** 返回当前登录会话的 access_token；未登录返回空字符串 */
    getToken: async function () {
      var c = getClient();
      if (!c) return '';
      try {
        var res = await c.auth.getSession();
        return (res && res.data && res.data.session) ? res.data.session.access_token : '';
      } catch (e) { return ''; }
    },

    // ---------- 认证 ----------

    /** 邮箱+密码注册；基础表单校验（邮箱格式、密码长度）。inviteCode 为推广人提供的邀请码（选填）。 */
    signUp: function (email, password, inviteCode) {
      email = (email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve({ ok: false, msg: '邮箱格式不正确' });
      if ((password || '').length < 6) return Promise.resolve({ ok: false, msg: '密码至少 6 位' });
      var c = getClient();
      if (!c) return Promise.resolve({ ok: false, msg: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' });
      inviteCode = (inviteCode || '').trim().toUpperCase();
      var opts = {};
      if (inviteCode) opts.data = { invite_code: inviteCode }; // 永久记录在用户 metadata，站长可查
      return c.auth.signUp({ email: email, password: password, options: opts }).then(function (res) {
        if (res.error) return { ok: false, msg: friendlyAuthError(res.error) };
        // 开启了邮箱确认时 session 为 null，提示去邮箱确认
        if (!res.data || !res.data.session) {
          if (inviteCode) {
            // 首次登录时自动兑换（绑定推广关系 + VIP 奖励）
            try { localStorage.setItem('vt_pending_invite', inviteCode); } catch (e) {}
            return { ok: true, needConfirm: true, msg: '注册成功，请前往邮箱完成确认后登录；登录后将自动兑换推广邀请码' };
          }
          return { ok: true, needConfirm: true, msg: '注册成功，请前往邮箱完成确认后登录' };
        }
        if (!inviteCode) return { ok: true, msg: '注册成功，已自动登录' };
        // 已自动登录：立即兑换邀请码（记录推广来源 + VIP 奖励）
        return Auth.redeemInvite(inviteCode).then(function (r) {
          if (r.ok) return { ok: true, msg: '注册成功，已自动登录；' + r.msg };
          return { ok: true, msg: '注册成功，已自动登录；推广码暂未生效（' + r.msg + '，可到「会员」页重试）' };
        });
      });
    },

    /** 邮箱密码登录 */
    signIn: function (email, password) {
      email = (email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve({ ok: false, msg: '邮箱格式不正确' });
      if (!password) return Promise.resolve({ ok: false, msg: '请输入密码' });
      var c = getClient();
      if (!c) return Promise.resolve({ ok: false, msg: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' });
      return c.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        if (res.error) return { ok: false, msg: friendlyAuthError(res.error) };
        notify(res.data.session);
        // 注册时填过推广码但需邮箱确认的：首次登录自动兑换（绑定推广关系）
        Auth.redeemPendingInvite();
        return { ok: true, msg: '登录成功' };
      });
    },

    /** 退出登录 */
    signOut: function () {
      var c = getClient();
      if (!c) return Promise.resolve();
      return c.auth.signOut().catch(function () {});
    },
    logout: function () { return Auth.signOut(); },

    /** 忘记密码：发送邮箱重置邮件（基础框架） */
    resetPassword: function (email) {
      email = (email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.resolve({ ok: false, msg: '邮箱格式不正确' });
      var c = getClient();
      if (!c) return Promise.resolve({ ok: false, msg: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' });
      var opts = {};
      // 优先使用配置的跳转地址；否则自动取当前页面地址。
      // 注意：file:// 打开时浏览器禁止跳回本地文件，请用本地服务器(Live Server)或线上域名测试。
      var redirect = CONFIG.AUTH_REDIRECT ||
        (location.protocol !== 'file:' && location.origin ? location.origin + location.pathname : '');
      if (redirect) opts.redirectTo = redirect;
      return c.auth.resetPasswordForEmail(email, opts).then(function (res) {
        if (res.error) return { ok: false, msg: friendlyAuthError(res.error) };
        return { ok: true, msg: '重置邮件已发送，请查收邮箱并按提示设置新密码' };
      });
    },

    /** 设置新密码（需处于恢复会话中，即从重置邮件链接跳转而来） */
    updatePassword: function (password) {
      if ((password || '').length < 6) return Promise.resolve({ ok: false, msg: '密码至少 6 位' });
      var c = getClient();
      if (!c) return Promise.resolve({ ok: false, msg: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' });
      return c.auth.updateUser({ password: password }).then(function (res) {
        if (res.error) return { ok: false, msg: friendlyAuthError(res.error) };
        return { ok: true, msg: '密码已重置，请使用新密码登录' };
      });
    },

    // ---------- 训练数据（绑定用户 ID，RLS 保证只读写本人数据） ----------

    /** 保存一条弹跳记录（高度 cm / 腾空时间 s / 测试类型 / 箱高 cm） */
    saveJumpRecord: function (data) {
      return Auth._insert('jump_records', {
        height_cm: data.height_cm,
        flight_time: data.flight_time,
        test_type: data.test_type || '助跑起跳',
        box_height: data.box_height || null
      });
    },

    /** 保存一条杠铃速度记录（统计指标 + 完整速度曲线 jsonb + 重量 kg） */
    saveBarbellRecord: function (data) {
      return Auth._insert('barbell_records', {
        peak_speed: data.peak_speed,
        avg_concentric: data.avg_concentric,
        avg_eccentric: data.avg_eccentric,
        concentric_time: data.concentric_time,
        eccentric_time: data.eccentric_time,
        total_displacement: data.total_displacement,
        weight: data.weight || null,
        curve_data: data.curve_data || []
      });
    },

    _insert: async function (table, row) {
      var c = getClient();
      if (!c) return { error: { message: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' } };
      var user = await Auth.getCurrentUser();
      if (!user) return { error: { message: '未登录，请先登录' } };
      row.user_id = user.id; // 与 RLS 策略 auth.uid() = user_id 对应
      var res = await c.from(table).insert(row).select().single();
      return res;
    },

    /** 读取本人全部训练记录 */
    fetchRecords: async function () {
      var c = getClient();
      if (!c) return { jumps: [], barbells: [], error: { message: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' } };
      var user = await Auth.getCurrentUser();
      if (!user) return { jumps: [], barbells: [], error: { message: '未登录，请先登录' } };
      try {
        var results = await Promise.all([
          c.from('jump_records').select('*').order('created_at', { ascending: false }),
          c.from('barbell_records').select('*').order('created_at', { ascending: false })
        ]);
        return { jumps: results[0].data || [], barbells: results[1].data || [], error: results[0].error || results[1].error || null };
      } catch (e) {
        return { jumps: [], barbells: [], error: e };
      }
    },

    /** 删除本人一条记录（RLS 保证只能删自己的） */
    deleteRecord: function (table, id) {
      var c = getClient();
      if (!c) return Promise.resolve({ error: { message: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' } });
      return c.from(table).delete().eq('id', id);
    },

    /** 提交问题反馈（未登录也可匿名提交） */
    submitFeedback: async function (data) {
      var c = getClient();
      if (!c) return { error: { message: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' } };
      var user = await Auth.getCurrentUser();
      var row = {
        user_id: user ? user.id : null,
        fb_type: data.fb_type || '问题反馈',
        title: data.title || '',
        content: data.content || '',
        contact: data.contact || null
      };
      try {
        // 注意：不能加 .select()，feedback 表无 SELECT 策略（仅后台可读），
        // INSERT...RETURNING 回读会触发 RLS 报错；提交本身无需回读。
        var res = await c.from('feedback').insert(row);
        return res;
      } catch (e) {
        return { error: e };
      }
    },

    /** 提交「AI 分析不准」纠错反馈：可附带视频上传到私有存储桶，并记录分析指标 */
    submitAnalysisFeedback: async function (data) {
      var c = getClient();
      if (!c) return { ok: false, msg: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' };
      var user = await Auth.getCurrentUser();
      var videoPath = null;
      if (data.videoFile) {
        if (!user) return { ok: false, msg: '上传视频反馈需要先登录（也可去掉视频，仅提交文字说明）' };
        var name = (data.videoFile.name || 'video.mp4').replace(/[\\/:*?"<>|\s]+/g, '_');
        var ext = (name.match(/\.[a-zA-Z0-9]+$/) || ['.mp4'])[0];
        videoPath = user.id + '/' + Date.now() + ext;
        var up = await c.storage.from('jump-feedback').upload(videoPath, data.videoFile, {
          cacheControl: '3600',
          contentType: data.videoFile.type || 'video/mp4'
        });
        if (up.error) return { ok: false, msg: '视频上传失败：' + (up.error.message || '请重试') };
      }
      var row = {
        user_id: user ? user.id : null,
        video_name: data.videoName || null,
        video_path: videoPath,
        video_sec: data.videoSec != null ? data.videoSec : null,
        fps: data.fps != null ? data.fps : null,
        frames: data.frames != null ? data.frames : null,
        metrics: data.metrics || {},
        actual_liftoff: (data.actualLiftoff !== undefined && data.actualLiftoff !== '') ? data.actualLiftoff : null,
        actual_landing: (data.actualLanding !== undefined && data.actualLanding !== '') ? data.actualLanding : null,
        actual_height_cm: (data.actualHeightCm !== undefined && data.actualHeightCm !== '') ? data.actualHeightCm : null,
        issue: data.issue || ''
      };
      try {
        // 不加 .select()：本表无 SELECT 策略（仅后台可读），避免 INSERT...RETURNING 触发 RLS 报错
        var res = await c.from('analysis_feedback').insert(row);
        if (res.error) return { ok: false, msg: '提交失败：' + (res.error.message || '请重试') };
        return { ok: true, msg: videoPath ? '已提交视频与反馈，感谢帮助改进算法！' : '已提交反馈，感谢帮助改进算法！' };
      } catch (e) {
        return { ok: false, msg: '提交失败：' + (e.message || '请重试') };
      }
    },

    /** 保存 AI 训练师生成的训练计划（绑定用户 ID） */
    saveTrainingPlan: function (data) {
      return Auth._insert('training_plans', {
        title: data.title,
        summary: data.summary,
        plan_json: data.plan_json || {}
      });
    },

    /** 读取本人保存的训练计划 */
    fetchTrainingPlans: async function () {
      var c = getClient();
      if (!c) return { plans: [], error: { message: 'Supabase 未配置，请先在 js/supabase-config.js 填入项目信息' } };
      var user = await Auth.getCurrentUser();
      if (!user) return { plans: [], error: { message: '未登录，请先登录' } };
      try {
        var res = await c.from('training_plans').select('*').order('created_at', { ascending: false });
        return { plans: res.data || [], error: res.error || null };
      } catch (e) {
        return { plans: [], error: e };
      }
    },

    /** 会员版：调用 LLM 生成训练计划（请求发往 Cloudflare Worker 代理，key 在服务端） */
    generatePlanWithLLM: async function (payload) {
      var url = CONFIG.LLM_API_URL || '';
      if (!url) return { ok: false, msg: 'LLM 代理未配置（LLM_API_URL），已使用免费模板生成' };
      try {
        var resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) return { ok: false, msg: 'LLM 请求失败: HTTP ' + resp.status };
        var data = await resp.json();
        return { ok: true, text: data.plan || data.text || JSON.stringify(data) };
      } catch (e) {
        return { ok: false, msg: 'LLM 请求异常: ' + e.message };
      }
    },

    /** 各页面顶部导航用户区统一刷新 */
    updateNavUI: function (session) {
      var logged = !!session;
      var email = session && session.user ? session.user.email : '';
      var u = document.getElementById('navUserName');
      var p = document.getElementById('navPlan');
      var b = document.getElementById('btnLogout');
      var l = document.getElementById('btnLogin');
      if (u) u.textContent = logged ? email : '未登录';
      if (b) b.style.display = logged ? 'inline-flex' : 'none';
      if (l) l.style.display = logged ? 'none' : 'inline-flex';
      // 徽章：优先显示会员/额度状态（异步拉取）
      if (p) {
        if (!logged) { p.textContent = 'FREE'; return; }
        Auth.getAiStatus().then(function (st) {
          if (!st) { p.textContent = 'FREE'; return; }
          if (st.is_vip) {
            var d = st.vip_until ? new Date(st.vip_until) : null;
            p.textContent = 'VIP' + (d ? '·' + (d.getMonth() + 1) + '/' + d.getDate() : '');
          } else if (st.credits > 0) {
            p.textContent = '余额×' + st.credits;
          } else if (st.remaining_free > 0) {
            p.textContent = '免费剩' + st.remaining_free + '次';
          } else {
            p.textContent = '0次';
          }
        });
      }
    },

    // ---------- 付费系统：权益状态 / AI 计次 / 邀请码 ----------

    /** 查询用户 AI 权益状态（VIP 到期日 / 余额 / 今日剩余免费次数） */
    getAiStatus: async function () {
      var c = getClient();
      if (!c) return null;
      try {
        var res = await c.rpc('get_ai_status');
        if (res.error || !res.data || !res.data.length) return null;
        return res.data[0];
      } catch (e) { return null; }
    },

    /** 消耗一次 AI 分析。返回 {ok, msg, used_kind}；GLM 失败时用 refundAI 退回 */
    consumeAI: function (aiType) {
      var c = getClient();
      if (!c) return Promise.resolve({ ok: false, msg: 'Supabase 未配置' });
      return c.rpc('consume_ai', { p_type: aiType }).then(function (res) {
        if (res.error) return { ok: false, msg: res.error.message || '计次失败' };
        return (res.data && res.data[0]) ? res.data[0] : { ok: false, msg: '计次失败' };
      }).catch(function (e) { return { ok: false, msg: e.message || '计次失败' }; });
    },

    /** GLM 调用失败时退回本次消耗 */
    refundAI: function (usedKind) {
      var c = getClient();
      if (!c) return Promise.resolve();
      return c.rpc('refund_ai', { p_kind: usedKind }).catch(function () {});
    },

    /** 兑换邀请码（纯发码制，得 N 天 VIP）。返回 {ok, msg, vip_until} */
    redeemInvite: function (code) {
      var c = getClient();
      if (!c) return Promise.resolve({ ok: false, msg: 'Supabase 未配置' });
      return c.rpc('redeem_invite', { p_code: code }).then(function (res) {
        if (res.error) return { ok: false, msg: res.error.message || '兑换失败' };
        return (res.data && res.data[0]) ? res.data[0] : { ok: false, msg: '兑换失败' };
      }).catch(function (e) { return { ok: false, msg: e.message || '兑换失败' }; });
    },

    /** 兑换注册时留下的待绑定推广码（注册后未自动登录时，首次登录/会话恢复时触发） */
    redeemPendingInvite: function () {
      var code = '';
      try { code = localStorage.getItem('vt_pending_invite') || ''; } catch (e) {}
      if (!code) return Promise.resolve(null);
      return Auth.redeemInvite(code).then(function (r) {
        if (r.ok) {
          try { localStorage.removeItem('vt_pending_invite'); } catch (e) {}
        } else {
          // 明确无效的码不再重试（避免每次进站都请求）；网络类错误保留下次再试
          var m = r.msg || '';
          if (m.indexOf('不存在') >= 0 || m.indexOf('停用') >= 0 || m.indexOf('用完') >= 0 || m.indexOf('已使用') >= 0) {
            try { localStorage.removeItem('vt_pending_invite'); } catch (e) {}
          }
        }
        return r;
      }).catch(function () { return null; });
    },

    /** 读取已上架套餐（定价以分为单位） */
    fetchPlans: async function () {
      var c = getClient();
      if (!c) return [];
      try {
        var res = await c.from('plans').select('*').eq('active', true).order('sort_order');
        return (res.data || []).map(function (p) {
          p.price_yuan = (p.price_cents / 100).toFixed(2);
          return p;
        });
      } catch (e) { return []; }
    },

    /** 拉取本人订单（按时间倒序） */
    fetchOrders: async function () {
      var c = getClient();
      if (!c) return [];
      try {
        var res = await c.from('orders').select('*').order('created_at', { ascending: false }).limit(20);
        return res.data || [];
      } catch (e) { return []; }
    },

    // ---------- 第一批次新增：个人资料 / 训练打卡 / 摸高记录 ----------

    /** 读取本人身体资料（user_profiles 表），无则返回 null */
    getProfile: async function () {
      var c = getClient();
      if (!c) return null;
      try {
        var res = await c.from('user_profiles').select('*').limit(1);
        return (res.data && res.data[0]) ? res.data[0] : null;
      } catch (e) { return null; }
    },

    /** 保存本人身体资料（upsert，按 user_id） */
    saveProfile: async function (data) {
      var c = getClient();
      if (!c) return { error: { message: 'Supabase 未配置' } };
      var user = await Auth.getCurrentUser();
      if (!user) return { error: { message: '未登录，请先登录' } };
      return c.from('user_profiles').upsert({
        user_id: user.id,
        nickname: data.nickname || null,
        height_cm: data.height_cm != null ? data.height_cm : null,
        reach_cm: data.reach_cm != null ? data.reach_cm : null,
        weight_kg: data.weight_kg != null ? data.weight_kg : null,
        wingspan_cm: data.wingspan_cm != null ? data.wingspan_cm : null,
        public_show: !!data.public_show,
        updated_at: new Date().toISOString()
      });
    },

    /** 读取本人全部打卡日期（返回日期字符串数组，如 ['2026-07-21']） */
    fetchCheckins: async function () {
      var c = getClient();
      if (!c) return [];
      try {
        var res = await c.from('checkins').select('checkin_date');
        return (res.data || []).map(function (r) { return r.checkin_date; });
      } catch (e) { return []; }
    },

    /** 打卡/取消打卡：date 形如 'YYYY-MM-DD'。已打卡则删除，未打卡则插入 */
    toggleCheckin: async function (date) {
      var c = getClient();
      if (!c) return { error: { message: 'Supabase 未配置' } };
      var user = await Auth.getCurrentUser();
      if (!user) return { error: { message: '未登录，请先登录' } };
      try {
        var q = await c.from('checkins').select('id').eq('user_id', user.id).eq('checkin_date', date);
        if (q.error) return q;
        if (q.data && q.data.length) {
          return c.from('checkins').delete().eq('id', q.data[0].id);
        }
        return c.from('checkins').insert({ user_id: user.id, checkin_date: date });
      } catch (e) { return { error: e }; }
    },

    /** 记录一次摸高成绩（复用 jump_records 表，test_type='摸高'，无腾空时间填 0） */
    saveTouchRecord: function (heightCm) {
      return Auth.saveJumpRecord({ height_cm: heightCm, flight_time: 0, test_type: '摸高' });
    },

    // ---------- 第二批：公开成绩榜单 ----------

    /** 拉取公开榜单（只含昵称/站立摸高/最大原地/最大助跑，绝不含邮箱等敏感信息） */
    fetchLeaderboard: async function () {
      var c = getClient();
      if (!c) return [];
      try {
        var res = await c.rpc('get_leaderboard');
        return res.data || [];
      } catch (e) { return []; }
    }
  };

  // 所有页面导航默认跟随登录状态变化
  _listeners.push(function (session) { Auth.updateNavUI(session); });

  window.JTAuth = Auth;
})();
