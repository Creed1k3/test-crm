-- Run after migrations as the database owner: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
-- All fixtures are rolled back. Never run tests with a frontend connection string.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(command text, message text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then return; end;
  raise exception 'Expected error: %', message;
end $$;
create function pg_temp.expect_failure(command text, expected_state text, expected_message text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate = expected_state and sqlerrm = expected_message then return; end if;
    raise exception 'Unexpected error: [%] %, expected [%] %', sqlstate, sqlerrm, expected_state, expected_message;
  end;
  raise exception 'Expected error: [%] %', expected_state, expected_message;
end $$;

insert into auth.users(id, email) values
 ('10000000-0000-0000-0000-000000000001', 'manager-test@example.invalid'),
 ('10000000-0000-0000-0000-000000000002', 'performer1-test@example.invalid'),
 ('10000000-0000-0000-0000-000000000003', 'performer2-test@example.invalid');
insert into public.profiles(id, display_name, role) values
 ('10000000-0000-0000-0000-000000000001', 'Manager', 'manager'),
 ('10000000-0000-0000-0000-000000000002', 'Performer 1', 'performer'),
 ('10000000-0000-0000-0000-000000000003', 'Performer 2', 'performer');

set local role anon;
select pg_temp.expect_failure('select * from public.tasks', '42501', 'permission denied for table tasks');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
insert into public.objects(title, address) values ('Test object 1', 'Test address 1'), ('Test object 2', 'Test address 2');
insert into public.tasks(title, description, object_id, assignee_id)
select 'Test task 1', 'Task', id, '10000000-0000-0000-0000-000000000002' from public.objects where title = 'Test object 1';
insert into public.tasks(title, description, object_id, assignee_id)
select 'Test task 2', 'Task', id, '10000000-0000-0000-0000-000000000003' from public.objects where title = 'Test object 2';
insert into public.tasks(title, description, object_id, assignee_id)
select 'Test task 3', 'Task', id, '10000000-0000-0000-0000-000000000003' from public.objects where title = 'Test object 1';
update public.objects set address = 'Edited address' where title = 'Test object 1';
update public.tasks set description = 'Edited description' where title = 'Test task 1';
select pg_temp.assert_true((select address = 'Edited address' from public.objects where title = 'Test object 1'), 'manager edits object');
select pg_temp.assert_true((select description = 'Edited description' from public.tasks where title = 'Test task 1'), 'manager edits task');
select pg_temp.assert_true((select count(*) = 3 from public.tasks where title like 'Test task %'), 'manager sees tasks');
select pg_temp.assert_true((select count(*) = 3 from public.task_status_history h join public.tasks t on t.id = h.task_id where t.title like 'Test task %' and h.from_status is null and h.to_status = 'new'), 'creation history');
select set_config('test.other_task_id', (select id::text from public.tasks where title = 'Test task 2'), true);
select pg_temp.expect_error($q$insert into public.tasks(title, object_id, assignee_id) select 'Invalid', id, '10000000-0000-0000-0000-000000000001' from public.objects where title = 'Test object 1'$q$, 'manager cannot be an assignee');
select pg_temp.expect_error($q$update public.tasks set status = 'accepted' where title = 'Test task 1'$q$, 'manager cannot directly change status');
select pg_temp.expect_error($q$update public.tasks set author_id = '10000000-0000-0000-0000-000000000002' where title = 'Test task 1'$q$, 'author immutable');
select pg_temp.expect_error($q$insert into public.tasks(title, object_id, assignee_id, status) select 'Forged', id, '10000000-0000-0000-0000-000000000002', 'accepted' from public.objects where title = 'Test object 1'$q$, 'initial status immutable');
select pg_temp.expect_error($q$insert into public.task_status_history(task_id, actor_id, to_status) select id, '10000000-0000-0000-0000-000000000001', 'accepted' from public.tasks where title = 'Test task 1'$q$, 'history append forbidden');
select pg_temp.expect_error($q$delete from public.task_status_history$q$, 'history deletion forbidden');
select pg_temp.expect_error($q$update public.task_status_history set comment = 'fake'$q$, 'history modification forbidden');
select pg_temp.expect_error($q$update public.profiles set role = 'manager'$q$, 'profile changes forbidden');
select pg_temp.expect_failure($q$select public.transition_task(id, 'accepted') from public.tasks where title = 'Test task 1'$q$, 'P0001', 'Transition not allowed');
select pg_temp.expect_failure($q$select public.transition_task(id, null) from public.tasks where title = 'Test task 1'$q$, 'P0001', 'Transition not allowed');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true((select count(*) = 1 from public.tasks where title like 'Test task %'), 'performer sees only assigned tasks');
select pg_temp.assert_true((select count(*) = 1 from public.objects where title like 'Test object %'), 'performer sees only assigned objects');
select pg_temp.assert_true((select count(*) = 1 from public.task_status_history h join public.tasks t on t.id = h.task_id where t.title like 'Test task %'), 'performer sees only assigned history');
select pg_temp.assert_true((select count(*) = 0 from public.tasks where id = current_setting('test.other_task_id')::uuid), 'foreign task inaccessible by id');
select pg_temp.assert_true((select count(*) = 0 from public.task_status_history where task_id = current_setting('test.other_task_id')::uuid), 'foreign history inaccessible without join');
select pg_temp.expect_failure(format('select public.transition_task(%L::uuid, %L)', current_setting('test.other_task_id'), 'in_progress'), 'P0001', 'Task not found');
select pg_temp.expect_failure($q$select public.transition_task('ffffffff-ffff-ffff-ffff-ffffffffffff', 'in_progress')$q$, 'P0001', 'Task not found');
update public.tasks set title = 'Forged foreign title' where id = current_setting('test.other_task_id')::uuid;
update public.tasks set title = 'Forged title' where title = 'Test task 1';
select pg_temp.assert_true((select count(*) = 0 from public.tasks where title = 'Forged title'), 'performer cannot edit a task');
select pg_temp.expect_error($q$insert into public.objects(title, address) values ('Forged', 'Forged')$q$, 'performer cannot create objects');
select pg_temp.expect_error($q$select public.delete_task(id) from public.tasks where title = 'Test task 1'$q$, 'performer cannot delete tasks');
select pg_temp.expect_failure($q$select public.transition_task(id, 'accepted') from public.tasks where title = 'Test task 1'$q$, 'P0001', 'Transition not allowed');
select public.transition_task(id, 'in_progress') from public.tasks where title = 'Test task 1';
select public.transition_task(id, 'in_review') from public.tasks where title = 'Test task 1';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select pg_temp.expect_failure($q$select public.transition_task(id, 'rework', E' \t\n') from public.tasks where title = 'Test task 1'$q$, 'P0001', 'A comment is required for rework');
select public.transition_task(id, 'rework', 'Fix the details') from public.tasks where title = 'Test task 1';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select public.transition_task(id, 'in_progress') from public.tasks where title = 'Test task 1';
select public.transition_task(id, 'in_review') from public.tasks where title = 'Test task 1';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.transition_task(id, 'accepted') from public.tasks where title = 'Test task 1';
select pg_temp.assert_true((select count(*) = 7 from public.task_status_history h join public.tasks t on t.id = h.task_id where t.title = 'Test task 1'), 'complete history');
update public.tasks set assignee_id = '10000000-0000-0000-0000-000000000003' where title = 'Test task 1';
select pg_temp.assert_true((select title = 'Test task 2' from public.tasks where id = current_setting('test.other_task_id')::uuid), 'foreign update changed no rows');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true((select count(*) = 0 from public.tasks where title = 'Test task 1'), 'former assignee loses task');
select pg_temp.assert_true((select count(*) = 0 from public.objects where title = 'Test object 1'), 'former assignee loses object');
select pg_temp.assert_true((select count(*) = 0 from public.task_status_history), 'former assignee loses history');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true((select count(*) = 3 from public.tasks where title like 'Test task %'), 'second performer sees assigned tasks after reassignment');
select pg_temp.assert_true((select count(*) = 2 from public.objects where title like 'Test object %'), 'second performer sees both objects');
select pg_temp.assert_true((select count(*) = 9 from public.task_status_history), 'second performer sees assigned history');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.delete_task(id) from public.tasks where title = 'Test task 1';
select public.delete_object(id) from public.objects where title = 'Test object 2';
select pg_temp.assert_true((select count(*) = 1 from public.tasks where title like 'Test task %'), 'deleted records hidden');
reset role;
select pg_temp.assert_true((select count(*) = 7 from public.task_status_history h join public.tasks t on t.id = h.task_id where t.title = 'Test task 1'), 'task history preserved');
select pg_temp.assert_true((select count(*) = 1 from public.task_status_history h join public.tasks t on t.id = h.task_id where t.title = 'Test task 2'), 'object deletion preserves history');
rollback;
