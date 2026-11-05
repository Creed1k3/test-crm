create type public.user_role as enum ('manager', 'performer');
create type public.task_status as enum ('new', 'in_progress', 'in_review', 'accepted', 'rework');

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(trim(display_name)) > 0),
  role public.user_role not null
);
create table public.objects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  address text not null check (length(trim(address)) > 0),
  deleted_at timestamptz
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  object_id uuid not null references public.objects(id),
  assignee_id uuid not null references public.profiles(id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  status public.task_status not null default 'new',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.task_status_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id),
  actor_id uuid not null references public.profiles(id),
  from_status public.task_status,
  to_status public.task_status not null,
  comment text,
  created_at timestamptz not null default now()
);
create index tasks_object_id_idx on public.tasks(object_id);
create index tasks_assignee_id_idx on public.tasks(assignee_id);
create index task_history_task_id_idx on public.task_status_history(task_id, created_at, id);

create function private.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'manager')
$$;
create function private.is_active_object(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.objects where id = p_id and deleted_at is null)
$$;
create function private.can_view_object(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.objects o where o.id = p_id and o.deleted_at is null
    and (private.is_manager() or exists(select 1 from public.tasks t
      where t.object_id = o.id and t.deleted_at is null and t.assignee_id = (select auth.uid()))))
$$;

-- Lock the object during task creation/moves so deletion cannot race with assignment.
create function private.validate_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.objects where id = new.object_id and deleted_at is null for share;
  if not found then raise exception 'Object does not exist or is deleted'; end if;
  if not exists (select 1 from public.profiles where id = new.assignee_id and role = 'performer') then
    raise exception 'Assignee must be a performer';
  end if;
  return new;
end $$;
create trigger validate_task before insert or update of object_id, assignee_id on public.tasks
for each row execute function private.validate_task();

create function private.record_task_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_status_history(task_id, actor_id, from_status, to_status)
  values (new.id, new.author_id, null, new.status);
  return new;
end $$;
create trigger record_task_creation after insert on public.tasks
for each row execute function private.record_task_creation();

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy objects_read on public.objects for select to authenticated using (deleted_at is null and (private.is_manager() or private.can_view_object(id)));
create policy objects_insert on public.objects for insert to authenticated with check (private.is_manager());
create policy objects_update on public.objects for update to authenticated using (deleted_at is null and private.is_manager()) with check (deleted_at is null and private.is_manager());
create policy tasks_read on public.tasks for select to authenticated using (deleted_at is null and (private.is_manager() or assignee_id = (select auth.uid())) and private.is_active_object(object_id));
create policy tasks_insert on public.tasks for insert to authenticated with check (private.is_manager());
create policy tasks_update on public.tasks for update to authenticated using (deleted_at is null and private.is_manager()) with check (deleted_at is null and private.is_manager());
create policy history_read on public.task_status_history for select to authenticated using (exists(select 1 from public.tasks where id = task_id));

revoke all on public.profiles, public.objects, public.tasks, public.task_status_history from public, anon, authenticated;
grant select on public.profiles, public.objects, public.tasks, public.task_status_history to authenticated;
grant insert (title, address), update (title, address) on public.objects to authenticated;
grant insert (title, description, object_id, assignee_id), update (title, description, object_id, assignee_id) on public.tasks to authenticated;

create function private.transition_task(p_task_id uuid, p_to_status public.task_status, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype; actor uuid := auth.uid();
begin
  select * into t from public.tasks where id = p_task_id and deleted_at is null
    and (private.is_manager() or (assignee_id = actor and exists(select 1 from public.profiles where id = actor and role = 'performer'))) for update;
  if not found then
    raise exception 'Task not found';
  end if;
  perform 1 from public.objects where id = t.object_id and deleted_at is null for share;
  if not found then raise exception 'Task not found'; end if;
  if p_to_status is null then raise exception 'Transition not allowed'; end if;
  if not ((actor = t.assignee_id and exists(select 1 from public.profiles where id = actor and role = 'performer')
    and ((t.status = 'new' and p_to_status = 'in_progress') or (t.status = 'rework' and p_to_status = 'in_progress') or (t.status = 'in_progress' and p_to_status = 'in_review')))
    or (private.is_manager() and t.status = 'in_review' and p_to_status in ('accepted', 'rework'))) then
    raise exception 'Transition not allowed';
  end if;
  if p_to_status = 'rework' and (p_comment is null or length(regexp_replace(p_comment, '[[:space:]]', '', 'g')) = 0) then
    raise exception 'A comment is required for rework';
  end if;
  update public.tasks set status = p_to_status where id = t.id;
  insert into public.task_status_history(task_id, actor_id, from_status, to_status, comment)
    values(t.id, actor, t.status, p_to_status, nullif(trim(p_comment), ''));
end $$;

create function private.delete_task(p_task_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_manager() then raise exception 'Not allowed'; end if;
  update public.tasks set deleted_at = now() where id = p_task_id and deleted_at is null;
  if not found then raise exception 'Task not found'; end if;
end $$;
create function private.delete_object(p_object_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_manager() then raise exception 'Not allowed'; end if;
  update public.objects set deleted_at = now() where id = p_object_id and deleted_at is null;
  if not found then raise exception 'Object not found'; end if;
end $$;

create function public.transition_task(p_task_id uuid, p_to_status public.task_status, p_comment text default null) returns void
language sql security invoker set search_path = '' as $$ select private.transition_task(p_task_id, p_to_status, p_comment) $$;
create function public.delete_task(p_task_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.delete_task(p_task_id) $$;
create function public.delete_object(p_object_id uuid) returns void
language sql security invoker set search_path = '' as $$ select private.delete_object(p_object_id) $$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_manager(), private.is_active_object(uuid), private.can_view_object(uuid), private.transition_task(uuid, public.task_status, text), private.delete_task(uuid), private.delete_object(uuid) to authenticated;
revoke all on function public.transition_task(uuid, public.task_status, text), public.delete_task(uuid), public.delete_object(uuid) from public, anon;
grant execute on function public.transition_task(uuid, public.task_status, text), public.delete_task(uuid), public.delete_object(uuid) to authenticated;
