alter table public.chapter_event_records
  add column photo_paths text[] not null default '{}'::text[];

alter table public.chapter_event_records
  add constraint chapter_event_records_photo_limit
  check (cardinality(photo_paths) <= 6);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chapter-event-photos',
  'chapter-event-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Chapters can upload their own event photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chapter-event-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_chapter_id())::text
  )
);

create policy "Chapters can view their own event photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'chapter-event-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_chapter_id())::text
  )
);

create policy "Chapters can remove their own event photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chapter-event-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select public.current_chapter_id())::text
  )
);
