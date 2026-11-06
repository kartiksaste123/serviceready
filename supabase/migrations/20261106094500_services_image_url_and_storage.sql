-- Service cover images + public storage bucket
alter table public.services
  add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-covers',
  'service-covers',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists service_covers_public_read on storage.objects;
create policy service_covers_public_read on storage.objects
  for select using (bucket_id = 'service-covers');

drop policy if exists service_covers_anon_write on storage.objects;
create policy service_covers_anon_write on storage.objects
  for insert with check (bucket_id = 'service-covers');

drop policy if exists service_covers_anon_update on storage.objects;
create policy service_covers_anon_update on storage.objects
  for update using (bucket_id = 'service-covers') with check (bucket_id = 'service-covers');

drop policy if exists service_covers_anon_delete on storage.objects;
create policy service_covers_anon_delete on storage.objects
  for delete using (bucket_id = 'service-covers');
