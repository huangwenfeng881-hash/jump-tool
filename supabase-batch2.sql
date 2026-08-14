-- ============================================================
-- Vertrise跃升 · 第二批：公开成绩榜单（排行榜）
-- 使用方法：Supabase 控制台 → SQL Editor → 全选本文件内容复制粘贴 → Run
-- 只新增/扩展，不改动已有数据
-- ============================================================

-- 1) user_profiles 增加「昵称」与「公开榜单开关」（默认关闭）
alter table public.user_profiles
  add column if not exists nickname text;
alter table public.user_profiles
  add column if not exists public_show boolean not null default false;

-- 2) 榜单 RPC：只返回「开启公开」且填了昵称的用户
--    - SECURITY DEFINER：以表所有者身份聚合，匿名/登录用户都能读，但只能拿到聚合结果
--    - 绝不返回邮箱、手机号等敏感字段；只给 昵称/站立摸高/最大原地/最大助跑
--    - 排序：按最大助跑弹跳高度降序
create or replace function public.get_leaderboard()
returns table (
  nickname    text,
  reach_cm    numeric,
  max_standing numeric,
  max_running  numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.nickname,
    p.reach_cm,
    (select max(j.height_cm) from public.jump_records j
      where j.user_id = p.user_id
        and j.test_type in ('原地起跳','无摆臂CMJ','有摆臂CMJ','无摆臂SJ','DJ')) as max_standing,
    (select max(j.height_cm) from public.jump_records j
      where j.user_id = p.user_id
        and j.test_type = '助跑起跳') as max_running
  from public.user_profiles p
  where p.public_show = true
    and p.nickname is not null and trim(p.nickname) <> ''
    and p.reach_cm is not null
  order by max_running desc nulls last;
$$;

-- 3) 允许所有人（含未登录）执行榜单查询
grant execute on function public.get_leaderboard() to anon, authenticated;

-- 4) RLS 约束说明（已在建表时生效，无需额外策略）：
--    - user_profiles 的 update 策略只允许 auth.uid() = user_id → 用户只能改自己的公开开关
--    - 榜单数据只能通过 get_leaderboard() 聚合读取，他人原始记录不可见、不可篡改
