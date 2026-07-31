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
  AUTH_REDIRECT: ''
};
