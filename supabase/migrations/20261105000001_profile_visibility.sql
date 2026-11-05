drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or private.is_manager()
  or exists (select 1 from public.tasks where author_id = profiles.id)
  or exists (select 1 from public.task_status_history where actor_id = profiles.id)
);
