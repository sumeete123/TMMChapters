-- Secure six-digit admin and chapter access for anonymous Supabase Auth users.
-- Raw access codes are provisioned out-of-band and never stored in source.

create extension if not exists pgcrypto with schema extensions;

alter table private.admin_access_codes enable row level security;
alter table private.admin_code_attempts enable row level security;
alter table private.admin_sessions enable row level security;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create table if not exists private.chapter_access_codes (
  chapter_id uuid primary key references public.chapters(id) on delete cascade,
  code_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.chapter_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success boolean not null default false
);

create index if not exists chapter_code_attempts_user_window_idx
  on private.chapter_code_attempts (user_id, attempted_at desc);

create table if not exists private.chapter_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists chapter_sessions_chapter_idx
  on private.chapter_sessions (chapter_id, expires_at);

alter table private.chapter_access_codes enable row level security;
alter table private.chapter_code_attempts enable row level security;
alter table private.chapter_sessions enable row level security;

revoke all on private.chapter_access_codes from public, anon, authenticated;
revoke all on private.chapter_code_attempts from public, anon, authenticated;
revoke all on private.chapter_sessions from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select auth.uid() is not null and (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (
      select 1
      from private.admin_sessions session
      where session.user_id = auth.uid()
        and session.expires_at > now()
    )
  );
$$;

create or replace function public.verify_admin_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  current_user_id uuid := auth.uid();
  recent_failures integer;
  matched boolean := false;
begin
  if current_user_id is null then
    raise exception using message = 'AUTH_REQUIRED', errcode = 'P0001';
  end if;

  if btrim(coalesce(input_code, '')) !~ '^[0-9]{6}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 9142671));

  select count(*) into recent_failures
  from private.admin_code_attempts
  where user_id = current_user_id
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if recent_failures >= 5 then
    raise exception using message = 'RATE_LIMITED', errcode = 'P0001';
  end if;

  select exists (
    select 1
    from private.admin_access_codes
    where active = true
      and crypt(btrim(input_code), code_hash) = code_hash
  ) into matched;

  insert into private.admin_code_attempts (user_id, success)
  values (current_user_id, matched);

  if matched then
    insert into private.admin_sessions (user_id, granted_at, expires_at)
    values (current_user_id, now(), now() + interval '8 hours')
    on conflict (user_id) do update
      set granted_at = excluded.granted_at,
          expires_at = excluded.expires_at;
  end if;

  return matched;
end;
$$;

create or replace function public.current_chapter_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select session.chapter_id
  from private.chapter_sessions session
  where session.user_id = auth.uid()
    and session.expires_at > now()
  limit 1;
$$;

create or replace function public.is_chapter_member(target_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select auth.uid() is not null and exists (
    select 1
    from private.chapter_sessions session
    where session.user_id = auth.uid()
      and session.chapter_id = target_chapter_id
      and session.expires_at > now()
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
  set access_code_hint = right(btrim(input_code), 2),
      updated_at = now()
  where id = target_chapter_id;

  delete from private.chapter_sessions where chapter_id = target_chapter_id;
end;
$$;

create or replace function public.clear_admin_session()
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'AUTH_REQUIRED', errcode = 'P0001';
  end if;
  delete from private.admin_sessions where user_id = auth.uid();
end;
$$;

create or replace function public.clear_chapter_session()
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if auth.uid() is null then
    raise exception using message = 'AUTH_REQUIRED', errcode = 'P0001';
  end if;
  delete from private.chapter_sessions where user_id = auth.uid();
end;
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.verify_admin_code(text) from public, anon;
revoke execute on function public.current_chapter_id() from public, anon;
revoke execute on function public.is_chapter_member(uuid) from public, anon;
revoke execute on function public.verify_chapter_code(text) from public, anon;
revoke execute on function public.provision_chapter_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.clear_admin_session() from public, anon;
revoke execute on function public.clear_chapter_session() from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.verify_admin_code(text) to authenticated;
grant execute on function public.current_chapter_id() to authenticated;
grant execute on function public.is_chapter_member(uuid) to authenticated;
grant execute on function public.verify_chapter_code(text) to authenticated;
grant execute on function public.provision_chapter_code(uuid, text) to service_role;
grant execute on function public.clear_admin_session() to authenticated;
grant execute on function public.clear_chapter_session() to authenticated;

drop policy if exists "Admins and members can view chapters" on public.chapters;
create policy "Admins and code-authorized chapters can view chapters"
  on public.chapters for select to authenticated
  using (public.is_admin() or public.is_chapter_member(id));

drop policy if exists "Members can view shared events" on public.events;
create policy "Admins and code-authorized chapters can view events"
  on public.events for select to authenticated
  using (
    public.is_admin()
    or (
      public.current_chapter_id() is not null
      and (chapter_id is null or public.is_chapter_member(chapter_id))
    )
  );

drop policy if exists "Members can view assigned tasks" on public.tasks;
create policy "Admins and code-authorized chapters can view tasks"
  on public.tasks for select to authenticated
  using (
    public.is_admin()
    or assigned_to_user_id = (select auth.uid())
    or public.is_chapter_member(assigned_chapter_id)
  );

drop policy if exists "Members can view their reports" on public.weekly_reports;
create policy "Admins and code-authorized chapters can view reports"
  on public.weekly_reports for select to authenticated
  using (public.is_admin() or public.is_chapter_member(chapter_id));

drop policy if exists "Members can submit their reports" on public.weekly_reports;
create policy "Admins and code-authorized chapters can submit reports"
  on public.weekly_reports for insert to authenticated
  with check (public.is_admin() or public.is_chapter_member(chapter_id));

drop policy if exists "Members can update their reports" on public.weekly_reports;
create policy "Admins and code-authorized chapters can update reports"
  on public.weekly_reports for update to authenticated
  using (public.is_admin() or public.is_chapter_member(chapter_id))
  with check (public.is_admin() or public.is_chapter_member(chapter_id));

comment on table private.chapter_access_codes is
  'Bcrypt representations of six-digit chapter codes. No raw codes are stored.';
comment on table private.chapter_sessions is
  'Eight-hour chapter authorization records bound to Supabase Auth user IDs.';
comment on table private.admin_sessions is
  'Eight-hour admin authorization records bound to Supabase Auth user IDs.';
