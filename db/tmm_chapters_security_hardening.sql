-- Lock down legacy helpers and make Edge-only tables explicitly deny direct clients.

alter function public.is_admin() security invoker;

revoke execute on function public.verify_admin_code(text) from public, anon, authenticated;

drop policy if exists "No direct chapter session access" on public.chapter_sessions;
create policy "No direct chapter session access"
  on public.chapter_sessions for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "No direct login attempt access" on public.chapter_login_attempts;
create policy "No direct login attempt access"
  on public.chapter_login_attempts for all to anon, authenticated
  using (false) with check (false);
