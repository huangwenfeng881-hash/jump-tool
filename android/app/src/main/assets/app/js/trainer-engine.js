/**
 * Jump Tools · AI 弹跳训练师（免费模板引擎）
 * ------------------------------------------------------------
 * 纯前端规则引擎：根据用户输入（当前高度 / 目标 / 年龄 / 水平 / 每周天数 / 器械 / 伤病）
 * 生成个性化周训练计划。会员版走 LLM API（见 auth.js generatePlanWithLLM），
 * 未配置时自动回退到本引擎。暴露全局 window.JTRAINER。
 */
(function () {
  'use strict';

  // ---- 等级配置 ----
  var LEVELS = {
    beginner:     { min: 0, sets: 3, rest: '60-90s',   intensity: '自重为主 / 40-60% 1RM', plyo: '6-8',   label: '初级' },
    intermediate: { min: 1, sets: 4, rest: '90-120s',  intensity: '60-75% 1RM',            plyo: '8-10',  label: '中级' },
    advanced:     { min: 2, sets: 5, rest: '120-180s', intensity: '75-90% 1RM + 爆发力',    plyo: '10-12', label: '高级' }
  };

  // ---- 动作库 ----
  // min: 0=初级可用 1=中级起 2=高级；eq: 适用器械；tags: 训练标签
  var EX = [
    { name: '徒手深蹲',             eq: ['none'],      min: 0, tags: ['squat'],            note: '下蹲至大腿平行，脚跟不离地，全程控制' },
    { name: '高脚杯深蹲（哑铃）',   eq: ['dumbbell'],  min: 0, tags: ['squat'],            note: '胸前抱哑铃下蹲' },
    { name: '杠铃背蹲',             eq: ['barbell'],   min: 1, tags: ['squat'],            note: '大重量低次数，保护到位' },
    { name: '弹力带深蹲',           eq: ['bands'],     min: 0, tags: ['squat'],            note: '阻力带套于大腿上部' },
    { name: '靠墙静蹲',             eq: ['none'],      min: 0, tags: ['squat', 'kneeSafe'], note: '大腿平行地面，30-60s' },
    { name: '杠铃硬拉',             eq: ['barbell'],   min: 1, tags: ['hinge'],            note: '髋铰链发力，背部中立' },
    { name: '哑铃罗马尼亚硬拉',     eq: ['dumbbell'],  min: 0, tags: ['hinge'],            note: '俯身感受腘绳肌拉伸' },
    { name: '弹力带硬拉',           eq: ['bands'],     min: 0, tags: ['hinge'],            note: '轻阻力，体会伸髋' },
    { name: '杠铃臀推',             eq: ['barbell'],   min: 1, tags: ['hinge'],            note: '顶峰收缩 2 秒' },
    { name: '臀桥',                 eq: ['none', 'dumbbell'], min: 0, tags: ['hinge', 'backSafe'], note: '臀部发力顶起' },
    { name: '单腿臀桥',             eq: ['none'],      min: 1, tags: ['hinge'],            note: '单腿支撑，臀部发力' },
    { name: '弓步蹲',               eq: ['none'],      min: 0, tags: ['unilateral'],       note: '保持躯干直立' },
    { name: '哑铃箭步蹲',           eq: ['dumbbell'],  min: 0, tags: ['unilateral'],       note: '控制下放' },
    { name: '保加利亚分腿蹲',       eq: ['dumbbell', 'barbell'], min: 1, tags: ['unilateral', 'kneeSafe'], note: '后脚垫高，前腿主导' },
    { name: '台阶登阶',             eq: ['none', 'dumbbell'], min: 0, tags: ['unilateral', 'kneeSafe'], note: '慢速控制下放' },
    { name: '原地纵跳',             eq: ['none'],      min: 0, tags: ['plyo'],             note: '全力起跳，落地缓冲' },
    { name: '深蹲跳',               eq: ['none', 'dumbbell'], min: 1, tags: ['plyo'],       note: '深蹲位爆发跳起' },
    { name: '抱膝跳',               eq: ['none'],      min: 1, tags: ['plyo'],             note: '跳起收膝抱膝' },
    { name: '跳箱',                 eq: ['none'],      min: 1, tags: ['plyo'],             note: '软着陆，选择安全高度' },
    { name: '连续跨步跳',           eq: ['none'],      min: 1, tags: ['plyo'],             note: '连续向前跨步跳' },
    { name: '弹力带阻力纵跳',       eq: ['bands'],     min: 1, tags: ['plyo'],             note: '带阻力爆发跳起' },
    { name: '杠铃蹲跳（轻重量）',   eq: ['barbell'],   min: 1, tags: ['plyo'],             note: '轻重量快速蹲跳，落地缓冲' },
    { name: '提踵',                 eq: ['none', 'dumbbell'], min: 0, tags: ['calf'],       note: '慢放快上' },
    { name: '杠铃提踵',             eq: ['barbell'],   min: 1, tags: ['calf'],             note: '幅度充分' },
    { name: '平板支撑',             eq: ['none'],      min: 0, tags: ['core'],             note: '30-60s' },
    { name: '侧平板',               eq: ['none'],      min: 0, tags: ['core'],             note: '每侧 30s' },
    { name: '死虫式',               eq: ['none'],      min: 0, tags: ['core', 'backSafe'],  note: '腰部贴地，对侧伸展' },
    { name: '鸟狗式',               eq: ['none'],      min: 0, tags: ['core', 'backSafe'],  note: '对侧手脚缓慢伸展' },
    { name: '悬垂举腿',             eq: ['none', 'bands'], min: 1, tags: ['core'],         note: '控制下放' },
    { name: '壶铃摆荡（哑铃替代）', eq: ['dumbbell'],  min: 1, tags: ['explosive', 'hinge'], note: '髋部爆发摆动' },
    { name: '高翻（进阶）',         eq: ['barbell'],   min: 2, tags: ['explosive'],       note: '举重类爆发动作，循序渐进' },
    { name: '弹力带侧向走',         eq: ['bands'],     min: 0, tags: ['hip', 'kneeSafe'],   note: '保持半蹲侧向移动' }
  ];

  // ---- 伤病排除 / 提示 ----
  var INJURY = {
    none:  { exclude: [], cautions: [] },
    knee:  { exclude: ['plyo', 'explosive'], cautions: ['膝关节不适：减少跳跃训练量，落地务必缓冲，可多练靠墙静蹲、保加利亚分腿蹲、台阶登阶等低冲击动作'] },
    ankle: { exclude: ['plyo', 'explosive'], cautions: ['踝关节不适：避免高冲击跳跃，加强提踵与踝周稳定训练'] },
    back:  { exclude: ['hinge', 'explosive'], cautions: ['腰部不适：避免大重量硬拉与爆发性举重，强化核心与臀桥等无冲击动作'] }
  };

  // 伤病时把跳跃/爆发/硬拉槽位替换为低冲击安全动作，避免出现空训练日
  var TRANSFORM = {
    knee:  { plyo: 'kneeSafe', explosive: 'kneeSafe' },
    ankle: { plyo: 'kneeSafe', explosive: 'kneeSafe' },
    back:  { plyo: 'core', explosive: 'core', hinge: 'core' }
  };

  // ---- 周计划模板（按每周天数）----
  var SCHEDULES = {
    1: [{ title: '全身力量 + 跳跃技术', slots: ['squat', 'hinge', 'plyo', 'core'] }],
    2: [
      { title: '下肢力量', slots: ['squat', 'hinge', 'unilateral'] },
      { title: '跳跃爆发 + 核心', slots: ['plyo', 'calf', 'core'] }
    ],
    3: [
      { title: '深蹲日', slots: ['squat', 'unilateral', 'calf'] },
      { title: '后链日', slots: ['hinge', 'hinge'] },
      { title: '跳跃日', slots: ['plyo', 'plyo', 'core'] }
    ],
    4: [
      { title: '深蹲日', slots: ['squat', 'squat', 'calf'] },
      { title: '硬拉/后链日', slots: ['hinge', 'hinge', 'core'] },
      { title: '爆发力日', slots: ['explosive', 'plyo'] },
      { title: '跳跃技术日', slots: ['plyo', 'calf', 'core'] }
    ],
    5: [
      { title: '深蹲日', slots: ['squat', 'unilateral'] },
      { title: '后链日', slots: ['hinge', 'hinge'] },
      { title: '爆发力日', slots: ['explosive', 'plyo'] },
      { title: '跳跃技术日', slots: ['plyo', 'calf'] },
      { title: '核心 + 灵活恢复', slots: ['core', 'core'] }
    ],
    6: [
      { title: '深蹲日', slots: ['squat', 'squat'] },
      { title: '后链日', slots: ['hinge', 'hinge', 'calf'] },
      { title: '爆发力日', slots: ['explosive', 'plyo'] },
      { title: '跳跃技术日', slots: ['plyo', 'plyo'] },
      { title: '单腿 + 核心日', slots: ['unilateral', 'core'] },
      { title: '灵活恢复日', slots: ['core', 'calf'] }
    ]
  };

  var EQ_LABEL = { none: '徒手', dumbbell: '哑铃', barbell: '杠铃', bands: '弹力带' };

  function hasEq(ex, eqs) {
    return ex.eq.some(function (e) { return eqs.indexOf(e) >= 0; });
  }

  function repText(tag, level, ex) {
    if (ex.tags.indexOf('explosive') >= 0) return '3-5';
    if (tag === 'plyo') return level.plyo;
    if (tag === 'calf') return '15-20';
    if (tag === 'core') return '30-60s';
    if (level.min === 0) return '12-15';
    if (level.min === 1) return '8-12';
    return '6-10';
  }

  // 从动作库挑选动作
  function pickEx(tag, level, eqs, excludes, used) {
    var pool = EX.filter(function (ex) {
      return ex.tags.indexOf(tag) >= 0 &&
        ex.min <= level.min &&
        hasEq(ex, eqs) &&
        excludes.indexOf(tag) < 0 &&
        used.indexOf(ex.name) < 0;
    });
    if (!pool.length && tag === 'explosive') {
      // 无爆发器械时回退到跳跃类
      return pickEx('plyo', level, eqs, excludes, used);
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }

  function buildSchedule(input, level, eqs, excludes) {
    var tr = TRANSFORM[input.injury] || {};
    return SCHEDULES[input.days].map(function (day, i) {
      var used = []; // 去重范围限定在单日，伤病时动作池小也能排满
      var exercises = [];
      day.slots.forEach(function (tag) {
        var real = tr[tag] || tag;
        var ex = pickEx(real, level, eqs, excludes, used);
        if (!ex) return;
        used.push(ex.name);
        exercises.push({
          name: ex.name,
          sets: level.sets,
          reps: repText(real, level, ex),
          rest: real === 'plyo' || real === 'explosive' ? '60-90s' : level.rest,
          note: ex.note + (ex.tags.indexOf('explosive') >= 0 ? '（爆发力动作，注重质量）' : '')
        });
      });
      // 兜底：极端情况下当日为空时，用低冲击动作补足
      if (!exercises.length) {
        var fallback = pickEx('core', level, eqs, excludes, used) ||
          pickEx('kneeSafe', level, eqs, excludes, used) ||
          pickEx('calf', level, eqs, excludes, used);
        if (fallback) {
          used.push(fallback.name);
          exercises.push({
            name: fallback.name,
            sets: level.sets,
            reps: repText('core', level, fallback),
            rest: level.rest,
            note: fallback.note
          });
        }
      }
      return { day: i + 1, title: day.title, exercises: exercises };
    });
  }

  function buildCautions(input) {
    var c = (INJURY[input.injury] || INJURY.none).cautions.slice();
    if (input.age > 0 && input.age < 16) c.push('年龄较小：以自重技术训练为主，避免大重量与高强度跳跃');
    if (input.age > 50) c.push('年龄偏大：增加热身与恢复时间，降低冲击量，关注关节感受');
    return c;
  }

  function buildProgression(level) {
    if (level.min === 0) return '前两周以建立动作模式为主；第三周起每 1-2 周给下肢力量动作增加 1-2 次或小重量，跳跃动作在保证质量的前提下增加高度。';
    if (level.min === 1) return '每周给主要力量动作增加 2.5-5kg（或 2-5% 负重），跳跃日记录并尝试突破个人最佳高度；每 4 周安排一次减量周。';
    return '采用线性周期：力量周(大重量低次数) → 爆发周(爆发力+跳跃) 交替；每月评估一次纵跳高度调整计划。';
  }

  // ---- 生成计划 ----
  function generate(input) {
    input = input || {};
    var level = LEVELS[input.level] || LEVELS.beginner;
    var eqs = (input.equipment && input.equipment.length) ? input.equipment : ['none'];
    var excludes = (INJURY[input.injury] || INJURY.none).exclude;

    var cur = parseFloat(input.currentHeight) || 0;
    var goal = parseFloat(input.goalHeight) || 0;
    var goalText = goal > cur
      ? ('当前 ' + cur + 'cm → 目标 ' + goal + 'cm（需提升 ' + (goal - cur) + 'cm）')
      : ('当前弹跳 ' + (cur || '--') + 'cm，目标提升');
    var eqLabel = eqs.map(function (e) { return EQ_LABEL[e]; }).join(' / ');
    var injLabel = input.injury && input.injury !== 'none' ? ' · 伤病：' + input.injury : '';

    var plan = {
      title: '四周弹跳提升训练计划',
      goal: goalText,
      levelLabel: level.label,
      days: input.days,
      equipment: eqLabel,
      age: input.age,
      injury: input.injury,
      schedule: buildSchedule(input, level, eqs, excludes),
      progression: buildProgression(level),
      cautions: buildCautions(input)
    };
    plan.summary = plan.levelLabel + '水平 · 每周' + plan.days + '练 · 器械：' + plan.equipment + injLabel;
    return plan;
  }

  window.JTRAINER = { generate: generate, LEVELS: LEVELS };
})();
