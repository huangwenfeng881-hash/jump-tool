/**
 * [新增] Vertrise跃升 · 后台 AI 生成 Service Worker（流式）
 * ------------------------------------------------------------
 * - 页面打开时：通过 MessagePort 逐字转发 GLM 流式 chunk（glmChunk）。
 * - 页面切走/关闭后：SW 继续在后台生成，结果存内存，返回页经 glmGet 取回。
 * 局限：SW 内存不跨 SW 重启；file:// 无法注册 SW（回退页内生成）。
 */
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

var pending = {}; // id -> { ok, text | msg }

self.addEventListener('message', function (e) {
  var data = e.data;
  if (!data) return;
  var port = e.ports && e.ports[0];

  if (data.type === 'glmChat') {
    runChat(data, function (chunk) {
      if (port) { try { port.postMessage({ type: 'glmChunk', id: data.id, chunk: chunk }); } catch (err) {} }
    }).then(function (result) {
      pending[data.id] = result;
      if (port) { try { port.postMessage({ type: 'glmChatDone', id: data.id, result: result }); } catch (err) {} }
    });
  } else if (data.type === 'glmGet') {
    var r = pending[data.id] || null;
    if (port) { try { port.postMessage({ type: 'glmChatResult', id: data.id, result: r }); } catch (err) {} }
  }
});

function isOverload(msg) {
  return /访问量过大|当前访问量|访问量|overloaded|too many|rate\s?limit|繁忙|429|1305/i.test(msg || '');
}

// SSE 解析
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

function doFetch(data, model, onChunk) {
  var body = {
    model: model,
    messages: data.messages || [],
    temperature: data.temperature || 0.6,
    // 限制输出长度：模型到点即停，此值仅作上限防截断/防拖时间
    max_tokens: data.max_tokens || 2000,
    stream: true
  };
  // 60s 超时：挂起时自动中断（已产出内容则按失败处理，不切换模型）
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 60000) : null;
  var gotDelta = false;
  function settle() { if (timer) { clearTimeout(timer); timer = null; } }
  var fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (data.key || '') },
    body: JSON.stringify(body)
  };
  if (ctrl) fetchOpts.signal = ctrl.signal;
  return fetch(data.url, fetchOpts).then(function (r) {
    settle();
    if (!r.ok) {
      return r.json().then(function (d) {
        return { ok: false, msg: (d && d.error && (d.error.message || d.error.msg)) || ('GLM HTTP ' + r.status) };
      }).catch(function () {
        return { ok: false, msg: 'GLM HTTP ' + r.status };
      });
    }
    var full = '';
    return parseSSE(r, function (delta) {
      gotDelta = true;
      full += delta;
      if (onChunk) onChunk(delta);
    }).then(function () {
      // 空内容：推理模型把预算花在 reasoning_content 上 → 标记可重试，自动切换模型
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

function tryModels(data, models, idx, onChunk) {
  if (idx >= models.length) {
    return Promise.resolve({ ok: false, msg: '所有可用模型均暂不可用（访问量过大），请稍后再试' });
  }
  return doFetch(data, models[idx], onChunk).then(function (res) {
    if (res.ok) {
      return { ok: true, text: res.text, usedModel: models[idx], fallback: idx > 0 };
    }
    if (isOverload(res.msg) || res.retry) {
      return tryModels(data, models, idx + 1, onChunk).then(function (r2) {
        if (r2.ok) { r2.usedModel = r2.usedModel || models[idx + 1]; r2.fallback = true; }
        return r2;
      });
    }
    return { ok: false, msg: res.msg, usedModel: models[idx], fallback: idx > 0 };
  });
}

function runChat(data, onChunk) {
  var models = (data.models && data.models.length) ? data.models.slice() : [data.model || 'glm-4.7-flash'];
  if (models.indexOf(data.model) < 0) models.unshift(data.model);
  return tryModels(data, models, 0, onChunk);
}
