create table if not exists public.chapter_executive_candidates (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  volunteer_id uuid not null references public.chapter_volunteers(id) on delete cascade,
  director_role text not null check (director_role in ('events', 'marketing', 'tutoring')),
  application_notes text not null check (char_length(btrim(application_notes)) between 2 and 4000),
  status text not null default 'applied' check (status in ('applied', 'interviewing', 'selected', 'not_selected')),
  interview_at timestamptz,
  interview_notes text check (interview_notes is null or char_length(interview_notes) <= 4000),
  selected_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, volunteer_id, director_role)
);

create index if not exists chapter_executive_candidates_chapter_idx on public.chapter_executive_candidates (chapter_id, status);
create index if not exists chapter_executive_candidates_volunteer_idx on public.chapter_executive_candidates (volunteer_id);
create unique index if not exists chapter_executive_candidates_one_selected_role_idx on public.chapter_executive_candidates (chapter_id, director_role) where status = 'selected';

alter table public.chapter_executive_candidates enable row level security;
grant select, insert, update, delete on public.chapter_executive_candidates to authenticated;
revoke all on public.chapter_executive_candidates from anon;

create policy "Admins and matching chapters can view executive candidates" on public.chapter_executive_candidates for select to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can add executive candidates" on public.chapter_executive_candidates for insert to authenticated with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can update executive candidates" on public.chapter_executive_candidates for update to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id))) with check ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));
create policy "Admins and matching chapters can remove executive candidates" on public.chapter_executive_candidates for delete to authenticated using ((select public.is_admin()) or (select public.is_chapter_member(chapter_id)));

create or replace function private.touch_chapter_executive_candidate_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_chapter_executive_candidate_updated_at() from public, anon, authenticated;

create trigger chapter_executive_candidates_touch_updated_at before update on public.chapter_executive_candidates for each row execute function private.touch_chapter_executive_candidate_updated_at();

create or replace function private.initialize_new_chapter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chapter_volunteers (chapter_id, full_name, email, phone, role, status)
  values (new.id, new.contact_name, nullif(lower(btrim(new.contact_email)), ''), nullif(btrim(new.contact_phone), ''), 'Chapter lead', 'active');

  insert into public.tasks (title, description, assigned_chapter_id, due_date, priority, status)
  values
    ('Create your chapter Instagram account', 'Create an Instagram account for your chapter. Use the chapter name in the handle, add The Mastery Mentors to the bio, and share the final handle with TMM.', new.id, current_date + 7, 'high', 'open'),
    ('Create your chapter executive team', 'Invite applications from your hardest-working volunteers, interview candidates, and appoint a Director of Events, Director of Marketing, and Director of Tutoring. Track every application and decision in the Executive Team section.', new.id, current_date + 14, 'high', 'open');

  return new;
end;
$$;

revoke all on function private.initialize_new_chapter() from public, anon, authenticated;

insert into public.tasks (title, description, assigned_chapter_id, due_date, priority, status)
select 'Create your chapter executive team', 'Invite applications from your hardest-working volunteers, interview candidates, and appoint a Director of Events, Director of Marketing, and Director of Tutoring. Track every application and decision in the Executive Team section.', chapter.id, current_date + 14, 'high', 'open'
from public.chapters chapter
where chapter.status = 'active' and not chapter.is_official
  and not exists (select 1 from public.tasks task where task.assigned_chapter_id = chapter.id and lower(task.title) = lower('Create your chapter executive team'));
