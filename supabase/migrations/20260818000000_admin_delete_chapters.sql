-- Allow only administrators to delete non-official chapters.

grant delete on public.chapters to authenticated;

drop policy if exists "Admins can delete chapters" on public.chapters;
create policy "Admins can delete chapters"
  on public.chapters for delete
  to authenticated
  using (public.is_admin() and not is_official);
