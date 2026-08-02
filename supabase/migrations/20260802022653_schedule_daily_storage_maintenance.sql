create extension if not exists pg_cron;

-- Runs daily at 04:17 UTC. The odd minute keeps it off the busy top of the hour.
select cron.unschedule('purge-stale-auth-and-audit-rows')
where exists (select 1 from cron.job where jobname = 'purge-stale-auth-and-audit-rows');

select cron.schedule(
  'purge-stale-auth-and-audit-rows',
  '17 4 * * *',
  $$select private.purge_stale_auth_and_audit_rows()$$
);
