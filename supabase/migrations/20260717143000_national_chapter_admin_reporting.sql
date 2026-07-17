-- Expand the National Chapter baseline and keep its reporting controls admin-only.

alter table public.national_chapter_impact
  add column if not exists students_impacted integer not null default 0
  check (students_impacted >= 0);

update public.national_chapter_impact
set students_impacted = 195,
    students_taught = 65,
    students_taught_is_minimum = false,
    volunteer_count = 19,
    updated_at = now()
where id = 'national';
