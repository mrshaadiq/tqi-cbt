-- 0003_exam_functions.sql : semua logika ujian peserta. Memakai now() database.

-- jam server (untuk hitung mundur sebelum attempt ada)
create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now(); $$;

-- cek token sesi aktif milik pemanggil
create or replace function public._check_token(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_token is null or not exists (
    select 1 from public.profiles where id = auth.uid() and session_token = p_token
  ) then
    raise exception 'session_replaced';
  end if;
end $$;

-- login baru menimpa token sesi
create or replace function public.claim_session() returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update public.profiles set session_token = t where id = auth.uid();
  return t;
end $$;

-- penilaian: idempotent, hanya dipanggil dari fungsi lain
create or replace function public.grade_attempt(p_attempt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_correct int;
begin
  select count(*),
         count(*) filter (where k.option_id is not null and a.option_id = k.option_id)
    into v_total, v_correct
  from public.attempt_questions aq
  left join public.answers a on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
  left join public.answer_keys k on k.question_id = aq.question_id
  where aq.attempt_id = p_attempt_id;

  update public.attempts
     set correct_count = v_correct,
         score = round(v_correct * 100.0 / greatest(v_total, 1), 2),
         status = case when submitted_at is not null then 'submitted' else 'expired' end
   where id = p_attempt_id;
end $$;

create or replace function public.start_attempt(p_exam_id uuid, p_token uuid)
returns public.attempts
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_exam public.exams;
  v_att public.attempts;
  v_total int; v_bad int;
begin
  perform public._check_token(p_token);

  -- sudah punya attempt: kembalikan yang ada (idempotent, tetap boleh walau jendela tutup)
  select * into v_att from public.attempts where user_id = v_uid and exam_id = p_exam_id;
  if found then return v_att; end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'exam_not_found'; end if;
  if now() < v_exam.opens_at or now() > v_exam.closes_at then raise exception 'window_closed'; end if;

  select count(*) into v_total from public.questions where is_active;
  select count(*) into v_bad from public.questions q
   where q.is_active and (
     not exists (select 1 from public.answer_keys k where k.question_id = q.id)
     or (select count(*) from public.options o where o.question_id = q.id) < 2);
  if v_total = 0 or v_bad > 0 then raise exception 'no_active_questions'; end if;

  insert into public.attempts (exam_id, user_id, started_at, ends_at, status)
  values (p_exam_id, v_uid, now(), now() + make_interval(mins => v_exam.duration_minutes), 'in_progress')
  on conflict (user_id, exam_id) do nothing
  returning * into v_att;

  if v_att.id is null then  -- kalah balapan (dua tab): ambil yang sudah dibuat
    select * into v_att from public.attempts where user_id = v_uid and exam_id = p_exam_id;
    return v_att;
  end if;

  insert into public.attempt_questions (attempt_id, question_id, position, option_order)
  select v_att.id, q.id, row_number() over (order by random()),
         (select array_agg(o.id order by random()) from public.options o where o.question_id = q.id)
    from public.questions q where q.is_active;

  return v_att;
end $$;

create or replace function public.get_attempt_state(p_attempt_id uuid, p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_att public.attempts;
begin
  perform public._check_token(p_token);
  select * into v_att from public.attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then raise exception 'forbidden'; end if;

  -- waktu habis tanpa submit: nilai otomatis (tidak perlu menunggu admin)
  if v_att.status = 'in_progress' and now() > v_att.ends_at + interval '5 seconds' then
    perform public.grade_attempt(v_att.id);
    select * into v_att from public.attempts where id = v_att.id;
  end if;

  return jsonb_build_object(
    'attempt_id', v_att.id,
    'server_now', now(),
    'started_at', v_att.started_at,
    'ends_at', v_att.ends_at,
    'status', v_att.status,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'position', aq.position, 'stimulus', q.stimulus, 'body', q.body, 'image_path', q.image_path,
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'body', o.body, 'image_path', o.image_path)
                                    order by array_position(aq.option_order, o.id)), '[]'::jsonb)
          from public.options o where o.question_id = q.id)
      ) order by aq.position)
      from public.attempt_questions aq join public.questions q on q.id = aq.question_id
      where aq.attempt_id = v_att.id), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'option_id', a.option_id, 'flagged', a.flagged))
      from public.answers a where a.attempt_id = v_att.id), '[]'::jsonb),
    'snapshot_slots', coalesce((
      select jsonb_agg(s.slot) from public.snapshots s where s.attempt_id = v_att.id), '[]'::jsonb)
  );
