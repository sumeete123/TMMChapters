-- Private code/session tables are intentionally accessible only through the
-- narrowly-scoped SECURITY DEFINER functions in the public API.

create policy "No direct admin code access"
  on private.admin_access_codes for all to public
  using (false) with check (false);

create policy "No direct admin attempt access"
  on private.admin_code_attempts for all to public
  using (false) with check (false);

create policy "No direct admin session access"
  on private.admin_sessions for all to public
  using (false) with check (false);

create policy "No direct chapter code access"
  on private.chapter_access_codes for all to public
  using (false) with check (false);

create policy "No direct chapter attempt access"
  on private.chapter_code_attempts for all to public
  using (false) with check (false);

create policy "No direct chapter authorization access"
  on private.chapter_sessions for all to public
  using (false) with check (false);
