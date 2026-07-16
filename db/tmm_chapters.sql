-- TMMChapters schema for The Mastery Mentors chapter operations portal.
-- Run once in the Supabase SQL editor for project fvkkamxonsygjlhabsqb.
-- Admin authorization reads auth.users.app_metadata.role (never user_metadata).

create extension if not exists pgcrypto;

do $$ begin
  create type public.chapter_status as enum ('pending', 'active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('active', 'invited', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('open', 'in_progress', 'complete', 'archived');
exception when duplicate_object then null; end $$;

create table if not exists public.chapter_applications (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  contact_email text not null,
  organization_name text not null,
  location text not null,
  student_reach text,
  why text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'approved', 'declined')),
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  location text not null,
  description text,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  advisor_name text,
  advisor_email text,
  status public.chapter_status not null default 'pending',
  founded_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapter_members (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  role text not null default 'mentor' check (role in ('lead', 'mentor', 'advisor')),
  status public.member_status not null default 'invited',
  joined_at timestamptz not null default now(),
  unique (chapter_id, email)
);

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  week_start date not null,
  sessions_held integer not null default 0 check (sessions_held >= 0),
  students_served integer not null default 0 check (students_served >= 0),
  instructional_hours numeric(7, 2) not null default 0 check (instructional_hours >= 0 and instructional_hours <= 1000),
  completed_weekly_tasks boolean not null default false,
  highlights text,
  blockers text,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  unique (chapter_id, week_start)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_chapter_id uuid references public.chapters(id) on delete cascade,
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status public.task_status not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  link text,
  chapter_id uuid references public.chapters(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'), false);
$$;

alter table public.chapter_applications enable row level security;
alter table public.chapters enable row level security;
alter table public.chapter_members enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;

-- Explicit grants are required for tables created in SQL to be reachable through the Data API.
grant insert on public.chapter_applications to anon, authenticated;
grant select, update on public.chapter_applications to authenticated;
grant select, insert, update on public.chapters to authenticated;
grant select, insert, update on public.chapter_members to authenticated;
grant select, insert, update on public.weekly_reports to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert, update on public.events to authenticated;

drop policy if exists "Anyone can submit a chapter application" on public.chapter_applications;
create policy "Anyone can submit a chapter application"
  on public.chapter_applications for insert to anon, authenticated
  with check (char_length(contact_name) between 2 and 120 and position('@' in contact_email) > 1);

drop policy if exists "Admins can view chapter applications" on public.chapter_applications;
create policy "Admins can view chapter applications"
  on public.chapter_applications for select to authenticated using (public.is_admin());

drop policy if exists "Admins can update chapter applications" on public.chapter_applications;
create policy "Admins can update chapter applications"
  on public.chapter_applications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins and members can view chapters" on public.chapters;
create policy "Admins and members can view chapters"
  on public.chapters for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = chapters.id and member.user_id = (select auth.uid()) and member.status = 'active'
  ));

drop policy if exists "Admins can manage chapters" on public.chapters;
drop policy if exists "Admins can insert chapters" on public.chapters;
create policy "Admins can insert chapters"
  on public.chapters for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update chapters" on public.chapters;
create policy "Admins can update chapters"
  on public.chapters for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete chapters" on public.chapters;
create policy "Admins can delete chapters"
  on public.chapters for delete to authenticated
  using (public.is_admin());

drop policy if exists "Admins and members can view membership" on public.chapter_members;
create policy "Admins and members can view membership"
  on public.chapter_members for select to authenticated
  using (public.is_admin() or user_id = (select auth.uid()));

drop policy if exists "Admins can manage membership" on public.chapter_members;
drop policy if exists "Admins can insert membership" on public.chapter_members;
create policy "Admins can insert membership"
  on public.chapter_members for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update membership" on public.chapter_members;
create policy "Admins can update membership"
  on public.chapter_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete membership" on public.chapter_members;
create policy "Admins can delete membership"
  on public.chapter_members for delete to authenticated
  using (public.is_admin());

drop policy if exists "Members can view their reports" on public.weekly_reports;
create policy "Members can view their reports"
  on public.weekly_reports for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = weekly_reports.chapter_id and member.user_id = (select auth.uid()) and member.status = 'active'
  ));

drop policy if exists "Members can submit their reports" on public.weekly_reports;
create policy "Members can submit their reports"
  on public.weekly_reports for insert to authenticated
  with check (public.is_admin() or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = weekly_reports.chapter_id and member.user_id = (select auth.uid()) and member.status = 'active'
  ));

drop policy if exists "Members can update their reports" on public.weekly_reports;
create policy "Members can update their reports"
  on public.weekly_reports for update to authenticated
  using (public.is_admin() or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = weekly_reports.chapter_id and member.user_id = (select auth.uid()) and member.status = 'active'
  ))
  with check (public.is_admin() or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = weekly_reports.chapter_id and member.user_id = (select auth.uid()) and member.status = 'active'
  ));

drop policy if exists "Members can view assigned tasks" on public.tasks;
create policy "Members can view assigned tasks"
  on public.tasks for select to authenticated
  using (public.is_admin() or assigned_to_user_id = (select auth.uid()) or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = tasks.assigned_chapter_id and member.user_id = (select auth.uid()) and member.status = 'active'
  ));

drop policy if exists "Admins can manage tasks" on public.tasks;
drop policy if exists "Admins can insert tasks" on public.tasks;
create policy "Admins can insert tasks"
  on public.tasks for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update tasks" on public.tasks;
create policy "Admins can update tasks"
  on public.tasks for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete tasks" on public.tasks;
create policy "Admins can delete tasks"
  on public.tasks for delete to authenticated using (public.is_admin());

drop policy if exists "Members can view shared events" on public.events;
create policy "Members can view shared events"
  on public.events for select to authenticated
  using (public.is_admin() or chapter_id is null or exists (
    select 1 from public.chapter_members member
    where member.chapter_id = events.chapter_id and member.user_id = (select auth.uid()) and member.status = 'active'
  ));

drop policy if exists "Admins can manage events" on public.events;
drop policy if exists "Admins can insert events" on public.events;
create policy "Admins can insert events"
  on public.events for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update events" on public.events;
create policy "Admins can update events"
  on public.events for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete events" on public.events;
create policy "Admins can delete events"
  on public.events for delete to authenticated using (public.is_admin());

create index if not exists chapter_members_user_id_idx on public.chapter_members(user_id);
create index if not exists weekly_reports_chapter_week_idx on public.weekly_reports(chapter_id, week_start desc);
create index if not exists tasks_chapter_status_idx on public.tasks(assigned_chapter_id, status);
create index if not exists events_starts_at_idx on public.events(starts_at);
create index if not exists events_chapter_id_idx on public.events(chapter_id);
create index if not exists events_created_by_idx on public.events(created_by);
create index if not exists tasks_assigned_to_user_id_idx on public.tasks(assigned_to_user_id);
create index if not exists tasks_created_by_idx on public.tasks(created_by);
create index if not exists weekly_reports_submitted_by_idx on public.weekly_reports(submitted_by);

-- After creating an admin user, set app_metadata.role = 'admin' with the Supabase Admin API.
-- Do not use raw_user_meta_data for authorization decisions.
