-- Remove the specifically requested Hickory Ridge chapter.
-- Refuse to guess if more than one matching non-official chapter exists.

do $$
declare
  matching_chapters integer;
begin
  select count(*)
  into matching_chapters
  from public.chapters
  where lower(btrim(name)) like 'hickory ridge%'
    and not is_official;

  if matching_chapters > 1 then
    raise exception 'More than one non-official Hickory Ridge chapter exists; delete the intended record manually.';
  end if;

  delete from public.chapters
  where lower(btrim(name)) like 'hickory ridge%'
    and not is_official;
end;
$$;
