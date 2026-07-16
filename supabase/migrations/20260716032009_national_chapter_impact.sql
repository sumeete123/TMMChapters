create table if not exists public.national_chapter_impact (
  id text primary key default 'national' check (id = 'national'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  students_taught integer not null check (students_taught >= 0),
  students_taught_is_minimum boolean not null default true,
  instructional_hours numeric(8, 2) not null check (instructional_hours >= 0),
  volunteer_count integer not null check (volunteer_count >= 0),
  session_count integer not null check (session_count >= 0),
  chapter_count integer not null check (chapter_count >= 1),
  as_of_date date not null default current_date,
  updated_at timestamptz not null default now()
);

comment on table public.national_chapter_impact is
  'Founding impact baseline for the TMM National Chapter. Aggregate-only data; no volunteer or student PII.';

alter table public.national_chapter_impact enable row level security;
revoke all on public.national_chapter_impact from anon, authenticated;
grant select on public.national_chapter_impact to service_role;

insert into public.national_chapter_impact (
  id,
  name,
  students_taught,
  students_taught_is_minimum,
  instructional_hours,
  volunteer_count,
  session_count,
  chapter_count,
  as_of_date
) values (
  'national',
  'TMM National Chapter',
  65,
  true,
  36,
  19,
  36,
  1,
  current_date
)
on conflict (id) do update set
  name = excluded.name,
  students_taught = excluded.students_taught,
  students_taught_is_minimum = excluded.students_taught_is_minimum,
  instructional_hours = excluded.instructional_hours,
  volunteer_count = excluded.volunteer_count,
  session_count = excluded.session_count,
  chapter_count = excluded.chapter_count,
  as_of_date = excluded.as_of_date,
  updated_at = now();

alter table public.weekly_reports
  add column if not exists instructional_hours numeric(7, 2) not null default 0
  check (instructional_hours >= 0 and instructional_hours <= 1000);

alter table public.weekly_reports
  drop column if exists mentors_present;
