-- 收紧发布权限：只有白名单创作者能上传
drop policy if exists kv_insert on public.knowledge_videos;
create policy kv_insert on public.knowledge_videos for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.knowledge_creators c where c.user_id = auth.uid())
  );

drop policy if exists kn_write on storage.objects;
create policy kn_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.knowledge_creators c where c.user_id = auth.uid())
  );

drop policy if exists kn_update on storage.objects;
create policy kn_update on storage.objects for update to authenticated
  using (
    bucket_id = 'knowledge'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.knowledge_creators c where c.user_id = auth.uid())
  );

-- 站长账号加入白名单
insert into public.knowledge_creators (user_id, email)
select id, email from auth.users where email = '3556029273@qq.com'
on conflict (user_id) do update set email = excluded.email;
