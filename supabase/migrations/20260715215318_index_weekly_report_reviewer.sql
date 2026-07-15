create index if not exists weekly_report_reviews_reviewed_by_idx
  on public.weekly_report_reviews (reviewed_by)
  where reviewed_by is not null;
