alter table public.weekly_reports
  add column if not exists next_week_plan text,
  add column if not exists support_needed text;

create table if not exists public.weekly_report_reviews (
  report_id uuid primary key references public.weekly_reports(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'reviewed', 'needs_follow_up')),
  rating smallint
    check (rating between 1 and 5),
  private_notes text,
  public_feedback text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completed_reviews_require_rating
    check (status = 'pending' or rating is not null)
);

comment on table public.weekly_report_reviews is
  'Admin-only weekly report evaluations. Ratings and private notes are never returned to chapter sessions.';
comment on column public.weekly_report_reviews.rating is
  'Private 1-5 admin rating. Never expose to chapter users.';
comment on column public.weekly_report_reviews.private_notes is
  'Private internal review notes. Never expose to chapter users.';
comment on column public.weekly_report_reviews.public_feedback is
  'Optional feedback that the Edge Function may return to the matching chapter.';

create index if not exists weekly_report_reviews_queue_idx
  on public.weekly_report_reviews (status, updated_at desc);
create index if not exists weekly_report_reviews_reviewed_at_idx
  on public.weekly_report_reviews (reviewed_at desc)
  where reviewed_at is not null;

alter table public.weekly_report_reviews enable row level security;

drop policy if exists "Admins can view weekly report reviews" on public.weekly_report_reviews;
create policy "Admins can view weekly report reviews"
on public.weekly_report_reviews
for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins can insert weekly report reviews" on public.weekly_report_reviews;
create policy "Admins can insert weekly report reviews"
on public.weekly_report_reviews
for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists "Admins can update weekly report reviews" on public.weekly_report_reviews;
create policy "Admins can update weekly report reviews"
on public.weekly_report_reviews
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Admins can delete weekly report reviews" on public.weekly_report_reviews;
create policy "Admins can delete weekly report reviews"
on public.weekly_report_reviews
for delete
to authenticated
using ((select public.is_admin()));

revoke all on table public.weekly_report_reviews from public, anon;
grant select, insert, update, delete on table public.weekly_report_reviews to authenticated, service_role;

grant select (next_week_plan, support_needed),
      insert (next_week_plan, support_needed),
      update (next_week_plan, support_needed)
on table public.weekly_reports to authenticated, service_role;
