alter table public.chapter_applications
  add column if not exists additional_contacts jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_additional_contacts_array'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_additional_contacts_array
      check (
        jsonb_typeof(additional_contacts) = 'array'
        and jsonb_array_length(additional_contacts) <= 12
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_additional_contacts_size'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_additional_contacts_size
      check (pg_column_size(additional_contacts) <= 32768);
  end if;
end $$;

create table if not exists public.chapter_volunteers (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  role text not null default 'Volunteer' check (char_length(btrim(role)) between 2 and 80),
  joined_on date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chapter_volunteers_chapter_id_idx
  on public.chapter_volunteers (chapter_id);

create index if not exists chapter_volunteers_chapter_status_idx
  on public.chapter_volunteers (chapter_id, status);

create index if not exists chapter_volunteers_created_by_idx
  on public.chapter_volunteers (created_by);

alter table public.chapter_volunteers enable row level security;

grant select, insert, update, delete on public.chapter_volunteers to authenticated;
revoke all on public.chapter_volunteers from anon;

drop policy if exists "Admins and matching chapters can view volunteers" on public.chapter_volunteers;
create policy "Admins and matching chapters can view volunteers"
on public.chapter_volunteers for select
to authenticated
using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

drop policy if exists "Admins and matching chapters can add volunteers" on public.chapter_volunteers;
create policy "Admins and matching chapters can add volunteers"
on public.chapter_volunteers for insert
to authenticated
with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

drop policy if exists "Admins and matching chapters can update volunteers" on public.chapter_volunteers;
create policy "Admins and matching chapters can update volunteers"
on public.chapter_volunteers for update
to authenticated
using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)))
with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

drop policy if exists "Admins and matching chapters can remove volunteers" on public.chapter_volunteers;
create policy "Admins and matching chapters can remove volunteers"
on public.chapter_volunteers for delete
to authenticated
using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

create or replace function private.touch_chapter_volunteer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_chapter_volunteer_updated_at() from public, anon, authenticated;

drop trigger if exists chapter_volunteers_touch_updated_at on public.chapter_volunteers;
create trigger chapter_volunteers_touch_updated_at
before update on public.chapter_volunteers
for each row execute function private.touch_chapter_volunteer_updated_at();

alter table public.tasks alter column priority set default 'high';
update public.tasks set priority = 'high' where priority is distinct from 'high';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_priority_always_high'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_priority_always_high check (priority = 'high');
  end if;
end $$;

create or replace function private.initialize_new_chapter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chapter_volunteers (
    chapter_id, full_name, email, phone, role, status
  ) values (
    new.id,
    new.contact_name,
    nullif(lower(btrim(new.contact_email)), ''),
    nullif(btrim(new.contact_phone), ''),
    'Chapter lead',
    'active'
  );

  insert into public.tasks (
    title, description, assigned_chapter_id, due_date, priority, status
  ) values (
    'Create your chapter Instagram account',
    'Create an Instagram account for your chapter. Use the chapter name in the handle, add The Mastery Mentors to the bio, and share the final handle with TMM.',
    new.id,
    current_date + 7,
    'high',
    'open'
  );

  return new;
end;
$$;

revoke all on function private.initialize_new_chapter() from public, anon, authenticated;

drop trigger if exists initialize_new_chapter_after_insert on public.chapters;
create trigger initialize_new_chapter_after_insert
after insert on public.chapters
for each row execute function private.initialize_new_chapter();

insert into public.chapter_volunteers (
  chapter_id, full_name, email, phone, role, status
)
select
  chapter.id,
  chapter.contact_name,
  nullif(lower(btrim(chapter.contact_email)), ''),
  nullif(btrim(chapter.contact_phone), ''),
  'Chapter lead',
  'active'
from public.chapters chapter
where not exists (
  select 1
  from public.chapter_volunteers volunteer
  where volunteer.chapter_id = chapter.id
    and lower(coalesce(volunteer.email, '')) = lower(coalesce(chapter.contact_email, ''))
);

insert into public.tasks (
  title, description, assigned_chapter_id, due_date, priority, status
)
select
  'Create your chapter Instagram account',
  'Create an Instagram account for your chapter. Use the chapter name in the handle, add The Mastery Mentors to the bio, and share the final handle with TMM.',
  chapter.id,
  current_date + 7,
  'high',
  'open'
from public.chapters chapter
where not exists (
  select 1
  from public.tasks task
  where task.assigned_chapter_id = chapter.id
    and lower(task.title) = lower('Create your chapter Instagram account')
);
