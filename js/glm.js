/**
 * [新增] Vertrise跃升 · 智谱 GLM 接入模块（支持模型自动切换）
 * ------------------------------------------------------------
 * 统一调用智谱开放平台 chat/completions（GLM-4.7-Flash 等）。
 * - 模型自动切换：当首选模型返回「访问量过大/繁忙」等限流错误时，
 *   自动依次尝试 GLM_MODELS 列表中的后续可用模型，并把 usedModel/fallback 带回。
 * - 直连：GLM_API_URL / GLM_API_KEY（前端调用有 CORS 与密钥暴露风险，
 *   正式环境建议用 Cloudflare Worker 代理，把 GLM_API_URL 指向 Worker）
 * - 暴露：window.GLM
 */
window.GLM = (function () {
  'use strict';

  var CONFIG = window.JTConfig || {};
  var GLMKey = window.GLMKey || null;

  // 兼容：密文加密（GLM_API_KEY_ENC）或旧版明文（GLM_API_KEY）均可
  function isConfigured() {
    if (!CONFIG.GLM_API_URL || !CONFIG.GLM_API_URL.trim()) return false;
    if (CONFIG.GLM_API_KEY_ENC && CONFIG.GLM_API_KEY_ENC.trim()) return true;
    return !!(CONFIG.GLM_API_KEY && CONFIG.GLM_API_KEY.trim());
  }

  // 运行时获取明文 key（优先解密缓存，其次兼容旧明文），失败返回 ''
  function getKey() {
    if (GLMKey && GLMKey.isConfigured()) return GLMKey.get();
    if (CONFIG.GLM_API_KEY && CONFIG.GLM_API_KEY.trim()) return Promise.resolve(CONFIG.GLM_API_KEY.trim());
    return Promise.resolve('');
  }

  function modelName() {
    return CONFIG.GLM_MODEL || 'glm-4.7-flash';
  }

  // 主模型 + 备用模型列表（GLM_MODELS 可配置）
  function modelList() {
    var primary = modelName();
    var list = (CONFIG.GLM_MODELS && Array.isArray(CONFIG.GLM_MODELS) && CONFIG.GLM_MODELS.length)
      ? CONFIG.GLM_MODELS.slice()
      : [primary];
    if (list.indexOf(primary) < 0) list.unshift(primary);
    return list;
  }

  // 判断是否「访问量过大/繁忙」类限流错误（触发自动切换）
  function isOverload(msg) {
    return /访问量过大|当前访问量|访问量|overloaded|too many|rate\s?limit|繁忙|429|1305/i.test(msg || '');
  }

  function doChat(model, messages, opts) {
    var url = CONFIG.GLM_API_URL;
    var body = {
      model: model,
      messages: messages,
      temperature: (opts && opts.temperature) || 0.6,
      // 限制输出长度：防止推理模型/长回复无限占用时间。
      // 模型正常输出会以 finish_reason=stop 提前结束，此值仅作上限防止过长与截断。
      max_tokens: (opts && opts.max_tokens) || 2000,
      stream: false
    };
    return getKey().then(function (key) {
      if (!key) {
        return { ok: false, msg: 'GLM 密钥解密失败或未配置（js/supabase-config.js → GLM_API_KEY_ENC / GLM_CRYPTO_PASSPHRASE）' };
      }
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (d) {
            var msg = (d && d.error && (d.error.message || d.error.msg)) || ('GLM HTTP ' + r.status);
            return { ok: false, msg: msg };
          }).catch(function () {
            return { ok: false, msg: 'GLM HTTP ' + r.status };
          });
        }
        return r.json();
      }).then(function (d) {
        if (d && d.ok === false) return d;
        var msg = d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message : null;
        var txt = msg ? msg.content : '';
        if (txt && String(txt).trim()) return { ok: true, text: String(txt) };
        // 空内容：推理类模型（glm-4.5/4.7 等）会把输出预算花在 reasoning_content 上，
        // 导致正式 content 为空。标记可重试，自动切换到下一个模型（如 glm-4-flash）。
        var reasoning = msg && msg.reasoning_content ? String(msg.reasoning_content).length : 0;
        return { ok: false, msg: reasoning > 0 ? '该模型仍在思考未产出正式内容，自动切换模型' : '该模型未返回内容，自动切换模型', retry: true };
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : 'GLM 请求失败';
        if (/Failed to fetch|NetworkError|CORS|load failed|fetch/i.test(msg)) {
          msg = '网络/跨域错误：GLM 接口需可直连的环境，或用 Cloudflare Worker 代理';
        }
        return { ok: false, msg: msg };
      });
    });
  }

  function tryModels(messages, opts, models, idx) {
    if (idx >= models.length) {
      return Promise.resolve({ ok: false, msg: '所有可用模型均暂不可用（访问量过大），请稍后再试' });
    }
    return doChat(models[idx], messages, opts).then(function (res) {
      if (res.ok) {
        return { ok: true, text: res.text, usedModel: models[idx], fallback: idx > 0 };
      }
      if (isOverload(res.msg) || res.retry) {
        // 限流 / 返回空内容（推理模型）：递归尝试下一个模型
        return tryModels(messages, opts, models, idx + 1).then(function (r2) {
          if (r2.ok) { r2.usedModel = r2.usedModel || models[idx + 1]; r2.fallback = true; }
          return r2;
        });
      }
      // 非限流错误（鉴权/参数/网络）直接返回
      return { ok: false, msg: res.msg, usedModel: models[idx], fallback: idx > 0 };
    });
  }

  /**
   * 对话补全（含模型自动切换）
   * @param {Array} messages [{role:'system'|'user'|'assistant', content}]
   * @param {Object} opts { temperature }
   * @returns {Promise<{ok:boolean, text?:string, msg?:string, usedModel?:string, fallback?:boolean}>}
   */
  function chat(messages, opts) {
    if (!isConfigured()) {
      return Promise.resolve({ ok: false, msg: 'GLM 未配置（js/supabase-config.js → GLM_API_KEY_ENC / GLM_MODEL）' });
    }
    return tryModels(messages, opts, modelList(), 0);
  }

  return {
    chat: chat,
    isConfigured: isConfigured,
    getKey: getKey,
    modelName: modelName,
    modelList: modelList,
    isOverload: isOverload
  };
})();
