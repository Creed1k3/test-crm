create type public.assignment_mode as enum ('direct', 'candidates', 'open');

alter table public.tasks alter column assignee_id drop not null;
alter table public.tasks add column assignment_mode public.assignment_mode not null default 'direct';
alter table public.tasks add constraint tasks_assignment_consistent check (
  (assignment_mode = 'direct' and assignee_id is not null)
  or (assignment_mode in ('candidates', 'open') and assignee_id is null and status = 'new')
);

create table public.task_candidates (
  task_id uuid not null references public.tasks(id),
  performer_id uuid not null references public.profiles(id),
  primary key (task_id, performer_id)
);
create index task_candidates_performer_id_idx on public.task_candidates(performer_id);

create table public.task_comments (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(regexp_replace(body, '[[:space:]]', '', 'g')) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index task_comments_task_id_idx on public.task_comments(task_id, created_at, id);

-- The helper reads candidate assignments without invoking their own RLS policy.
create function private.can_view_task(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    join public.objects o on o.id = t.object_id
    where t.id = p_id and t.deleted_at is null and o.deleted_at is null
      and (
        private.is_manager()
        or t.assignee_id = (select auth.uid())
        or (t.assignee_id is null and t.status = 'new'
          and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'performer')
          and (t.assignment_mode = 'open' or
            (t.assignment_mode = 'candidates' and exists (
              select 1 from public.task_candidates c
              where c.task_id = t.id and c.performer_id = (select auth.uid())
            )))
        )
      )
  )
$$;

create or replace function private.can_view_object(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.objects o where o.id = p_id and o.deleted_at is null
      and (private.is_manager() or exists (
        select 1 from public.tasks t where t.object_id = o.id and private.can_view_task(t.id)
      ))
  )
$$;

create or replace function private.validate_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.objects where id = new.object_id and deleted_at is null for share;
  if not found then raise exception 'Object does not exist or is deleted'; end if;
  if new.assignee_id is not null and not exists (
    select 1 from public.profiles where id = new.assignee_id and role = 'performer'
  ) then raise exception 'Assignee must be a performer'; end if;
  return new;
end $$;

drop policy tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated using (private.can_view_task(id));
drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check (private.is_manager() and assignment_mode = 'direct');
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (deleted_at is null and assignment_mode = 'direct' and private.is_manager())
  with check (deleted_at is null and assignment_mode = 'direct' and private.is_manager());

alter table public.task_candidates enable row level security;
alter table public.task_comments enable row level security;
revoke all on public.task_candidates, public.task_comments from public, anon, authenticated;
grant select on public.task_candidates, public.task_comments to authenticated;
grant insert (task_id, body) on public.task_comments to authenticated;

create policy candidates_read on public.task_candidates for select to authenticated using (
  private.can_view_task(task_id) and (private.is_manager() or performer_id = (select auth.uid()))
);
create policy comments_read on public.task_comments for select to authenticated using (private.can_view_task(task_id));
create policy comments_insert on public.task_comments for insert to authenticated with check (private.can_view_task(task_id));

-- Serialize comments and file uploads with claiming/reassignment before checking access.
create function private.lock_task_for_action(p_task_id uuid, p_upload boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  task public.tasks%rowtype;
  actor uuid := auth.uid();
begin
  if not private.can_view_task(p_task_id) then return false; end if;
  select * into task from public.tasks where id = p_task_id and deleted_at is null for share;
  if not found then return false; end if;
  perform 1 from public.objects where id = task.object_id and deleted_at is null for share;
  if not found then return false; end if;
  if private.is_manager() then return true; end if;
  if not exists (select 1 from public.profiles where id = actor and role = 'performer') then return false; end if;
  if task.assignee_id = actor then
    return not p_upload or task.status in ('in_progress', 'rework');
  end if;
  if p_upload or task.assignee_id is not null or task.status <> 'new' then return false; end if;
  return task.assignment_mode = 'open' or (task.assignment_mode = 'candidates' and exists (
    select 1 from public.task_candidates where task_id = task.id and performer_id = actor
  ));
end $$;

create function private.validate_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.lock_task_for_action(new.task_id, false) then raise exception 'Task not found'; end if;
  return new;
end $$;
create trigger validate_comment before insert on public.task_comments
for each row execute function private.validate_comment();

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or private.is_manager()
  or exists (select 1 from public.tasks where author_id = profiles.id)
  or exists (select 1 from public.task_status_history where actor_id = profiles.id)
  or exists (select 1 from public.task_comments where author_id = profiles.id)
);

