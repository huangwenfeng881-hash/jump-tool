-- ============================================================
-- Vertrise跃升 · 第一批次新增：个人资料 user_profiles + 训练打卡 checkins
-- 使用方法：Supabase 控制台 → SQL Editor → 全选本文件内容复制粘贴 → Run
-- 只新增，不改动已有表（jump_records / barbell_records 等数据保留）
-- ============================================================

-- 个人身体资料表：身高 / 站立摸高 / 体重 / 臂展（一人一行，主键=user_id）
create table if not exists public.user_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  height_cm   numeric,   -- 身高 cm
  reach_cm    numeric,   -- 站立摸高 cm
  weight_kg   numeric,   -- 体重 kg
  wingspan_cm numeric,   -- 臂展 cm
  updated_at  timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own" on public.user_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own" on public.user_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own" on public.user_profiles
  for update using (auth.uid() = user_id);

-- 训练打卡表：每天打卡一次（user_id + checkin_date 唯一），只存日期
create table if not exists public.checkins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  created_at   timestamptz not null default now(),
  unique (user_id, checkin_date)
);
alter table public.checkins enable row level security;
drop policy if exists "checkins_select_own" on public.checkins;
create policy "checkins_select_own" on public.checkins
  for select using (auth.uid() = user_id);
drop policy if exists "checkins_insert_own" on public.checkins;
create policy "checkins_insert_own" on public.checkins
  for insert with check (auth.uid() = user_id);
drop policy if exists "checkins_delete_own" on public.checkins;
create policy "checkins_delete_own" on public.checkins
  for delete using (auth.uid() = user_id);
create index if not exists idx_checkins_user
  on public.checkins(user_id, checkin_date desc);
