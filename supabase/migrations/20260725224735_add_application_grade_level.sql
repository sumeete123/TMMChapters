alter table public.chapter_applications
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

grant insert (grade_level) on table public.chapter_applications to authenticated;

comment on column public.chapter_applications.grade_level is
  'Self-reported grade or education level of the primary chapter lead.';
