-- Chapter applications now require explicit permission to use the applicant's
-- photo on TMM's Instagram, plus the headshot itself. Consent is mandatory: the
-- insert policy rejects any application that does not carry both. Photos live in
-- a private bucket so administrators can review and download them, then delete
-- the file to reclaim storage while keeping the application record intact.

alter table public.chapter_applications
  add column if not exists instagram_photo_consent boolean not null default false,
  add column if not exists photo_path text,
  add column if not exists photo_uploaded_at timestamptz,
  add column if not exists photo_deleted_at timestamptz;

alter table public.chapter_applications
  drop constraint if exists chapter_applications_photo_path_valid;

alter table public.chapter_applications
  add constraint chapter_applications_photo_path_valid check (
    photo_path is null or char_length(photo_path) between 3 and 500
  );

comment on column public.chapter_applications.instagram_photo_consent is
  'Applicant granted The Mastery Mentors permission to use their photo on Instagram and other TMM social media. Required to submit an application.';
comment on column public.chapter_applications.photo_path is
  'Object path in the private chapter-application-photos bucket. Set to null once an administrator downloads the photo and deletes the stored file.';
comment on column public.chapter_applications.photo_deleted_at is
  'When an administrator removed the stored photo after downloading it.';

-- Applications submitted before this feature keep their historical records; the
-- requirement is enforced going forward through the insert policy below.
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
  and photo_path is not null
  and photo_path like ((select auth.uid())::text || '/%')
  and photo_deleted_at is null
);

grant insert (
  instagram_photo_consent,
  photo_path,
  photo_uploaded_at
) on table public.chapter_applications to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chapter-application-photos',
  'chapter-application-photos',
  false,
  5242880,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Applicants can upload their own application photo" on storage.objects;
drop policy if exists "Applicants and admins can view application photos" on storage.objects;
drop policy if exists "Applicants and admins can remove application photos" on storage.objects;

create policy "Applicants can upload their own application photo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chapter-application-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Applicants and admins can view application photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'chapter-application-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);

create policy "Applicants and admins can remove application photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chapter-application-photos'
  and (
    (select public.is_admin())
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);
