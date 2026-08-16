-- ============================================================
-- Vertrise跃升 · AI 弹跳分析纠错反馈（ai-jump.html 页面上传）
-- 使用方法：Supabase 控制台 → SQL Editor → 全选本文件内容复制粘贴 → Run
-- 幂等：可重复执行（IF NOT EXISTS / DROP POLICY 先删）
-- ============================================================

-- ---------- 1. 分析纠错反馈表 ----------
-- 用户在 AI 弹跳分析页认为结果不准时提交：分析指标 + 实际情况 + （可选）视频
-- 允许未登录提交文字说明；上传视频需登录（存到下方私有存储桶）
create table if not exists public.analysis_feedback (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid null references auth.users(id) on delete set null,
  video_name        text,                -- 视频文件名
  video_path        text,                -- 上传到 storage 桶 jump-feedback 的路径
  video_sec         numeric,             -- 视频时长（秒）
  fps               numeric,             -- 检测帧率
  frames            int,                 -- 视频总帧数
  metrics           jsonb not null default '{}'::jsonb, -- 本次 AI 识别出的全部指标
  actual_liftoff    numeric,             -- 用户填写的实际离地时刻（秒）
  actual_landing    numeric,             -- 用户填写的实际落地时刻（秒）
  actual_height_cm  numeric,             -- 用户填写的实际弹跳高度（cm）
  issue             text,                -- 问题描述
  status            text not null default 'open' check (status in ('open','reviewed','fixed')),
  created_at        timestamptz not null default now()
);
alter table public.analysis_feedback enable row level security;
-- 允许任何人（含未登录）提交；读取仅限后台管理员（Supabase 控制台 / service_role）
drop policy if exists "analysis_feedback_insert_any" on public.analysis_feedback;
create policy "analysis_feedback_insert_any" on public.analysis_feedback
  for insert with check (true);
create index if not exists idx_analysis_feedback_created
  on public.analysis_feedback(created_at desc);

-- ---------- 2. 反馈视频存储桶（私有桶） ----------
-- 路径约定：{用户id}/{时间戳}.mp4，RLS 只允许本人上传/读取自己的目录
insert into storage.buckets (id, name, public)
values ('jump-feedback', 'jump-feedback', false)
on conflict (id) do nothing;

drop policy if exists "jump_feedback_upload_own" on storage.objects;
create policy "jump_feedback_upload_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'jump-feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "jump_feedback_read_own" on storage.objects;
create policy "jump_feedback_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'jump-feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 3. 推广来源查询（配合 login.html 的推广邀请码字段）
-- 推广关系已由现有 invite_codes / invite_redemptions 表记录：
--   invite_codes.created_by        = 推广人（谁发的码）
--   invite_redemptions.code+user_id = 被推广人（谁用码注册/兑换）
-- 站长在 SQL Editor 执行下面这条即可看清每个推广人带来了谁：
-- ============================================================
-- select ic.code                               as 邀请码,
--        u.email                               as 推广人邮箱,
--        iu.email                              as 被推广人邮箱,
--        ir.redeemed_at                        as 兑换时间
-- from public.invite_codes ic
-- join auth.users u  on u.id = ic.created_by
-- left join public.invite_redemptions ir on ir.code = ic.code
-- left join auth.users iu on iu.id = ir.user_id
-- order by ir.redeemed_at desc nulls last;

-- 推广人维度汇总：
-- select u.email as 推广人邮箱, count(ir.id) as 带来人数
-- from public.invite_codes ic
-- join auth.users u on u.id = ic.created_by
-- left join public.invite_redemptions ir on ir.code = ic.code
-- group by u.email
-- order by 带来人数 desc;
