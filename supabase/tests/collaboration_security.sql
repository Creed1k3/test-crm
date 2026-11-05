-- Run after migrations as the database owner. Fixtures roll back at the end.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_failure(command text, expected_state text, expected_message text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = expected_state and sqlerrm = expected_message then return; end if;
    raise exception 'Unexpected error: [%] %, expected [%] %', sqlstate, sqlerrm, expected_state, expected_message;
  end;
  raise exception 'Expected error: [%] %', expected_state, expected_message;
end $$;

insert into auth.users(id, email) values
 ('20000000-0000-0000-0000-000000000001', 'collab-manager@example.invalid'),
 ('20000000-0000-0000-0000-000000000002', 'collab-a@example.invalid'),
 ('20000000-0000-0000-0000-000000000003', 'collab-b@example.invalid'),
 ('20000000-0000-0000-0000-000000000004', 'collab-c@example.invalid');
insert into public.profiles(id, display_name, role) values
 ('20000000-0000-0000-0000-000000000001', 'Manager', 'manager'),
 ('20000000-0000-0000-0000-000000000002', 'A', 'performer'),
 ('20000000-0000-0000-0000-000000000003', 'B', 'performer'),
 ('20000000-0000-0000-0000-000000000004', 'C', 'performer');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
insert into public.objects(title, address) values ('Collaboration object', 'Address');
select set_config('test.object', (select id::text from public.objects where title = 'Collaboration object'), true);
select set_config('test.pool', public.save_task(null, 'Pool task', '', current_setting('test.object')::uuid,
  'candidates', null, array['20000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000003'::uuid])::text, true);
select set_config('test.open', public.save_task(null, 'Open task', '', current_setting('test.object')::uuid,
  'open', null, '{}')::text, true);
select set_config('test.direct', public.save_task(null, 'B task', '', current_setting('test.object')::uuid,
  'direct', '20000000-0000-0000-0000-000000000003', '{}')::text, true);
select pg_temp.assert_true((select count(*) = 2 from public.task_candidates where task_id = current_setting('test.pool')::uuid), 'manager sees candidates');
select pg_temp.expect_failure(format('select public.save_task(null, %L, %L, %L::uuid, %L, null, array[%L::uuid])',
  'Bad pool', '', current_setting('test.object'), 'candidates', '20000000-0000-0000-0000-000000000002'), 'P0001', 'Invalid candidates');
select pg_temp.expect_failure(format('select public.save_task(null, %L, %L, %L::uuid, %L, null, array[%L::uuid,%L::uuid])',
  'Bad pool', '', current_setting('test.object'), 'candidates', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001'), 'P0001', 'Invalid candidates');
insert into public.task_comments(task_id, body) values (current_setting('test.pool')::uuid, 'Manager comment');
select pg_temp.assert_true(private.attachment_task_id(current_setting('test.pool') || '/photo.jpg') = current_setting('test.pool')::uuid, 'attachment path identifies task');
select pg_temp.assert_true(private.attachment_task_id('not-a-task/photo.jpg') is null, 'invalid attachment path rejected');
select pg_temp.assert_true(private.attachment_task_id(current_setting('test.pool') || '/nested/photo.jpg') is null, 'nested attachment path rejected');
select pg_temp.assert_true(private.lock_task_for_action(current_setting('test.pool')::uuid, true), 'manager can upload');
select pg_temp.expect_failure('update public.task_comments set body = ''changed''', '42501', 'permission denied for table task_comments');
select pg_temp.expect_failure('delete from public.task_comments', '42501', 'permission denied for table task_comments');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true((select count(*) = 0 from public.tasks where id = current_setting('test.pool')::uuid), 'noncandidate cannot see pool');
select pg_temp.assert_true((select count(*) = 1 from public.tasks where id = current_setting('test.open')::uuid), 'performer can see open task');
select pg_temp.expect_failure(format('select public.claim_task(%L::uuid)', current_setting('test.pool')), 'P0001', 'Task not found');
select pg_temp.expect_failure(format('insert into public.task_comments(task_id, body) values (%L::uuid, %L)', current_setting('test.pool'), 'Foreign comment'), 'P0001', 'Task not found');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true((select count(*) = 1 from public.tasks where id = current_setting('test.pool')::uuid), 'candidate sees pool');
select pg_temp.assert_true((select count(*) = 1 from public.task_candidates where task_id = current_setting('test.pool')::uuid), 'candidate sees only own candidacy');
select pg_temp.assert_true((select count(*) = 1 from public.task_comments where task_id = current_setting('test.pool')::uuid), 'candidate sees pool comments');
select pg_temp.assert_true(not private.lock_task_for_action(current_setting('test.pool')::uuid, true), 'candidate cannot upload before claim');
insert into public.task_comments(task_id, body) values (current_setting('test.pool')::uuid, 'Candidate B comment');
select pg_temp.expect_failure(format('insert into public.task_comments(task_id, body, author_id) values (%L::uuid, %L, %L::uuid)',
  current_setting('test.pool'), 'Forged', '20000000-0000-0000-0000-000000000002'), '42501', 'permission denied for table task_comments');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select public.claim_task(current_setting('test.pool')::uuid);
select pg_temp.assert_true((select status = 'in_progress' and assignment_mode = 'direct' and assignee_id = '20000000-0000-0000-0000-000000000002' from public.tasks where id = current_setting('test.pool')::uuid), 'claim assigns and starts task');
select pg_temp.assert_true((select count(*) = 2 from public.task_status_history where task_id = current_setting('test.pool')::uuid), 'claim saved history');
select pg_temp.assert_true(private.lock_task_for_action(current_setting('test.pool')::uuid, true), 'assignee can upload during work');
select pg_temp.assert_true((select count(*) = 1 from public.profiles where id = '20000000-0000-0000-0000-000000000003'), 'claimed task shows earlier comment author');
insert into public.task_comments(task_id, body) values (current_setting('test.pool')::uuid, 'Work started');
select pg_temp.expect_failure(format('select public.save_task(%L::uuid, %L, %L, %L::uuid, %L, null, %L::uuid[])',
  current_setting('test.pool'), 'Denied', '', current_setting('test.object'), 'open', '{}'), 'P0001', 'Not allowed');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true((select count(*) = 1 from public.objects where id = current_setting('test.object')::uuid), 'other performer still sees object through own task');
select pg_temp.assert_true((select count(*) = 0 from public.tasks where id = current_setting('test.pool')::uuid), 'claimed task hidden from other candidate');
select pg_temp.assert_true((select count(*) = 0 from public.task_comments where task_id = current_setting('test.pool')::uuid), 'claimed comments hidden from other candidate');
select pg_temp.assert_true((select count(*) = 0 from public.task_status_history where task_id = current_setting('test.pool')::uuid), 'claimed history hidden from other candidate');
select pg_temp.assert_true(not private.lock_task_for_action(current_setting('test.pool')::uuid, true), 'other candidate cannot upload after claim');
select pg_temp.expect_failure(format('select public.claim_task(%L::uuid)', current_setting('test.pool')), 'P0001', 'Task not found');
select pg_temp.expect_failure(format('insert into public.task_comments(task_id, body) values (%L::uuid, %L)', current_setting('test.pool'), 'No longer visible'), 'P0001', 'Task not found');
select public.claim_task(current_setting('test.open')::uuid);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select pg_temp.expect_failure(format('select public.save_task(%L::uuid, %L, %L, %L::uuid, %L, null, %L::uuid[])',
  current_setting('test.pool'), 'Denied', '', current_setting('test.object'), 'open', '{}'), 'P0001', 'Task already started');
select public.save_task(current_setting('test.pool')::uuid, 'Reassigned', '', current_setting('test.object')::uuid,
  'direct', '20000000-0000-0000-0000-000000000004', '{}');
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true((select count(*) = 1 from public.tasks where id = current_setting('test.pool')::uuid), 'new assignee sees task');
select pg_temp.assert_true((select count(*) = 3 from public.task_comments where task_id = current_setting('test.pool')::uuid), 'new assignee sees prior comments');
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select pg_temp.assert_true((select count(*) = 0 from public.tasks where id = current_setting('test.pool')::uuid), 'former assignee loses task');
select pg_temp.assert_true((select count(*) = 0 from public.task_comments where task_id = current_setting('test.pool')::uuid), 'former assignee loses comments');
rollback;
