-- Register the founding National Chapter as an official, admin-controlled chapter.

alter table public.chapters
  add column if not exists is_official boolean not null default false;

comment on column public.chapters.is_official is
  'Official network chapters are controlled by administrators and cannot be accessed with a chapter code.';

create index if not exists chapters_is_official_idx
  on public.chapters (is_official);

create or replace function private.initialize_new_chapter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_official then
    return new;
  end if;

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

create or replace function public.current_chapter_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select session.chapter_id
  from private.chapter_sessions session
  join public.chapters chapter on chapter.id = session.chapter_id
  where session.user_id = auth.uid()
    and session.expires_at > now()
    and chapter.is_official = false
  limit 1;
$$;

create or replace function public.is_chapter_member(target_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select auth.uid() is not null and exists (
    select 1
    from private.chapter_sessions session
    join public.chapters chapter on chapter.id = session.chapter_id
    where session.user_id = auth.uid()
      and session.chapter_id = target_chapter_id
      and session.expires_at > now()
      and chapter.is_official = false
  );
$$;

create or replace function public.verify_chapter_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  recent_failures integer;
  matched_chapter_id uuid;
begin
  if current_user_id is null then
    raise exception using message = 'AUTH_REQUIRED', errcode = 'P0001';
  end if;

  if btrim(coalesce(input_code, '')) !~ '^[0-9]{6}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 9142672));

  select count(*) into recent_failures
  from private.chapter_code_attempts
  where user_id = current_user_id
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if recent_failures >= 5 then
    raise exception using message = 'RATE_LIMITED', errcode = 'P0001';
  end if;

  select code.chapter_id into matched_chapter_id
  from private.chapter_access_codes code
  join public.chapters chapter on chapter.id = code.chapter_id
  where code.active = true
    and chapter.status = 'active'
    and chapter.is_official = false
    and crypt(btrim(input_code), code.code_hash) = code.code_hash
  limit 1;

  insert into private.chapter_code_attempts (user_id, success)
  values (current_user_id, matched_chapter_id is not null);

  if matched_chapter_id is null then
    return false;
  end if;

  insert into private.chapter_sessions (user_id, chapter_id, granted_at, expires_at)
  values (current_user_id, matched_chapter_id, now(), now() + interval '8 hours')
  on conflict (user_id) do update
    set chapter_id = excluded.chapter_id,
        granted_at = excluded.granted_at,
        expires_at = excluded.expires_at;

  return true;
end;
$$;

create or replace function public.provision_chapter_code(target_chapter_id uuid, input_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using message = 'ACCESS_DENIED', errcode = '42501';
  end if;

  if exists (select 1 from public.chapters where id = target_chapter_id and is_official) then
    raise exception using message = 'OFFICIAL_CHAPTER_ADMIN_ONLY', errcode = '42501';
  end if;

  if btrim(coalesce(input_code, '')) !~ '^[0-9]{6}$' then
    raise exception using message = 'INVALID_CODE_FORMAT', errcode = '22023';
  end if;

  if exists (
    select 1
    from private.chapter_access_codes code
    where code.chapter_id <> target_chapter_id
      and code.active = true
      and crypt(btrim(input_code), code.code_hash) = code.code_hash
  ) then
    raise exception using message = 'CHAPTER_CODE_COLLISION', errcode = '23505';
  end if;

  insert into private.chapter_access_codes (chapter_id, code_hash, active, updated_at)
  values (target_chapter_id, crypt(btrim(input_code), gen_salt('bf', 12)), true, now())
  on conflict (chapter_id) do update
    set code_hash = excluded.code_hash,
        active = true,
        updated_at = now();

  update public.chapters
  set access_code_hint = right(btrim(input_code), 2), updated_at = now()
  where id = target_chapter_id;

  delete from private.chapter_sessions where chapter_id = target_chapter_id;
end;
$$;

drop policy if exists "Admins and code-authorized chapters can view chapters" on public.chapters;
create policy "Admins and code-authorized chapters can view chapters"
  on public.chapters for select to authenticated
  using (public.is_admin() or (not is_official and public.is_chapter_member(id)));

insert into public.chapters (
  name,
  slug,
  location,
  description,
  contact_name,
  contact_email,
  status,
  founded_at,
  is_official
) values (
  'TMM National Chapter',
  'national',
  'National',
  'The official founding chapter for The Mastery Mentors network. Managed by administrators only.',
  'TMM Admin Team',
  'admin@themasterymentors.org',
  'active',
  current_date,
  true
)
on conflict (slug) do update set
  name = excluded.name,
  location = excluded.location,
  description = excluded.description,
  status = 'active',
  is_official = true,
  updated_at = now();

delete from private.chapter_access_codes
where chapter_id = (select id from public.chapters where slug = 'national');

delete from private.chapter_sessions
where chapter_id = (select id from public.chapters where slug = 'national');
