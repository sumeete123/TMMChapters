-- Chapter applications now record the grade level of the primary lead so
-- reviewers can tell whether a chapter will be run by a middle school, high
-- school, or college student before approving it.

alter table public.chapter_applications
  add column if not exists contact_grade text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_contact_grade'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_contact_grade check (
        contact_grade is null
        or contact_grade in (
          '6th grade',
          '7th grade',
          '8th grade',
          '9th grade',
          '10th grade',
          '11th grade',
          '12th grade',
          'College',
          'Not currently a student'
        )
      );
  end if;
end $$;

-- Column-level insert grants replaced the table-wide grant in
-- 20260716025513_harden_anonymous_application_submissions.sql, so the new
-- column has to be granted explicitly or the application form cannot write it.
grant insert (contact_grade) on table public.chapter_applications to authenticated;

comment on column public.chapter_applications.contact_grade is
  'Grade level the primary lead is in when they applied; null for applications submitted before the field existed.';
