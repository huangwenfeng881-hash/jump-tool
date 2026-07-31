-- ============================================================
-- Jump Tools · Supabase 建表 + 行级安全(RLS) 脚本
-- 使用方法：Supabase 控制台 → SQL Editor → 全选本文件内容复制粘贴 → Run
--
-- 注意：脚本开头会删除已存在的同名表再重建。
--       若你之前已有 jump_records / barbell_records 数据，请先备份，
--       新项目一般无数据，可放心执行。
-- ============================================================

-- 清理旧表（结构可能不完整，先删后建保证一次成功）
drop table if exists public.jump_records cascade;
drop table if exists public.barbell_records cascade;

-- 弹跳记录表：用户每次保存的弹跳高度 / 腾空时间
create table public.jump_records (
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
create table public.barbell_records (
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
