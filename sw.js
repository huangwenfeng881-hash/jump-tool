/**
 * [新增] Vertrise跃升 · 后台 AI 生成 Service Worker
 * ------------------------------------------------------------
 * 用途：AI 训练计划生成时，即使页面切换到其他标签/页面，
 * 由本 SW 在后台继续调用 GLM 接口，结果保存在内存中，
 * 回到 AI训练师页后通过消息取回。
 *
 * 局限：SW 内存存储不跨 SW 重启；file:// 无法注册 SW（自动回退页内生成）。
 * 依赖 CORS：与页内 fetch 一样受 GLM 跨域限制，正式环境建议 Cloudflare Worker 代理。
 */
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

var pending = {}; // id -> { ok, text | msg }

self.addEventListener('message', function (e) {
  var data = e.data;
  if (!data) return;
  var port = e.ports && e.ports[0];

  if (data.type === 'glmChat') {
    runChat(data).then(function (result) {
      pending[data.id] = result;
      if (port) {
        try { port.postMessage({ type: 'glmChatDone', id: data.id, result: result }); } catch (err) {}
      }
    });
  } else if (data.type === 'glmGet') {
    var r = pending[data.id] || null;
    if (port) {
      try { port.postMessage({ type: 'glmChatResult', id: data.id, result: r }); } catch (err) {}
    }
  }
});

function isOverload(msg) {
  return /访问量过大|当前访问量|访问量|overloaded|too many|rate\s?limit|繁忙|429|1305/i.test(msg || '');
}

function doFetch(data, model) {
  var body = {
    model: model,
    messages: data.messages || [],
    temperature: data.temperature || 0.6,
    // 限制输出长度：防止推理模型/长回复无限占用时间。
    max_tokens: data.max_tokens || 2000,
    stream: false
  };
  return fetch(data.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (data.key || '') },
    body: JSON.stringify(body)
  }).then(function (r) {
    if (!r.ok) {
      return r.json().then(function (d) {
        throw new Error((d && d.error && (d.error.message || d.error.msg)) || ('GLM HTTP ' + r.status));
      });
    }
    return r.json();
  }).then(function (d) {
    var msg = d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message : null;
    var txt = msg ? msg.content : '';
    if (txt && String(txt).trim()) return { ok: true, text: String(txt) };
    // 空内容：推理类模型把输出预算花在 reasoning_content 上，正式 content 为空。
    // 标记可重试，自动切换到下一个模型（如 glm-4-flash）。
    var reasoning = msg && msg.reasoning_content ? String(msg.reasoning_content).length : 0;
    return { ok: false, msg: reasoning > 0 ? '该模型仍在思考未产出正式内容，自动切换模型' : '该模型未返回内容，自动切换模型', retry: true };
  }).catch(function (e) {
    var msg = (e && e.message) ? e.message : 'GLM 请求失败';
    if (/Failed to fetch|NetworkError|CORS|load failed|fetch/i.test(msg)) {
      msg = '网络/跨域错误：GLM 接口需可直连的环境，或用 Cloudflare Worker 代理';
    }
    return { ok: false, msg: msg };
  });
}

// 模型自动切换：首选模型「访问量过大」时依次尝试后续模型
function tryModels(data, models, idx) {
  if (idx >= models.length) {
    return Promise.resolve({ ok: false, msg: '所有可用模型均暂不可用（访问量过大），请稍后再试' });
  }
  return doFetch(data, models[idx]).then(function (res) {
    if (res.ok) {
      return { ok: true, text: res.text, usedModel: models[idx], fallback: idx > 0 };
    }
    if (isOverload(res.msg) || res.retry) {
      return tryModels(data, models, idx + 1).then(function (r2) {
        if (r2.ok) { r2.usedModel = r2.usedModel || models[idx + 1]; r2.fallback = true; }
        return r2;
      });
    }
    return { ok: false, msg: res.msg, usedModel: models[idx], fallback: idx > 0 };
  });
}

function runChat(data) {
  var models = (data.models && data.models.length) ? data.models.slice() : [data.model || 'glm-4.7-flash'];
  if (models.indexOf(data.model) < 0) models.unshift(data.model);
  return tryModels(data, models, 0);
}
