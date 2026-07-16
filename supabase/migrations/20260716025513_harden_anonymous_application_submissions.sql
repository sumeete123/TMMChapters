-- Require an authenticated Supabase identity for applications and prevent a
-- single anonymous identity from flooding the review queue.

alter table public.chapter_applications
  add column if not exists submitted_by uuid references auth.users(id) on delete set null;

alter table public.chapter_applications
  alter column submitted_by set default auth.uid();

create unique index if not exists chapter_applications_submitted_by_unique_idx
  on public.chapter_applications (submitted_by)
  where submitted_by is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_input_lengths'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_input_lengths check (
        char_length(btrim(contact_name)) between 2 and 120
        and char_length(btrim(contact_email)) between 3 and 254
        and char_length(btrim(organization_name)) between 2 and 160
        and char_length(btrim(location)) between 2 and 160
        and (contact_phone is null or char_length(contact_phone) <= 40)
        and (student_reach is null or char_length(student_reach) <= 120)
        and (why is null or char_length(why) <= 5000)
        and (internal_notes is null or char_length(internal_notes) <= 4000)
      );
  end if;
end $$;

drop policy if exists "Anyone can submit a chapter application"
  on public.chapter_applications;
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
);

revoke all on table public.chapter_applications from anon;
revoke insert on table public.chapter_applications from authenticated;
grant insert (
  contact_name,
  contact_email,
  contact_phone,
  organization_name,
  location,
  student_reach,
  why,
  additional_contacts
) on table public.chapter_applications to authenticated;

comment on column public.chapter_applications.submitted_by is
  'Supabase Auth identity that submitted the application; used for abuse prevention and never trusted for admin authorization.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'weekly_reports_sane_counts'
      and conrelid = 'public.weekly_reports'::regclass
  ) then
    alter table public.weekly_reports
      add constraint weekly_reports_sane_counts check (
        sessions_held between 0 and 1000
        and students_served between 0 and 100000
        and mentors_present between 0 and 1000
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'weekly_reports_text_lengths'
      and conrelid = 'public.weekly_reports'::regclass
  ) then
    alter table public.weekly_reports
      add constraint weekly_reports_text_lengths check (
        (highlights is null or char_length(highlights) <= 4000)
        and (blockers is null or char_length(blockers) <= 4000)
        and (next_week_plan is null or char_length(next_week_plan) <= 4000)
        and (support_needed is null or char_length(support_needed) <= 4000)
      );
  end if;
end $$;
