insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-avatars',
  'client-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Clients upload own avatar photos'
  ) then
    create policy "Clients upload own avatar photos"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'client-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Clients view own avatar photos'
  ) then
    create policy "Clients view own avatar photos"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'client-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Clients update own avatar photos'
  ) then
    create policy "Clients update own avatar photos"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'client-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
      with check (
        bucket_id = 'client-avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      );
  end if;
end $$;