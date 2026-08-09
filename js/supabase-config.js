/**
 * ============================================================
 * Jump Tools · Supabase 配置（占位文件，不含任何真实密钥）
 * ============================================================
 *
 * 【使用步骤】（需你手动完成，前端无法代做）
 *
 * 1. 前往 https://supabase.com 创建项目，复制：
 *    - Project URL（形如 https://xxxx.supabase.co）
 *    - anon public key（公开 API Key，非机密，可安全放在前端）
 *    分别填入下方 SUPABASE_URL / SUPABASE_ANON_KEY 即可。
 *
 * 2. 打开 Supabase 控制台 → SQL Editor，执行下方「建表 + 行级安全(RLS)」脚本，
 *    创建 jump_records / barbell_records 两张表。
 *    RLS 保证：每条数据只允许 user_id = 当前登录用户 时读写，他人数据不可见。
 *
 * 3.（可选，便于本地自测）Supabase 控制台 → Authentication → Providers → Email，
 *    关闭 "Confirm email"（邮箱确认），注册后即可立即登录；
 *    保持开启则需先点击邮件里的确认链接才能登录。
 *
 * 4.（可选）Cloudflare Workers 代理预留：
 *    国内直连 supabase.co 可能不稳定或存在跨域限制。后续部署 Worker 后，
 *    把 PROXY_URL 填为 Worker 地址（或直接修改 SUPABASE_URL），
 *    Worker 内将请求转发到真实 Supabase 即可，前端代码无需其他改动。
 *
 * ============================================================
 * 建表 + 行级安全 SQL（在 Supabase SQL Editor 中执行）
 * ============================================================

-- 弹跳记录表：用户每次保存的弹跳高度 / 腾空时间
create table if not exists public.jump_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  height_cm   numeric not null,
  flight_time numeric not null,
  created_at  timestamptz not null default now()
);
alter table public.jump_records enable row level security;
create policy "jump_records_select_own" on public.jump_records
  for select using (auth.uid() = user_id);
create policy "jump_records_insert_own" on public.jump_records
  for insert with check (auth.uid() = user_id);
create policy "jump_records_delete_own" on public.jump_records
  for delete using (auth.uid() = user_id);
create index if not exists idx_jump_records_user
  on public.jump_records(user_id, created_at desc);

-- 杠铃速度记录表：统计指标 + 完整速度曲线(jsonb)
create table if not exists public.barbell_records (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  peak_speed         numeric,
  avg_concentric     numeric,
  avg_eccentric      numeric,
  concentric_time    numeric,
  eccentric_time     numeric,
  total_displacement numeric,
  curve_data         jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now()
);
alter table public.barbell_records enable row level security;
create policy "barbell_records_select_own" on public.barbell_records
  for select using (auth.uid() = user_id);
create policy "barbell_records_insert_own" on public.barbell_records
  for insert with check (auth.uid() = user_id);
create policy "barbell_records_delete_own" on public.barbell_records
  for delete using (auth.uid() = user_id);
create index if not exists idx_barbell_records_user
  on public.barbell_records(user_id, created_at desc);

 * ============================================================
 */

window.JTConfig = {
  // 你的 Supabase 项目 URL（必填，不要带 /rest/v1/ 后缀，SDK 会自动拼接）
  SUPABASE_URL: 'https://iszxoejqhjpucczfsdfo.supabase.co',

  // 你的 Supabase anon public key（必填；公开密钥，绝非 service_role 密钥）
  SUPABASE_ANON_KEY: 'sb_publishable_34izFFx3h1vs_NnJkfBsEw_7rWbpawp',

  // Cloudflare Workers 代理地址（可选，预留）。留空则直连 Supabase。
  PROXY_URL: '',

  // 忘记密码邮件中的跳转地址（可选）。需先在 Supabase 后台
  // Authentication → URL Configuration 中把该地址加入白名单。
  AUTH_REDIRECT: '',

  // ============================================================
  // AI 弹跳训练师 · LLM（会员版）配置
  // - 免费用户：使用 js/trainer-engine.js 本地模板引擎生成计划，无需任何 key。
  // - 会员(PRO)：设置登录用户 metadata 中 plan:"pro"
  //   （Supabase 后台 → Authentication → Users → 编辑元数据），
  //   并部署 Cloudflare Worker 后把其地址填入 LLM_API_URL。
  //   真实 LLM API key（DeepSeek/OpenAI 等）存放在 Worker 端，前端不接触任何密钥。
  // ============================================================
  LLM_API_URL: '',

  // ============================================================
  // 人体动作分析（MediaPipe Pose + AI 评估）配置
  // - MEDIAPIPE_BASE：MediaPipe Pose 资源镜像地址。默认 jsdelivr，
  //   国内加载慢时可换 npmmirror 等镜像（保持以 / 结尾）。
  // - POSE_API_URL：AI 动作评估后端地址（Cloudflare Workers 预留）。
  //   前端点击「AI动作评估」上传关键帧图片 + 姿态时序 JSON 到该地址，
  //   由服务端 AI 输出动作缺陷点评与训练建议（AI 不参与实时跟踪）。
  //   未配置时「AI动作评估」按钮保持禁用。
  // ============================================================
  POSE_API_URL: '',
  MEDIAPIPE_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/',
  // 动作分析抽帧分辨率（最长边 px）。越大对画面中较小的人物识别越好，但更慢。
  POSE_ANALYZE_MAXDIM: 640,

  // 视频导入最大时长（秒）。超出将提示过长。
  MAX_VIDEO_SEC: 300,

  // ============================================================
  // 智谱 GLM（AI 生成训练计划 / AI 动作评估）
  // - GLM_MODEL：模型名（默认 glm-4.7-flash）。
  // - GLM_API_KEY：你的智谱开放平台 API Key（https://open.bigmodel.cn）。
  //   ⚠️ 这是你的密钥，请勿提交到公开仓库！可用环境变量/Worker 注入。
  // - GLM_API_URL：直连智谱接口；国内直连若被 CORS 拦截，
  //   可部署 Cloudflare Worker 代理后把此处换成 Worker 地址。
  // ============================================================
  GLM_MODEL: 'glm-4.7-flash',
  // 模型自动切换列表：当第一个模型「访问量过大」或「推理类模型未产出正式内容」时，
  // 自动依次尝试后续可用模型。glm-4-flash 为非推理快速模型，稳定返回正式内容，
  // 故排在 glm-4.5-flash（推理模型，可能只返回 reasoning_content）之前。
  GLM_MODELS: ['glm-4.7-flash', 'glm-4-flash', 'glm-4.5-flash'],

  // GLM API Key：不存明文，以 AES-256-GCM 密文保存（运行时由 js/glm-crypto.js 解密）。
  // 密文 = base64(iv || ciphertext || tag)。如需更换 key，运行:
  //   node tools/encrypt-glm-key.js "<明文key>" "<口令>"  → 粘贴结果到下方。
  GLM_API_KEY_ENC: 'SQqZ4FfEdJ2z+XKOmho0uby8fmSWrYLPRsyKq0PB377Dr1nzY6xOPJtvpIdJ7Y0DDjWR7+9adez7GjHinQ1pK3B+2xfs3CGRhktESvE=',
  GLM_CRYPTO_PASSPHRASE: 'V3rtr1se.GLm.K3y#2026',
  // 兼容字段（已弃用）：如需旧版直连明文 key，请改用上方密文方式。
  GLM_API_KEY: 'd56cac79e59e4296b3239370560041cf.jSD9s7lYXAIZmc4r',
  GLM_API_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
};
