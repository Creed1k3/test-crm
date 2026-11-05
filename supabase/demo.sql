-- Run once in a fresh demo project after creating the three Auth users from README.md.
do $$
declare
  manager_id uuid;
  alex_id uuid;
  maria_id uuid;
  shared_object uuid;
  private_object uuid;
  review_task uuid;
  rework_task uuid;
  accepted_task uuid;
begin
  select id into strict manager_id from auth.users where email = 'crm-manager@example.com';
  select id into strict alex_id from auth.users where email = 'crm-alex@example.com';
  select id into strict maria_id from auth.users where email = 'crm-maria@example.com';

  insert into public.profiles (id, display_name, role) values
    (manager_id, 'Анна Смирнова', 'manager'),
    (alex_id, 'Алексей Орлов', 'performer'),
    (maria_id, 'Мария Волкова', 'performer');

  insert into public.objects (title, address) values ('ЖК «Северный»', 'ул. Сосновая, 14')
  returning id into shared_object;
  insert into public.objects (title, address) values ('Склад «Восточный»', 'Промышленный проезд, 6')
  returning id into private_object;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  insert into public.tasks (title, description, object_id, assignee_id) values
    ('Проверить армирование плиты', 'Сверить шаг арматуры со схемой и приложить результаты замеров.', shared_object, alex_id),
    ('Разметить оси под перегородки', 'Начать с первого этажа, отметить спорные участки на плане.', shared_object, maria_id);
  insert into public.tasks (title, description, object_id, assignee_id) values
    ('Сдать фотоотчёт по секции А', 'Собрать фотографии по этажам.', shared_object, alex_id)
  returning id into review_task;
  insert into public.tasks (title, description, object_id, assignee_id) values
    ('Проверить закладные у ворот', 'Сверить положение с монтажной схемой.', private_object, maria_id)
  returning id into rework_task;
  insert into public.tasks (title, description, object_id, assignee_id) values
    ('Замерить проём под ворота', 'Снять ширину и высоту по чистовым отметкам.', private_object, maria_id)
  returning id into accepted_task;

  perform set_config('request.jwt.claim.sub', alex_id::text, true);
  perform public.transition_task(review_task, 'in_progress');
  perform public.transition_task(review_task, 'in_review');
  perform set_config('request.jwt.claim.sub', maria_id::text, true);
  perform public.transition_task(rework_task, 'in_progress');
  perform public.transition_task(rework_task, 'in_review');
  perform public.transition_task(accepted_task, 'in_progress');
  perform public.transition_task(accepted_task, 'in_review');
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform public.transition_task(rework_task, 'rework', 'Добавить замеры для левой стороны проёма.');
  perform public.transition_task(accepted_task, 'accepted');
end;
$$;
