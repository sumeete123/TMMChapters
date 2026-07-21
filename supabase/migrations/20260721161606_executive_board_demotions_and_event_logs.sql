create table if not exists public.chapter_executive_members (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  volunteer_id uuid not null references public.chapter_volunteers(id) on delete restrict,
  director_role text not null check (director_role in ('events', 'marketing', 'tutoring')),
  appointed_on date not null default current_date,
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'active' check (status in ('active', 'demoted')),
  ended_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index chapter_executive_members_one_active_role_idx on public.chapter_executive_members (chapter_id, director_role) where status = 'active';
create unique index chapter_executive_members_one_active_member_idx on public.chapter_executive_members (chapter_id, volunteer_id) where status = 'active';
create index chapter_executive_members_chapter_idx on public.chapter_executive_members (chapter_id, status);
create index chapter_executive_members_volunteer_idx on public.chapter_executive_members (volunteer_id);
create index chapter_executive_members_created_by_idx on public.chapter_executive_members (created_by);

create table if not exists public.chapter_demotion_requests (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  executive_member_id uuid not null references public.chapter_executive_members(id) on delete restrict,
  executive_member_name text not null check (char_length(btrim(executive_member_name)) between 2 and 120),
  current_position text not null check (char_length(btrim(current_position)) between 2 and 80),
  reason text not null check (char_length(btrim(reason)) between 2 and 4000),
  previous_attempts text not null check (char_length(btrim(previous_attempts)) between 2 and 4000),
  relevant_documentation text check (relevant_documentation is null or char_length(relevant_documentation) <= 4000),
  proposed_replacement text check (proposed_replacement is null or char_length(proposed_replacement) <= 240),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_response text check (admin_response is null or char_length(admin_response) <= 4000),
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index chapter_demotion_requests_one_pending_member_idx on public.chapter_demotion_requests (executive_member_id) where status = 'pending';
create index chapter_demotion_requests_chapter_idx on public.chapter_demotion_requests (chapter_id, status, submitted_at desc);
create index chapter_demotion_requests_submitted_by_idx on public.chapter_demotion_requests (submitted_by);
create index chapter_demotion_requests_reviewed_by_idx on public.chapter_demotion_requests (reviewed_by);

create table if not exists public.chapter_event_records (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  event_date date not null,
  event_type text not null check (char_length(btrim(event_type)) between 2 and 80),
  location text check (location is null or char_length(location) <= 240),
  attendees integer not null default 0 check (attendees between 0 and 100000),
  summary text not null check (char_length(btrim(summary)) between 2 and 4000),
  outcomes text check (outcomes is null or char_length(outcomes) <= 4000),
  documentation_url text check (documentation_url is null or char_length(documentation_url) <= 2048),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapter_event_records_chapter_date_idx on public.chapter_event_records (chapter_id, event_date desc);
create index chapter_event_records_created_by_idx on public.chapter_event_records (created_by);

alter table public.chapter_executive_members enable row level security;
alter table public.chapter_demotion_requests enable row level security;
alter table public.chapter_event_records enable row level security;

grant select, insert, update, delete on public.chapter_executive_members, public.chapter_demotion_requests, public.chapter_event_records to authenticated;
revoke all on public.chapter_executive_members, public.chapter_demotion_requests, public.chapter_event_records from anon;

create policy "Admins and matching chapters can view executive members" on public.chapter_executive_members for select to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can add executive members" on public.chapter_executive_members for insert to authenticated with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can update executive members" on public.chapter_executive_members for update to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id))) with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

create policy "Admins and matching chapters can view demotion requests" on public.chapter_demotion_requests for select to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Matching chapters can submit demotion requests" on public.chapter_demotion_requests for insert to authenticated with check ((select public.is_chapter_member(chapter_id)));
create policy "Admins can review demotion requests" on public.chapter_demotion_requests for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "Admins and matching chapters can view event records" on public.chapter_event_records for select to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can add event records" on public.chapter_event_records for insert to authenticated with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can update event records" on public.chapter_event_records for update to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id))) with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can remove event records" on public.chapter_event_records for delete to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

create or replace function private.touch_chapter_operations_record_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_chapter_operations_record_updated_at() from public, anon, authenticated;

create trigger chapter_executive_members_touch_updated_at before update on public.chapter_executive_members for each row execute function private.touch_chapter_operations_record_updated_at();
create trigger chapter_demotion_requests_touch_updated_at before update on public.chapter_demotion_requests for each row execute function private.touch_chapter_operations_record_updated_at();
create trigger chapter_event_records_touch_updated_at before update on public.chapter_event_records for each row execute function private.touch_chapter_operations_record_updated_at();

update public.tasks
set description = 'Record your Director of Events, Director of Marketing, and Director of Tutoring in the Executive Team section. Use the team-building guide to organize responsibilities and expectations.'
where lower(title) = lower('Create your chapter executive team');

create or replace function private.initialize_new_chapter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chapter_volunteers (chapter_id, full_name, email, phone, role, status)
  values (new.id, new.contact_name, nullif(lower(btrim(new.contact_email)), ''), nullif(btrim(new.contact_phone), ''), 'Chapter lead', 'active');

  insert into public.tasks (title, description, assigned_chapter_id, due_date, priority, status)
  values
    ('Create your chapter Instagram account', 'Create an Instagram account for your chapter. Use the chapter name in the handle, add The Mastery Mentors to the bio, and share the final handle with TMM.', new.id, current_date + 7, 'high', 'open'),
    ('Create your chapter executive team', 'Record your Director of Events, Director of Marketing, and Director of Tutoring in the Executive Team section. Use the team-building guide to organize responsibilities and expectations.', new.id, current_date + 14, 'high', 'open');

  return new;
end;
$$;

revoke all on function private.initialize_new_chapter() from public, anon, authenticated;
