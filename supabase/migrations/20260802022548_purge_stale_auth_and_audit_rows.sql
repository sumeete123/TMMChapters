-- Storage in this project grows with page views, not with chapter activity.
-- Every visitor's browser mints an anonymous Supabase Auth identity on load,
-- and nothing ever removes it: auth.users, auth.identities, auth.sessions and
-- the rotating auth.refresh_tokens chain all accumulate forever. The
-- rate-limit ledgers and expired authorization grants never get pruned either,
-- even though they stop being meaningful after 15 minutes and 8 hours.

create or replace function private.purge_stale_auth_and_audit_rows()
returns table (
  deleted_anonymous_users integer,
  deleted_code_attempts integer,
  deleted_expired_sessions integer,
  deleted_revoked_tokens integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_users integer := 0;
  v_attempts integer := 0;
  v_sessions integer := 0;
  v_tokens integer := 0;
  n integer;
begin
  -- The rate limiters only ever read a 15 minute window. A day of history is
  -- kept so a burst of failed attempts is still visible after the fact.
  delete from private.chapter_code_attempts where attempted_at < now() - interval '24 hours';
  get diagnostics n = row_count; v_attempts := v_attempts + n;

  delete from private.admin_code_attempts where attempted_at < now() - interval '24 hours';
  get diagnostics n = row_count; v_attempts := v_attempts + n;

  -- An expired grant authorizes nothing; is_admin() and is_chapter_member()
  -- both require expires_at > now().
  delete from private.chapter_sessions where expires_at < now() - interval '24 hours';
  get diagnostics n = row_count; v_sessions := v_sessions + n;

  delete from private.admin_sessions where expires_at < now() - interval '24 hours';
  get diagnostics n = row_count; v_sessions := v_sessions + n;

  -- Drop anonymous identities that are over a week old, hold no live chapter or
  -- admin authorization, and are not still acting as the one-application-per
  -- -identity guard for an application that is still open. Deleting one
  -- cascades its identities, sessions and refresh tokens; every foreign key
  -- pointing at auth.users from application data is ON DELETE SET NULL, so
  -- chapter records keep their content and only lose an attribution id. A
  -- returning visitor simply mints a fresh identity, exactly as a new one does.
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '7 days'
    and not exists (select 1 from private.chapter_sessions s where s.user_id = u.id and s.expires_at > now())
    and not exists (select 1 from private.admin_sessions s where s.user_id = u.id and s.expires_at > now())
    and not exists (select 1 from public.chapter_applications a where a.submitted_by = u.id and a.status in ('new', 'reviewing'));
  get diagnostics n = row_count; v_users := n;

  -- Rotated tokens belonging to identities that were kept.
  delete from auth.refresh_tokens t where t.revoked and t.updated_at < now() - interval '7 days';
  get diagnostics n = row_count; v_tokens := n;

  return query select v_users, v_attempts, v_sessions, v_tokens;
end;
$$;

-- The private schema is already closed to anon and authenticated; this is
-- belt-and-braces so the routine can never be reached from the API.
revoke all on function private.purge_stale_auth_and_audit_rows() from public, anon, authenticated;

comment on function private.purge_stale_auth_and_audit_rows() is
  'Daily storage maintenance: removes stale anonymous auth identities, old code-attempt ledger rows, long-expired authorization grants, and rotated refresh tokens.';
