-- Distinguish school chapters from city chapters and support safe requests to
-- join an existing match. Existing chapters are treated as school chapters,
-- matching the original "school or organization" intake model.

alter table public.chapters
  add column if not exists chapter_type text not null default 'school',
  add column if not exists match_key text generated always as (
    case
      when chapter_type = 'city'
        then regexp_replace(lower(btrim(location)), '[^a-z0-9]+', '', 'g')
      else regexp_replace(lower(btrim(name) || '|' || btrim(location)), '[^a-z0-9]+', '', 'g')
    end
  ) stored;

alter table public.chapter_applications
  add column if not exists chapter_type text not null default 'school',
  add column if not exists application_kind text not null default 'new_chapter',
  add column if not exists existing_chapter_id uuid references public.chapters(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chapters_chapter_type_valid'
      and conrelid = 'public.chapters'::regclass
  ) then
    alter table public.chapters
      add constraint chapters_chapter_type_valid
      check (chapter_type in ('city', 'school'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_chapter_type_valid'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_chapter_type_valid
      check (chapter_type in ('city', 'school'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_kind_valid'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_kind_valid
      check (application_kind in ('new_chapter', 'join_existing'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chapter_applications_existing_chapter_consistent'
      and conrelid = 'public.chapter_applications'::regclass
  ) then
    alter table public.chapter_applications
      add constraint chapter_applications_existing_chapter_consistent
      check (
        (application_kind = 'new_chapter' and existing_chapter_id is null)
        or application_kind = 'join_existing'
      );
  end if;
end $$;

create index if not exists chapters_active_match_idx
  on public.chapters (chapter_type, match_key)
  where status = 'active';

create index if not exists chapter_applications_existing_chapter_id_idx
  on public.chapter_applications (existing_chapter_id)
  where existing_chapter_id is not null;

-- Application writes now pass through the authenticated Edge Function, which
-- rechecks chapter matches immediately before inserting. The table remains
-- readable and editable only through the existing admin policies.
revoke insert on table public.chapter_applications from anon, authenticated;

comment on column public.chapters.chapter_type is
  'Whether this chapter represents a city or a specific school.';
comment on column public.chapter_applications.application_kind is
  'Either a request to create a chapter or a request to join an existing match.';
comment on column public.chapter_applications.existing_chapter_id is
  'The existing chapter selected for a join request; never exposed directly through the Data API.';
