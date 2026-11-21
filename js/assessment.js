/**
 * Vertrise 跃升 · 训练者评估引擎（六步判定）
 *
 * 输入 profile（单位：cm / kg / 秒 / 次）：
 *   height, weight, armspan, standingReach, vertStand, vertRun,
 *   sprint100, standingJump, rsi, clean, squat, deadlift, colds
 *
 * 输出：
 *   { steps: [6 项，含等级/数值/说明], type: {code,name,desc}, summary, targets }
 *
 * 设计原则：缺数据不瞎猜，标成「数据不足」并降低该项权重。
 */
window.JTAssess = (function () {
  'use strict';

  var GRADE = { s: 5, a: 4, b: 3, c: 2, d: 1, none: 0 };
  var GRADE_TXT = { 5: '极好', 4: '好', 3: '中', 2: '差', 1: '极差', 0: '数据不足' };

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : null;
  }

  /** 分段判定：阈值从高到低，返回 1-5 */
  function band(v, bands) {
    if (v === null) return 0;
    for (var i = 0; i < bands.length; i++) {
      if (v >= bands[i][0]) return bands[i][1];
    }
    return 1;
  }

  // ---------- 第一步：BMI ----------
  function stepBMI(p) {
    var h = num(p.height), w = num(p.weight);
    if (!h || !w) return { key: 'bmi', index: 1, title: '身体成分（BMI）', grade: 0, value: '—', label: '数据不足', advice: '补上身高体重才能判断该增肌还是减脂' };
    var bmi = w / Math.pow(h / 100, 2);
    var label, grade, advice;
    if (bmi < 18.5) { label = '偏瘦 → 增肌'; grade = 3; advice = '热量盈余 +300~500kcal，每周增重 0.25~0.5kg，优先练大肌群'; }
    else if (bmi < 24) { label = '正常 → 维持'; grade = 5; advice = '维持即可，训练后补足蛋白 1.6~2g/kg'; }
    else if (bmi < 28) { label = '超重 → 减脂'; grade = 3; advice = '热量缺口 300~500kcal，保留力量训练，别掉肌肉'; }
    else { label = '肥胖 → 先减重'; grade = 2; advice = '先降体重再堆弹跳，优先低冲击有氧 + 力量'; }
    return { key: 'bmi', index: 1, title: '身体成分（BMI）', grade: grade, value: bmi.toFixed(1), label: label, advice: advice };
  }

  // ---------- 第二步：RSI ----------
  function stepRSI(p) {
    var rsi = num(p.rsi);
    if (!rsi) return { key: 'rsi', index: 2, title: '反应力量（RSI）', grade: 0, value: '—', label: '数据不足', advice: '做一次跳深或测一次触地时间即可得到 RSI' };
    var g = band(rsi, [[2.5, 5], [1.8, 4], [1.2, 3], [0.8, 2]]);
    var advice = {
      5: '弹性极好：可以上高强度超等长（跳深 40~60cm）',
      4: '弹性好：跳深 / 连续跳可以正常安排',
      3: '弹性中等：先把落地控制和踝刚练起来',
      2: '弹性差：减少跳深，多做低强度弹跳 + 力量',
      1: '弹性极差：先做基础力量与落地缓冲，暂停高冲击'
    }[g];
    return { key: 'rsi', index: 2, title: '反应力量（RSI）', grade: g, value: rsi.toFixed(2), label: GRADE_TXT[g], advice: advice };
  }

  // ---------- 第三步：爆发力 ----------
  function stepPower(p) {
    var w = num(p.weight), sp = num(p.sprint100), sj = num(p.standingJump), clean = num(p.clean);
    var parts = [];
    if (sp) parts.push(band(15.5 - sp, [[3.5, 5], [2.5, 4], [1.5, 3], [0.5, 2]])); // 100m 越快越好
    if (sj) parts.push(band(sj, [[270, 5], [240, 4], [210, 3], [180, 2]]));
    if (clean && w) parts.push(band(clean / w, [[1.2, 5], [1.0, 4], [0.8, 3], [0.6, 2]]));
    if (!parts.length) return { key: 'power', index: 3, title: '爆发力', grade: 0, value: '—', label: '数据不足', advice: '补上 100 米 / 立定跳远 / 高翻任意一项' };
    var avg = parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
    var g = Math.round(avg);
    var detail = [];
    if (sp) detail.push('100m ' + sp + 's');
    if (sj) detail.push('立定跳远 ' + sj + 'cm');
    if (clean && w) detail.push('高翻 ' + (clean / w).toFixed(2) + '×体重');
    return {
      key: 'power', index: 3, title: '爆发力', grade: g, value: GRADE_TXT[g], label: detail.join(' · '),
      advice: g >= 4 ? '爆发力是优势，用来带动技术动作' : (g === 3 ? '中等：每周 2 次高强度爆发训练（3-5 组 × 3 次）' : '偏弱：先练基础力量与起跳技术，再上强度')
    };
  }

  // ---------- 第四步：力量水平 ----------
  function stepStrength(p) {
    var w = num(p.weight), sq = num(p.squat), dl = num(p.deadlift);
    var parts = [];
    if (sq && w) parts.push(band(sq / w, [[1.75, 5], [1.5, 4], [1.2, 3], [1.0, 2]]));
    if (dl && w) parts.push(band(dl / w, [[2.1, 5], [1.8, 4], [1.5, 3], [1.2, 2]]));
    if (!parts.length) return { key: 'strength', index: 4, title: '力量水平', grade: 0, value: '—', label: '数据不足', advice: '补上深蹲 / 硬拉重量（相对体重才准）' };
    var g = Math.round(parts.reduce(function (a, b) { return a + b; }, 0) / parts.length);
    var detail = [];
    if (sq && w) detail.push('深蹲 ' + (sq / w).toFixed(2) + '×');
    if (dl && w) detail.push('硬拉 ' + (dl / w).toFixed(2) + '×');
    return {
      key: 'strength', index: 4, title: '力量水平', grade: g, value: GRADE_TXT[g], label: detail.join(' · '),
      advice: g >= 4 ? '力量是优势：可以更依赖大重量刺激' : (g === 3 ? '中等：深蹲目标 1.5×体重，硬拉 1.8×体重' : '偏弱：先把深蹲推进到 1.2×体重，弹跳才上得去')
    };
  }

  // ---------- 第五步：技术水平 ----------
  function stepTech(p) {
    var h = num(p.height), vs = num(p.vertStand), vr = num(p.vertRun);
    if (!vs && !vr) return { key: 'tech', index: 5, title: '起跳技术', grade: 0, value: '—', label: '数据不足', advice: '测一次原地起跳和助跑起跳（App 里有「立即测」）' };
    var parts = [];
    if (vs && vr) {
      var diff = vr - vs;
      parts.push(band(diff, [[12, 5], [8, 4], [4, 3], [1, 2]]));
    }
    if (vs && h) parts.push(band(vs / h, [[0.45, 5], [0.40, 4], [0.35, 3], [0.30, 2]]));
    var g = Math.round(parts.reduce(function (a, b) { return a + b; }, 0) / parts.length);
    var label = (vs && vr) ? ('助跑比原地 +' + (vr - vs).toFixed(0) + 'cm') : '仅单项数据';
    return {
      key: 'tech', index: 5, title: '起跳技术', grade: g, value: GRADE_TXT[g], label: label,
      advice: (vs && vr && vr - vs < 4)
        ? '助跑转化差：重点练最后两步节奏与摆臂，助跑应比原地高 8~15cm'
        : (g >= 4 ? '技术转化不错，保持节奏训练' : '技术一般：多练助跑起跳与落地缓冲')
    };
  }

  // ---------- 第六步：训练强度（感冒频率） ----------
  function stepLoad(p) {
    var c = p.colds;
    var n = (c === 0 || c === '0') ? 0 : num(c);
    if (n === null) return { key: 'load', index: 6, title: '恢复与训练强度', grade: 0, value: '—', label: '数据不足', advice: '填一下平均每月感冒/生病次数' };
    var g, label, advice;
    if (n === 0) { g = 3; label = '强度偏低'; advice = '很少生病说明恢复有余量，可以每 2 周加一次训练量或强度'; }
    else if (n <= 1) { g = 5; label = '强度适中'; advice = '恢复良好，按计划推进即可'; }
    else if (n === 2) { g = 3; label = '强度偏高'; advice = '适当降低训练量 20%，保证睡眠 7.5h+'; }
    else { g = 1; label = '强度过高'; advice = '先减量恢复：每周减少 1~2 次高强度，补足碳水和睡眠'; }
    return { key: 'load', index: 6, title: '恢复与训练强度', grade: g, value: String(n) + ' 次/月', label: label, advice: advice };
  }

  // ---------- 类型判定 ----------
  function classify(steps) {
    var m = {};
    steps.forEach(function (s) { m[s.key] = s.grade; });
    var power = m.power || 0, strength = m.strength || 0, rsi = m.rsi || 0, tech = m.tech || 0, bmi = m.bmi || 0;
    var valid = [power, strength, rsi, tech].filter(function (g) { return g > 0; });
    var avg = valid.length ? valid.reduce(function (a, b) { return a + b; }, 0) / valid.length : 0;

    if (valid.length < 3) {
      return { type: { code: 'unknown', name: '待评估', desc: '数据不足，先填完身高体重和至少两项运动数据，才能判定类型。' }, avg: 0, weak: [] };
    }
    var type = { code: 'newbie', name: '起步型训练者', desc: '基础指标大多偏弱，先把力量与动作模式打牢，进步会很快。' };
    if (rsi >= 5 && strength <= 4) type = { code: 'elastic', name: '弹性型', desc: '弹性反应是最大优势，适合高频低量弹跳，注意控制总量防过劳。' };
    else if (strength >= 4 && power >= 4) type = { code: 'power', name: '力量爆发型', desc: '力量与爆发都在线，缺的是专项技术细化与赛季化安排。' };
    else if (power >= 4 && power > strength) type = { code: 'explosive', name: '爆发主导型', desc: '爆发力突出、力量相对弱，补力量能再上一档。' };
    else if (strength >= 4) type = { code: 'strong', name: '力量主导型', desc: '力量底子好，把力量转成起跳速度是接下来的重点。' };
    else if (rsi >= 4) type = { code: 'elastic', name: '弹性型', desc: '弹性反应好，适合高频低量弹跳，注意控制总量防过劳。' };
    else if (avg >= 3) type = { code: 'balanced', name: '均衡发展型', desc: '六项都在中上，缺的是明确方向，按短板优先补。' };

    if (bmi === 2) type.hint = '体重偏高，优先减脂，弹跳会自然上来';

    // 短板排序
    var short = steps.filter(function (s) { return s.grade > 0 && s.grade < 4; })
      .sort(function (a, b) { return a.grade - b.grade; })
      .map(function (s) { return s.title; });

    return { type: type, avg: avg, weak: short.slice(0, 3) };
  }

  function compute(profile) {
    var p = profile || {};
    var steps = [stepBMI(p), stepRSI(p), stepPower(p), stepStrength(p), stepTech(p), stepLoad(p)];
    var c = classify(steps);
    var summary = '六项里最需要补的是：' + (c.weak.length ? c.weak.join('、') : '暂无明显短板');
    return {
      version: 1,
      steps: steps,
      type: c.type,
      weak: c.weak,
      avgGrade: c.avg,
      summary: summary,
      profile: p,
      createdAt: null
    };
  }

  return { compute: compute, GRADE_TXT: GRADE_TXT };
})();
