/**
 * [新增] Vertrise跃升 · 智谱 GLM 接入模块（流式 + 模型自动切换）
 * ------------------------------------------------------------
 * 统一调用智谱 chat/completions（GLM-4.7-Flash 等）。
 * - 流式：stream:true 时通过 SSE 逐字回调 onChunk，前端“生成一个字显示一个字”。
 * - 模型自动切换：首选模型「访问量过大/繁忙」时自动尝试 GLM_MODELS 后续模型。
 * - 直连有 CORS 与密钥暴露风险，正式环境建议 Cloudflare Worker 代理。
 * - 暴露：window.GLM
 */
window.GLM = (function () {
  'use strict';

  var CONFIG = window.JTConfig || {};

  function isConfigured() {
    return !!(CONFIG.GLM_API_KEY && CONFIG.GLM_API_KEY.trim() && CONFIG.GLM_API_URL && CONFIG.GLM_API_URL.trim());
  }

  function modelName() {
    return CONFIG.GLM_MODEL || 'glm-4.7-flash';
  }

  function modelList() {
    var primary = modelName();
    var list = (CONFIG.GLM_MODELS && Array.isArray(CONFIG.GLM_MODELS) && CONFIG.GLM_MODELS.length)
      ? CONFIG.GLM_MODELS.slice()
      : [primary];
    if (list.indexOf(primary) < 0) list.unshift(primary);
    return list;
  }

  function isOverload(msg) {
    return /访问量过大|当前访问量|访问量|overloaded|too many|rate\s?limit|繁忙|429|1305/i.test(msg || '');
  }

  // 解析 SSE 流，逐字回调 onDelta
  function parseSSE(resp, onDelta) {
    var reader = resp.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buf += decoder.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line.indexOf('data:') === 0) {
            var data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              var j = JSON.parse(data);
              var delta = j.choices && j.choices[0] && j.choices[0].delta ? j.choices[0].delta.content : '';
              if (delta) onDelta(delta);
            } catch (e) {}
          }
        }
        return pump();
      });
    }
    return pump();
  }

  function doChat(model, messages, opts, onChunk) {
    var url = CONFIG.GLM_API_URL;
    var stream = !!(opts && opts.stream);
    var body = {
      model: model,
      messages: messages,
      temperature: (opts && opts.temperature) || 0.6,
      // 限制输出长度：模型到点即停，此值仅作上限防截断/防拖时间
      max_tokens: (opts && opts.max_tokens) || 2000,
      stream: stream
    };
    // 60s 超时：网络/模型挂起时自动中断（流式已产出内容则按失败处理，不切换模型）
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 60000) : null;
    var gotDelta = false;
    function settle() { if (timer) { clearTimeout(timer); timer = null; } }
    var fetchOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.GLM_API_KEY.trim()
      },
      body: JSON.stringify(body)
    };
    if (ctrl) fetchOpts.signal = ctrl.signal;
    return fetch(url, fetchOpts).then(function (r) {
      settle();
      if (!r.ok) {
        return r.json().then(function (d) {
          var msg = (d && d.error && (d.error.message || d.error.msg)) || ('GLM HTTP ' + r.status);
          return { ok: false, msg: msg };
        }).catch(function () {
          return { ok: false, msg: 'GLM HTTP ' + r.status };
        });
      }
      if (!stream) {
        return r.json().then(function (d) {
          var m = d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message : null;
          var txt = m ? m.content : '';
          if (txt && String(txt).trim()) return { ok: true, text: String(txt) };
          // 空内容：推理模型把预算花在 reasoning_content 上 → 标记可重试，自动切换模型
          var rz = m && m.reasoning_content ? String(m.reasoning_content).length : 0;
          return { ok: false, msg: rz > 0 ? '该模型仍在思考未产出正式内容，自动切换模型' : '该模型未返回内容，自动切换模型', retry: true };
        });
      }
      // 流式
      var full = '';
      return parseSSE(r, function (delta) {
        gotDelta = true;
        full += delta;
        if (onChunk) onChunk(delta);
      }).then(function () {
        return (full && full.trim()) ? { ok: true, text: full } : { ok: false, msg: '该模型未返回内容，自动切换模型', retry: true };
      });
    }).catch(function (e) {
      settle();
      var msg = (e && e.message) ? e.message : 'GLM 请求失败';
      if (/Failed to fetch|NetworkError|CORS|load failed|fetch/i.test(msg)) {
        msg = '网络/跨域错误：GLM 接口需可直连的环境，或用 Cloudflare Worker 代理';
      }
      // 未产出任何内容（超时/429/断网）→ 可重试切下一模型；已产出内容则直接失败
      return { ok: false, msg: msg, retry: !gotDelta };
    });
  }

  function tryModels(messages, opts, models, idx) {
    if (idx >= models.length) {
      return Promise.resolve({ ok: false, msg: '所有可用模型均暂不可用（访问量过大），请稍后再试' });
    }
    var onChunk = opts && opts.onChunk;
    return doChat(models[idx], messages, opts, onChunk).then(function (res) {
      if (res.ok) {
        return { ok: true, text: res.text, usedModel: models[idx], fallback: idx > 0 };
      }
      if (isOverload(res.msg) || res.retry) {
        // 限流 / 超时 / 空内容（推理模型）：递归尝试下一个模型
        return tryModels(messages, opts, models, idx + 1).then(function (r2) {
          if (r2.ok) { r2.usedModel = r2.usedModel || models[idx + 1]; r2.fallback = true; }
          return r2;
        });
      }
      return { ok: false, msg: res.msg, usedModel: models[idx], fallback: idx > 0 };
    });
  }

  /**
   * 对话补全（含流式 + 模型自动切换）
   * opts: { temperature?, stream?:boolean, onChunk?:function(delta) }
   * @returns {Promise<{ok, text?, msg?, usedModel?, fallback?}>}
   */
  function chat(messages, opts) {
    if (!isConfigured()) {
      return Promise.resolve({ ok: false, msg: 'GLM 未配置（js/supabase-config.js → GLM_API_KEY / GLM_MODEL）' });
    }
    return tryModels(messages, opts || {}, modelList(), 0);
  }

  return {
    chat: chat,
    isConfigured: isConfigured,
    modelName: modelName,
    modelList: modelList,
    isOverload: isOverload,
    parseSSE: parseSSE,
    getKey: function () { return Promise.resolve(CONFIG.GLM_API_KEY || ''); }
  };
})();
