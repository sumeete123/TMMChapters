-- Applications still ask for Instagram permission, but no longer collect a
-- photo during submission. Existing photo columns remain for historical data;
-- new applications leave them null and never touch application-photo storage.

alter table public.chapter_applications
  add column if not exists instagram_photo_consent boolean not null default false;

drop policy if exists "Authenticated users can submit one chapter application"
  on public.chapter_applications;

create policy "Authenticated users can submit one chapter application"
on public.chapter_applications
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and submitted_by = (select auth.uid())
  and status = 'new'
  and internal_notes is null
  and char_length(btrim(contact_name)) between 2 and 120
  and char_length(btrim(contact_email)) between 3 and 254
  and instagram_photo_consent = true
);

grant insert (instagram_photo_consent)
on table public.chapter_applications to authenticated;
