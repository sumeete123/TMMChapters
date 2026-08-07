-- Applications still ask for Instagram permission, but no longer collect a
-- photo during submission. Existing photo columns remain for historical data;
-- new applications leave them null and never touch application-photo storage.

alter table public.chapter_applications
  add column if not exists instagram_photo_consent boolean not null default false,
  add column if not exists grade_level text;

alter table public.chapter_applications
  drop constraint if exists chapter_applications_grade_level_valid;

alter table public.chapter_applications
  add constraint chapter_applications_grade_level_valid
  check (
    grade_level is null
    or grade_level in (
      '6th grade', '7th grade', '8th grade', '9th grade',
      '10th grade', '11th grade', '12th grade',
      'College or university', 'Other'
    )
  );

alter table public.chapter_applications
  add column if not exists submitted_by uuid references auth.users(id) on delete set null;

alter table public.chapter_applications
  alter column submitted_by set default auth.uid();

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

revoke all on table public.chapter_applications from anon;
revoke insert on table public.chapter_applications from authenticated;

grant insert (
  contact_name,
  contact_email,
  contact_phone,
  grade_level,
  additional_contacts,
  organization_name,
  location,
  chapter_scope,
  city,
  region,
  school_name,
  student_reach,
  why,
  instagram_photo_consent
) on table public.chapter_applications to authenticated;
