-- ============================================================
-- Vertrise跃升 · 增量：杠铃记录表新增「重量」列
-- 在 Supabase SQL Editor 执行即可（幂等，可重复执行）
-- ============================================================
alter table public.barbell_records
  add column if not exists weight numeric;
