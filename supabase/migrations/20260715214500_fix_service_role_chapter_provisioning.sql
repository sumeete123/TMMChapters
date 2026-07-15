create or replace function public.provision_chapter_code(target_chapter_id uuid, input_code text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
begin
  if btrim(coalesce(input_code, '')) !~ '^[0-9]{6}$' then
    raise exception using message = 'INVALID_CODE_FORMAT', errcode = '22023';
  end if;

  if not exists (select 1 from public.chapters where id = target_chapter_id) then
    raise exception using message = 'CHAPTER_NOT_FOUND', errcode = 'P0002';
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

revoke execute on function public.provision_chapter_code(uuid, text) from public, anon, authenticated;
grant execute on function public.provision_chapter_code(uuid, text) to service_role;

comment on function public.provision_chapter_code(uuid, text) is
  'Service-role-only helper that hashes and provisions a chapter access code.';
