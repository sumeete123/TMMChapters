-- Chapters now email event photos to the national team instead of uploading
-- them, so the portal stores no image files at all. Storage was the fastest
-- path to the quota: 10 MB per file and six files per event record meant about
-- seventeen fully illustrated events would fill 1 GB.
--
-- Safe to drop outright: the bucket holds zero objects and no event record has
-- ever carried a photo path. Dropping the three policies is what actually
-- closes the upload path, since without them RLS denies every operation on the
-- bucket. The empty bucket row itself is left in place because Supabase blocks
-- direct deletes on storage tables; it is inert with no policies attached.

drop policy if exists "Chapters can upload their own event photos" on storage.objects;
drop policy if exists "Chapters can view their own event photos" on storage.objects;
drop policy if exists "Chapters can remove their own event photos" on storage.objects;

alter table public.chapter_event_records
  drop constraint if exists chapter_event_records_photo_limit;

alter table public.chapter_event_records
  drop column if exists photo_paths;
