-- ============================================================
-- Vertrise跃升 · 增量：弹跳记录表新增「测试类型」与「箱高」列
-- 在 Supabase SQL Editor 执行即可（幂等，可重复执行）
-- ============================================================
alter table public.jump_records
  add column if not exists test_type text default '助跑起跳';

alter table public.jump_records
  add column if not exists box_height numeric;
