-- Every new chapter already receives a "Create your chapter Instagram account"
-- first task automatically via the private.initialize_new_chapter() AFTER INSERT
-- trigger on public.chapters. This backfills that first task for any chapter
-- that was created before the trigger fired for it (for example the National
-- Chapter, which was provisioned with an upsert rather than a plain insert),
-- so every chapter has the Instagram onboarding task assigned.
insert into public.tasks (title, description, assigned_chapter_id, due_date, priority, status)
select
  'Create your chapter Instagram account',
  'Create an Instagram account for your chapter. Use the chapter name in the handle, add The Mastery Mentors to the bio, and share the final handle with TMM.',
  chapter.id,
  current_date + 7,
  'high',
  'open'
from public.chapters chapter
where not exists (
  select 1
  from public.tasks task
  where task.assigned_chapter_id = chapter.id
    and lower(task.title) = lower('Create your chapter Instagram account')
);