end $$;

create or replace function public.save_answer(
  p_attempt_id uuid, p_question_id uuid, p_option_id uuid, p_flagged boolean, p_client_seq bigint, p_token uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare v_att public.attempts;
begin
  perform public._check_token(p_token);
  select * into v_att from public.attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then raise exception 'forbidden'; end if;
  if v_att.submitted_at is not null or v_att.status <> 'in_progress'
     or now() > v_att.ends_at + interval '5 seconds' then
    raise exception 'time_over';
  end if;
  if not exists (select 1 from public.attempt_questions where attempt_id = p_attempt_id and question_id = p_question_id) then
    raise exception 'forbidden';
  end if;
  if p_option_id is not null and not exists (
    select 1 from public.options where id = p_option_id and question_id = p_question_id) then
    raise exception 'invalid_option';
  end if;

  insert into public.answers (attempt_id, question_id, option_id, flagged, client_seq, updated_at)
  values (p_attempt_id, p_question_id, p_option_id, coalesce(p_flagged, false), p_client_seq, now())
  on conflict (attempt_id, question_id) do update
     set option_id = excluded.option_id, flagged = excluded.flagged,
         client_seq = excluded.client_seq, updated_at = now()
   where public.answers.client_seq < excluded.client_seq;  -- jawaban lama tidak menimpa yang baru
end $$;

create or replace function public.submit_attempt(p_attempt_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_att public.attempts;
begin
  perform public._check_token(p_token);
  select * into v_att from public.attempts where id = p_attempt_id and user_id = auth.uid() for update;
  if not found then raise exception 'forbidden'; end if;
  if v_att.status <> 'in_progress' then return; end if;  -- sudah selesai: aman diulang
  update public.attempts set submitted_at = now(), status = 'submitted' where id = p_attempt_id;
  perform public.grade_attempt(p_attempt_id);
end $$;

create or replace function public.log_event(p_attempt_id uuid, p_type text, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_token(p_token);
  if not exists (select 1 from public.attempts where id = p_attempt_id and user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;
  insert into public.events (attempt_id, type) values (p_attempt_id, left(p_type, 40));
end $$;

create or replace function public.record_snapshot(p_attempt_id uuid, p_slot int, p_path text, p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._check_token(p_token);
  if not exists (select 1 from public.attempts
                 where id = p_attempt_id and user_id = auth.uid() and status = 'in_progress') then
    raise exception 'forbidden';
  end if;
  if p_path not like p_attempt_id::text || '/%' then raise exception 'invalid_path'; end if;
  insert into public.snapshots (attempt_id, slot, path) values (p_attempt_id, p_slot, p_path)
  on conflict (attempt_id, slot) do nothing;
end $$;

-- hak akses: hanya pengguna login yang boleh memanggil; grade_attempt dan _check_token tertutup
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.grade_attempt(uuid) from authenticated;
revoke execute on function public._check_token(uuid) from authenticated;
grant execute on function
  public.server_now(), public.claim_session(), public.start_attempt(uuid, uuid),
  public.get_attempt_state(uuid, uuid),
  public.save_answer(uuid, uuid, uuid, boolean, bigint, uuid),
  public.submit_attempt(uuid, uuid), public.log_event(uuid, text, uuid),
  public.record_snapshot(uuid, int, text, uuid), public.is_admin()
to authenticated;