create function private.save_task(
  p_task_id uuid, p_title text, p_description text, p_object_id uuid,
  p_assignment_mode public.assignment_mode, p_assignee_id uuid, p_candidate_ids uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  task public.tasks%rowtype;
  result_id uuid;
  candidate_count integer;
begin
  if not private.is_manager() then raise exception 'Not allowed'; end if;
  if p_assignment_mode is null or p_candidate_ids is null then raise exception 'Invalid assignment'; end if;
  select count(distinct c.id) into candidate_count from unnest(p_candidate_ids) c(id);
  if candidate_count <> cardinality(p_candidate_ids) then raise exception 'Invalid candidates'; end if;
  if p_assignment_mode = 'direct' then
    if p_assignee_id is null or candidate_count <> 0 then raise exception 'Invalid assignment'; end if;
  elsif p_assignment_mode = 'candidates' then
    if p_assignee_id is not null or candidate_count < 2 or exists (
      select 1 from unnest(p_candidate_ids) c(id)
      where not exists (select 1 from public.profiles p where p.id = c.id and p.role = 'performer')
    ) then raise exception 'Invalid candidates'; end if;
  elsif p_assignee_id is not null or candidate_count <> 0 then
    raise exception 'Invalid assignment';
  end if;

  if p_task_id is null then
    insert into public.tasks(title, description, object_id, assignment_mode, assignee_id)
    values (p_title, coalesce(p_description, ''), p_object_id, p_assignment_mode, p_assignee_id)
    returning id into result_id;
  else
    select * into task from public.tasks where id = p_task_id and deleted_at is null for update;
    if not found then raise exception 'Task not found'; end if;
    perform 1 from public.objects where id = task.object_id and deleted_at is null for share;
    if not found then raise exception 'Task not found'; end if;
    if task.status <> 'new' and p_assignment_mode <> 'direct' then raise exception 'Task already started'; end if;
    update public.tasks set title = p_title, description = coalesce(p_description, ''),
      object_id = p_object_id, assignment_mode = p_assignment_mode, assignee_id = p_assignee_id
      where id = p_task_id;
    delete from public.task_candidates where task_id = p_task_id;
    result_id := p_task_id;
  end if;
  if p_assignment_mode = 'candidates' then
    insert into public.task_candidates(task_id, performer_id)
      select result_id, c.id from unnest(p_candidate_ids) c(id);
  end if;
  return result_id;
end $$;

create function private.claim_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  task public.tasks%rowtype;
  actor uuid := auth.uid();
begin
  if not private.can_view_task(p_task_id) then raise exception 'Task not found'; end if;
  select * into task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found or task.assignee_id is not null or task.status <> 'new'
    or not exists (select 1 from public.profiles where id = actor and role = 'performer')
    or not (task.assignment_mode = 'open' or (task.assignment_mode = 'candidates' and exists (
      select 1 from public.task_candidates where task_id = task.id and performer_id = actor
    ))) then raise exception 'Task not found'; end if;
  perform 1 from public.objects where id = task.object_id and deleted_at is null for share;
  if not found then raise exception 'Task not found'; end if;
  update public.tasks set assignee_id = actor, assignment_mode = 'direct', status = 'in_progress' where id = task.id;
  delete from public.task_candidates where task_id = task.id;
  insert into public.task_status_history(task_id, actor_id, from_status, to_status)
    values(task.id, actor, 'new', 'in_progress');
end $$;

create function public.save_task(
  p_task_id uuid, p_title text, p_description text, p_object_id uuid,
  p_assignment_mode public.assignment_mode, p_assignee_id uuid, p_candidate_ids uuid[] default '{}'
) returns uuid language sql security invoker set search_path = '' as $$
  select private.save_task(p_task_id, p_title, p_description, p_object_id, p_assignment_mode, p_assignee_id, p_candidate_ids)
$$;
create function public.claim_task(p_task_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.claim_task(p_task_id) $$;

revoke all on function private.can_view_task(uuid), private.lock_task_for_action(uuid, boolean),
  private.validate_comment(), private.save_task(uuid, text, text, uuid, public.assignment_mode, uuid, uuid[]),
  private.claim_task(uuid) from public, anon, authenticated;
grant execute on function private.can_view_task(uuid), private.lock_task_for_action(uuid, boolean),
  private.save_task(uuid, text, text, uuid, public.assignment_mode, uuid, uuid[]), private.claim_task(uuid) to authenticated;
revoke all on function public.save_task(uuid, text, text, uuid, public.assignment_mode, uuid, uuid[]),
  public.claim_task(uuid) from public, anon;
grant execute on function public.save_task(uuid, text, text, uuid, public.assignment_mode, uuid, uuid[]),
  public.claim_task(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments', 'task-attachments', false, 20971520, array[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv', 'application/rtf', 'text/rtf',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip', 'application/x-zip-compressed', 'application/vnd.rar', 'application/x-rar-compressed',
  'application/octet-stream', 'video/mp4', 'video/quicktime'
]);

create function private.attachment_task_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    then split_part(p_name, '/', 1)::uuid else null end
$$;
revoke all on function private.attachment_task_id(text) from public, anon, authenticated;
grant execute on function private.attachment_task_id(text) to authenticated;

create policy task_attachments_read on storage.objects for select to authenticated using (
  bucket_id = 'task-attachments'
  and storage.allow_any_operation(array['object.list', 'object.get_authenticated', 'object.get_authenticated_info'])
  and private.can_view_task(private.attachment_task_id(name))
);
create policy task_attachments_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'task-attachments'
  and storage.allow_only_operation('object.upload')
  and private.lock_task_for_action(private.attachment_task_id(name), true)
);
