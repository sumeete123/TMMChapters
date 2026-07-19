-- Product decision: administrators need to view a chapter's access code at any
-- time from the admin portal, not only once at creation. This stores the raw
-- code alongside the bcrypt hash.
--
-- Security posture: the raw code lives ONLY in the private schema (no PostgREST
-- exposure, RLS deny-all) and is surfaced only through admin_chapter_codes(),
-- which is executable by service_role alone. The chapter-portal Edge Function
-- calls it after its is_admin() check, so codes are visible to signed-in admins
-- and to no one else. The browser never receives another chapter's code.

alter table private.chapter_access_codes
  add column if not exists code_plain text;

-- Persist the raw code when (re)provisioning, next to the hash used for login.
create or replace function public.provision_chapter_code(target_chapter_id uuid, input_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
begin
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

  insert into private.chapter_access_codes (chapter_id, code_hash, code_plain, active, updated_at)
  values (target_chapter_id, crypt(btrim(input_code), gen_salt('bf', 12)), btrim(input_code), true, now())
  on conflict (chapter_id) do update
    set code_hash = excluded.code_hash,
        code_plain = excluded.code_plain,
        active = true,
        updated_at = now();

  update public.chapters
  set access_code_hint = right(btrim(input_code), 2), updated_at = now()
  where id = target_chapter_id;

  delete from private.chapter_sessions where chapter_id = target_chapter_id;
end;
$$;

revoke execute on function public.provision_chapter_code(uuid, text) from public, anon, authenticated;
grant execute on function public.provision_chapter_code(uuid, text) to service_role;

-- Admin-only reader for raw codes. Only service_role may execute it; the Edge
-- Function gates the caller with is_admin() before returning the result.
create or replace function public.admin_chapter_codes()
returns table (chapter_id uuid, code text)
language sql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
  select chapter_id, code_plain
  from private.chapter_access_codes
  where active = true and code_plain is not null;
$$;

revoke all on function public.admin_chapter_codes() from public, anon, authenticated;
grant execute on function public.admin_chapter_codes() to service_role;
