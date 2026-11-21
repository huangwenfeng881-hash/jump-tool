-- 支持 B 站外链：视频存在 B 站，库里只存链接
alter table public.knowledge_videos
  add column if not exists platform text not null default 'storage',
  add column if not exists ext_url text,
  add column if not exists ext_id text,
  add column if not exists cover_url text;

alter table public.knowledge_videos alter column video_path drop not null;

drop policy if exists kv_insert on public.knowledge_videos;
create policy kv_insert on public.knowledge_videos for insert to authenticated
  with check (
    auth.uid() = user_id
    and (video_path is not null or ext_url is not null)
    and exists (select 1 from public.knowledge_creators c where c.user_id = auth.uid())
  );
