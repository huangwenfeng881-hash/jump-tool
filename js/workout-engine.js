/**
 * Vertrise 跃升 · 一周训练引擎
 * - buildTemplate(profile, assess)：本地规则生成（无网/无 AI 时兜底）
 * - generateAI(profile, assess)：调用 GLM 代理生成，失败自动回落模板
 * - adapt(...)：根据每组训练状态实时调整后续组
 */
window.JTWorkout = (function () {
  'use strict';

  function pick(arr, i) { return arr[i % arr.length]; }

  var LIB = {
    strength: [
      { name: '杠铃深蹲', sets: 5, reps: '5', load: '75% 1RM', rest: '150s', note: '下蹲到大腿平行，核心收紧' },
      { name: '罗马尼亚硬拉', sets: 4, reps: '6', load: '70% 1RM', rest: '120s', note: '髋铰链，背部中立' },
      { name: '保加利亚分腿蹲', sets: 3, reps: '8/侧', load: '自重或哑铃', rest: '90s', note: '前脚掌踩稳，控制下放' },
      { name: '高翻（Power Clean）', sets: 5, reps: '3', load: '70~75% 1RM', rest: '150s', note: '快速发力，接杠稳' }
    ],
    power: [
      { name: '跳箱（Box Jump）', sets: 5, reps: '3', load: '高度 70~80cm', rest: '90s', note: '落地轻，不要坐箱' },
      { name: '连续纵跳', sets: 4, reps: '5', load: '自重', rest: '90s', note: '每次触地最短时间' },
      { name: '起跑冲刺 10m', sets: 6, reps: '1', load: '全力', rest: '90s', note: '前 3 步压低重心' },
      { name: '高翻（Power Clean）', sets: 4, reps: '3', load: '65~70% 1RM', rest: '120s', note: '强调三伸展' }
    ],
    tech: [
      { name: '助跑起跳摸高', sets: 6, reps: '1', load: '全力', rest: '60s', note: '最后两步要快、要低' },
      { name: '原地摆臂起跳', sets: 4, reps: '4', load: '自重', rest: '60s', note: '手臂后摆→前上甩' },
      { name: '落地缓冲练习', sets: 3, reps: '6', load: '自重', rest: '45s', note: '前脚掌先落地，屈髋屈膝' }
    ],
    elastic: [
      { name: '跳深（Depth Jump）', sets: 4, reps: '3', load: '箱高 40~50cm', rest: '120s', note: '触地时间越短越好' },
      { name: '连续跨步跳', sets: 4, reps: '6/侧', load: '自重', rest: '90s', note: '保持节奏' },
      { name: '跳绳双摇', sets: 4, reps: '30s', load: '自重', rest: '45s', note: '踝关节刚性' }
    ],
    recovery: [
      { name: '髋屈肌拉伸', sets: 2, reps: '45s/侧', load: '自重', rest: '—', note: '弓箭步压髋' },
      { name: '泡沫轴放松股四头', sets: 2, reps: '60s/侧', load: '自重', rest: '—', note: '慢速滚动' },
      { name: '低强度慢跑', sets: 1, reps: '15 分钟', load: '能说话的速度', rest: '—', note: '促进恢复' }
    ]
  };

  function decideFocus(assess) {
    var weak = (assess && assess.weak) || [];
    var plan = [];
    if (!weak.length) plan = ['power', 'strength', 'tech', 'elastic'];
    else {
      weak.forEach(function (w) {
        if (w.indexOf('力量') >= 0) plan.push('strength');
        else if (w.indexOf('爆发') >= 0) plan.push('power');
        else if (w.indexOf('技术') >= 0) plan.push('tech');
        else if (w.indexOf('反应') >= 0) plan.push('elastic');
      });
    }
    // 去重 + 补齐到 4 类（保证一周有变化，不重复同一主题）
    var uniq = [];
    plan.forEach(function (k) { if (uniq.indexOf(k) < 0) uniq.push(k); });
    ['strength', 'power', 'tech', 'elastic'].forEach(function (k) {
      if (uniq.length < 4 && uniq.indexOf(k) < 0) uniq.push(k);
    });
    return uniq;
  }

  function day(dayName, focus, items, assist) {
    return { day: dayName, focus: focus, items: items, assist: assist || '' };
  }

  function buildTemplate(profile, assess) {
    var focus = decideFocus(assess);
    var rsi = parseFloat(profile && profile.rsi) || 0;
    var days = [];
    var week = ['周一', '周二', '周四', '周五', '周六'];
    for (var i = 0; i < 4; i++) {
      var kind = focus[i % focus.length];
      if (kind === 'elastic' && rsi > 0 && rsi < 1.2) kind = 'strength'; // 弹性差先别跳深
      var items = LIB[kind].slice(0, 3).map(function (x) { return JSON.parse(JSON.stringify(x)); });
      var focusName = { strength: '下肢力量', power: '爆发力', tech: '起跳技术', elastic: '弹性/反应' }[kind];
      days.push(day(week[i], focusName, items,
        kind === 'strength' ? '训练后拉伸髋 + 小腿 5 分钟' : ''));
    }
    days.push(day('周三', '主动恢复', LIB.recovery.slice(0, 2).map(function (x) { return JSON.parse(JSON.stringify(x)); }), '睡眠 7.5 小时以上'));
    days.push(day('周日', '完全休息', [], '散步、拉伸，别练'));
    var t = (assess && assess.type && assess.type.name) || '训练者';
    return {
      title: '一周弹跳训练 · ' + t,
      summary: '根据你的评估（' + ((assess && assess.weak || []).join('、') || '均衡发展') + '），本周重点补短板，强度循序渐进。',
      note: '根据首周训练效果灵活调整下次训练。',
      days: days,
      source: 'template'
    };
  }

  function extractJSON(text) {
    if (!text) return null;
    var s = text.indexOf('{');
    var e = text.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try { return JSON.parse(text.slice(s, e + 1)); } catch (err) { return null; }
  }

  function normalizePlan(obj, fallback) {
    if (!obj || !Array.isArray(obj.days) || !obj.days.length) return fallback;
    var days = obj.days.slice(0, 7).map(function (d, i) {
      var items = (d.items || []).slice(0, 5).map(function (it) {
        return {
          name: String(it.name || '训练动作'),
          sets: Math.max(1, Math.min(8, parseInt(it.sets, 10) || 3)),
          reps: String(it.reps || it.rep || '8'),
          load: String(it.load || it.weight || '自重'),
          rest: String(it.rest || '90s'),
          note: String(it.note || '')
        };
      });
      return { day: String(d.day || ('第' + (i + 1) + '天')), focus: String(d.focus || '训练'), items: items, assist: String(d.assist || '') };
    });
    return {
      title: obj.title || fallback.title,
      summary: obj.summary || fallback.summary,
      note: obj.note || fallback.note,
      days: days,
      source: 'ai'
    };
  }

  function profileText(p, assess) {
    var lines = [];
    if (p.height) lines.push('身高 ' + p.height + 'cm');
    if (p.weight) lines.push('体重 ' + p.weight + 'kg');
    if (p.vertStand) lines.push('原地起跳 ' + p.vertStand + 'cm');
    if (p.vertRun) lines.push('助跑起跳 ' + p.vertRun + 'cm');
    if (p.rsi) lines.push('RSI ' + p.rsi);
    if (p.clean) lines.push('高翻 ' + p.clean + 'kg');
    if (p.squat) lines.push('深蹲 ' + p.squat + 'kg');
    if (p.deadlift) lines.push('硬拉 ' + p.deadlift + 'kg');
    if (p.colds !== null && p.colds !== undefined) lines.push('每月生病 ' + p.colds + ' 次');
    var t = assess && assess.type ? assess.type.name : '';
    var w = assess && assess.weak ? assess.weak.join('、') : '';
    return '训练者：' + t + '；身体数据：' + lines.join('，') + '；短板：' + (w || '无') + '。';
  }

  function buildPrompt(p, assess) {
    return [
      { role: 'system', content: '你是一名体能教练，只输出 JSON，不要任何解释文字。' },
      { role: 'user', content:
        profileText(p, assess) + '\n' +
        '请给这一个训练者制定一周弹跳训练计划，输出严格 JSON（不要 markdown）：\n' +
        '{"title":"...","summary":"...","note":"根据首周训练效果灵活调整下次训练。","days":[{"day":"周一","focus":"下肢力量","assist":"...","items":[{"name":"杠铃深蹲","sets":5,"reps":"5","load":"75% 1RM","rest":"150s","note":"要点"}]}]}\n' +
        '要求：共 6~7 天（含 1~2 天恢复/休息，休息日 items 可为空数组）；每天 2~4 个动作；结合短板优先；重量用 %1RM 或自重；不要出现伤病风险动作。'
      }
    ];
  }

  function generateAI(profile, assess) {
    var fallback = buildTemplate(profile, assess);
    if (!window.GLM || !window.GLM.isConfigured()) return Promise.resolve(fallback);
    return window.GLM.chat(buildPrompt(profile, assess), { stream: false, temperature: 0.5, max_tokens: 1600 })
      .then(function (r) {
        if (!r || !r.ok) return fallback;
        var obj = extractJSON(r.text);
        return normalizePlan(obj, fallback);
      })
      .catch(function () { return fallback; });
  }

  // ---------- 跟练：每组状态自适应 ----------
  var STATUS_TXT = { easy: '轻松', ok: '正好', hard: '吃力', fail: '失败' };

  /** 根据状态给出后续组的调整建议（返回 {msg, apply(item)}） */
  function adaptation(status, item, setIndex) {
    if (status === 'easy') {
      return { msg: '下一组 +2.5% 负重或 +1 次', apply: function (it) { it.load = bump(it.load, +1); } };
    }
    if (status === 'ok') return { msg: '保持原计划', apply: function () {} };
    if (status === 'hard') {
      return { msg: '下一组 -5% 负重', apply: function (it) { it.load = bump(it.load, -1); } };
    }
    return { msg: '本动作剩余组跳过，改成技术练习', apply: function (it) { it._skipRest = true; } };
  }

  function bump(load, dir) {
    var m = String(load).match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      var v = Math.max(40, Math.min(95, parseFloat(m[1]) + dir * 5));
      return v + '% 1RM';
    }
    var kg = String(load).match(/(\d+(?:\.\d+)?)\s*kg/);
    if (kg) {
      var w = Math.max(5, parseFloat(kg[1]) + dir * 2.5);
      return w + 'kg';
    }
    return load;
  }

  return {
    buildTemplate: buildTemplate,
    generateAI: generateAI,
    adaptation: adaptation,
    bump: bump,
    STATUS_TXT: STATUS_TXT
  };
})();
