-- Fix: accepting a chapter application failed with ACCESS_DENIED.
--
-- 20260715214500_fix_service_role_chapter_provisioning.sql removed the
-- fragile `request.jwt.claim.role = 'service_role'` gate in favour of
-- GRANT-based authorization, but 20260717130000_official_national_chapter.sql
-- recreated provision_chapter_code and reintroduced that gate. With the new
-- Supabase secret key format the edge function's service client does not
-- populate `request.jwt.claim.role`, so the check always raised ACCESS_DENIED
-- and admin approval / code provisioning could never succeed.
--
-- This restores the GRANT-only authorization model while keeping the
-- official-chapter guard added in 20260717130000.

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

revoke execute on function public.provision_chapter_code(uuid, text) from public, anon, authenticated;
grant execute on function public.provision_chapter_code(uuid, text) to service_role;
