-- 弹跳知识科普：公开视频库
create table if not exists public.knowledge_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  creator_name text,
  title text not null,
  note text,
  video_path text not null,
  cover_path text,
  duration_sec numeric,
  size_bytes bigint,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.knowledge_videos enable row level security;

drop policy if exists kv_read on public.knowledge_videos;
create policy kv_read on public.knowledge_videos for select using (published = true);

drop policy if exists kv_insert on public.knowledge_videos;
create policy kv_insert on public.knowledge_videos for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists kv_update on public.knowledge_videos;
create policy kv_update on public.knowledge_videos for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists kv_delete on public.knowledge_videos;
create policy kv_delete on public.knowledge_videos for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists kv_created_idx on public.knowledge_videos(created_at desc);

-- 创作者白名单（后续审核用；当前任何登录用户都可上传）
create table if not exists public.knowledge_creators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);
alter table public.knowledge_creators enable row level security;
drop policy if exists kc_read on public.knowledge_creators;
create policy kc_read on public.knowledge_creators for select using (auth.uid() = user_id);

-- 公开存储桶
insert into storage.buckets (id, name, public)
values ('knowledge', 'knowledge', true)
on conflict (id) do update set public = true;

drop policy if exists kn_read on storage.objects;
create policy kn_read on storage.objects for select using (bucket_id = 'knowledge');

drop policy if exists kn_write on storage.objects;
create policy kn_write on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists kn_update on storage.objects;
create policy kn_update on storage.objects for update to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists kn_delete on storage.objects;
create policy kn_delete on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge' and (storage.foldername(name))[1] = auth.uid()::text);
