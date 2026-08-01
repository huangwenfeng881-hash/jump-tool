-- ============================================================
-- Jump Tools · 新增表：问题反馈 feedback + 训练计划 training_plans
-- 使用方法：Supabase 控制台 → SQL Editor → 全选本文件内容复制粘贴 → Run
-- 本脚本只新增，不改动已有表（jump_records / barbell_records 数据保留）
-- ============================================================

-- 问题反馈表：允许未登录匿名提交
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid null references auth.users(id) on delete set null,
  fb_type    text not null default '问题反馈',
  title      text not null,
  content    text not null,
  contact    text,
  status     text not null default 'open',
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
-- 允许任何人（含未登录）提交
drop policy if exists "feedback_insert_any" on public.feedback;
create policy "feedback_insert_any" on public.feedback
  for insert with check (true);
-- 读取权限仅限后台管理员（Supabase 控制台 / service_role），前端不开放读取

-- 训练计划表：AI 训练师生成，RLS 仅本人可读写删
create table if not exists public.training_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  summary    text,
  plan_json  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.training_plans enable row level security;
drop policy if exists "training_plans_select_own" on public.training_plans;
create policy "training_plans_select_own" on public.training_plans
  for select using (auth.uid() = user_id);
drop policy if exists "training_plans_insert_own" on public.training_plans;
create policy "training_plans_insert_own" on public.training_plans
  for insert with check (auth.uid() = user_id);
drop policy if exists "training_plans_delete_own" on public.training_plans;
create policy "training_plans_delete_own" on public.training_plans
  for delete using (auth.uid() = user_id);
create index if not exists idx_training_plans_user
  on public.training_plans(user_id, created_at desc);
