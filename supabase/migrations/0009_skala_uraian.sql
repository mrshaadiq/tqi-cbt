-- 0009_skala_uraian.sql : jenis soal kuesioner yang TIDAK ikut nilai total
--   skala  : pernyataan dengan pilihan berbobot 1..n (opsi A = 1). reverse = skor dibalik (n+1-bobot).
--            Skor dijumlah per bagian ke attempts.scale_scores.
--   uraian : jawaban teks panjang tanpa kunci, dibaca panitia.

alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check check (type in ('pg', 'isian', 'skala', 'uraian'));
alter table public.questions add column reverse boolean not null default false;
alter table public.attempts add column scale_scores jsonb;

-- bobot pilihan skala: urutan huruf (A=1), dibalik bila reverse
create or replace function public._scale_weight(p_qid uuid, p_option uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when q.reverse then n.cnt + 1 - w.idx else w.idx end
    from public.questions q,
         (select count(*)::int cnt from public.options where question_id = p_qid) n,
         (select (ascii(label) - 64)::int idx from public.options where id = p_option and question_id = p_qid) w
   where q.id = p_qid;
$$;

create or replace function public.grade_attempt(p_attempt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_correct int; v_sections jsonb; v_scales jsonb;
begin
  -- soal bernilai (pg, isian)
  with g as (
    select q.section, coalesce(public._is_correct(q.type, a, k), false) as ok,
           min(q.position) over (partition by q.section) as sec_order
      from public.attempt_questions aq
      join public.questions q on q.id = aq.question_id
      left join public.answers a on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
      left join public.answer_keys k on k.question_id = aq.question_id
     where aq.attempt_id = p_attempt_id and q.type in ('pg', 'isian')
  ), s as (
    select section, min(sec_order) as o, count(*) as total, count(*) filter (where ok) as benar
      from g group by section
  )
  select (select count(*) from g), (select count(*) filter (where ok) from g),
         coalesce((select jsonb_agg(jsonb_build_object('section', section, 'total', total, 'correct', benar,
                     'score', round(benar * 100.0 / greatest(total, 1), 2)) order by o) from s), '[]'::jsonb)
    into v_total, v_correct, v_sections;

  -- skala: jumlah bobot per bagian
  with g as (
    select q.section, min(q.position) over (partition by q.section) as sec_order,
           case when a.option_id is not null then public._scale_weight(q.id, a.option_id) end as w,
           (select count(*) from public.options o where o.question_id = q.id)::int as maxw
      from public.attempt_questions aq
      join public.questions q on q.id = aq.question_id
      left join public.answers a on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
     where aq.attempt_id = p_attempt_id and q.type = 'skala'
  )
  select coalesce(jsonb_agg(jsonb_build_object('section', section, 'score', score, 'max', mx,
                    'answered', answered, 'total', total) order by o), '[]'::jsonb)
    into v_scales
    from (select section, min(sec_order) o, coalesce(sum(w), 0)::int score, sum(maxw)::int mx,
                 count(w)::int answered, count(*)::int total
            from g group by section) x;

  update public.attempts
     set correct_count = v_correct,
         score = round(v_correct * 100.0 / greatest(v_total, 1), 2),
         section_scores = v_sections,
         scale_scores = v_scales,
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

  select * into v_att from public.attempts where user_id = v_uid and exam_id = p_exam_id;
  if found then return v_att; end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'exam_not_found'; end if;
  if now() < v_exam.opens_at or now() > v_exam.closes_at then raise exception 'window_closed'; end if;

  select count(*) into v_total from public.questions where is_active;
  select count(*) into v_bad from public.questions q
   where q.is_active and (
     (q.type = 'pg' and (
        not exists (select 1 from public.answer_keys k where k.question_id = q.id and k.option_id is not null)
        or (select count(*) from public.options o where o.question_id = q.id) < 2))
     or (q.type = 'isian' and not exists (
        select 1 from public.answer_keys k where k.question_id = q.id and coalesce(cardinality(k.accepted), 0) > 0))
     or (q.type = 'skala' and (select count(*) from public.options o where o.question_id = q.id) < 2));
  if v_total = 0 or v_bad > 0 then raise exception 'no_active_questions'; end if;

  insert into public.attempts (exam_id, user_id, started_at, ends_at, status)
  values (p_exam_id, v_uid, now(), now() + make_interval(mins => v_exam.duration_minutes), 'in_progress')
  on conflict (user_id, exam_id) do nothing
  returning * into v_att;

  if v_att.id is null then
    select * into v_att from public.attempts where user_id = v_uid and exam_id = p_exam_id;
    return v_att;
  end if;

  -- bagian berurutan, soal diacak di dalam bagian; opsi skala TIDAK diacak (tetap 1..n)
  insert into public.attempt_questions (attempt_id, question_id, position, option_order)
  select v_att.id, x.id, row_number() over (order by x.sec_order, random()),
         coalesce((select array_agg(o.id order by case when x.type = 'skala' then 0 else random() end, o.label)
                     from public.options o where o.question_id = x.id), '{}')
    from (select q.id, q.type, min(q.position) over (partition by q.section) as sec_order
            from public.questions q where q.is_active) x;

  return v_att;
end $$;

create or replace function public.save_answer(
  p_attempt_id uuid, p_question_id uuid, p_option_id uuid, p_flagged boolean, p_client_seq bigint, p_token uuid,
  p_answer_text text default null
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

  insert into public.answers (attempt_id, question_id, option_id, answer_text, flagged, client_seq, updated_at)
  values (p_attempt_id, p_question_id, p_option_id, nullif(left(p_answer_text, 5000), ''),
          coalesce(p_flagged, false), p_client_seq, now())
  on conflict (attempt_id, question_id) do update
     set option_id = excluded.option_id, answer_text = excluded.answer_text, flagged = excluded.flagged,
         client_seq = excluded.client_seq, updated_at = now()
   where public.answers.client_seq < excluded.client_seq;
end $$;

-- get_attempt_state: tambah 'reverse' tidak perlu (peserta tidak boleh tahu); tipe sudah dikirim.

-- ------------------------------ admin: bank soal ------------------------------
create or replace function public.admin_save_questions(p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare q jsonb; o jsonb; v_qid uuid; v_oid uuid; v_pos int; v_cnt int := 0; v_type text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select coalesce(max(position), 0) into v_pos from public.questions;
  for q in select * from jsonb_array_elements(p_payload) loop
    v_pos := v_pos + 1;
    v_type := coalesce(q->>'type', 'pg');
    insert into public.questions (position, section, type, reverse, stimulus, body, image_path, is_active)
    values (v_pos, coalesce(nullif(btrim(q->>'section'), ''), 'Umum'), v_type,
            v_type = 'skala' and coalesce((q->>'reverse')::boolean, false),
            nullif(q->>'stimulus', ''), q->>'body', nullif(q->>'image_path', ''),
            coalesce((q->>'is_active')::boolean, true))
    returning id into v_qid;
    if v_type = 'isian' then
      perform public._save_key(v_qid, q);
    elsif v_type in ('pg', 'skala') then
      for o in select * from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) loop
        insert into public.options (question_id, label, body, image_path)
        values (v_qid, o->>'label', coalesce(o->>'body', ''), nullif(o->>'image_path', ''))
        returning id into v_oid;
        if v_type = 'pg' and o->>'label' = q->>'answer' then
          insert into public.answer_keys (question_id, option_id) values (v_qid, v_oid);
        end if;
      end loop;
      if v_type = 'pg' and not exists (select 1 from public.answer_keys where question_id = v_qid) then
        raise exception 'soal_ke_% tidak punya kunci yang cocok', v_cnt + 1;
      end if;
      if v_type = 'skala' and (select count(*) from public.options where question_id = v_qid) < 2 then
        raise exception 'soal_ke_% (skala) butuh minimal dua pilihan', v_cnt + 1;
      end if;
    end if;
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end $$;

create or replace function public.admin_update_question(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb; v_oid uuid; v_labels text[] := '{}'; v_type text := coalesce(p->>'type', 'pg');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.questions
     set stimulus = nullif(p->>'stimulus', ''), body = p->>'body',
         section = coalesce(nullif(btrim(p->>'section'), ''), section),
         type = v_type,
         reverse = v_type = 'skala' and coalesce((p->>'reverse')::boolean, false),
         image_path = nullif(p->>'image_path', ''), is_active = coalesce((p->>'is_active')::boolean, is_active)
   where id = p_id;
  if not found then raise exception 'not_found'; end if;

  if v_type = 'isian' then
    perform public._save_key(p_id, p);
    return;
  end if;
  if v_type = 'uraian' then
    delete from public.answer_keys where question_id = p_id;
    delete from public.options where question_id = p_id;
    return;
  end if;

  for o in select * from jsonb_array_elements(coalesce(p->'options', '[]'::jsonb)) loop
    v_labels := v_labels || (o->>'label');
    insert into public.options (question_id, label, body, image_path)
    values (p_id, o->>'label', coalesce(o->>'body', ''), nullif(o->>'image_path', ''))
    on conflict (question_id, label) do update set body = excluded.body, image_path = excluded.image_path
    returning id into v_oid;
    if v_type = 'pg' and o->>'label' = p->>'answer' then
      insert into public.answer_keys (question_id, option_id, accepted) values (p_id, v_oid, null)
      on conflict (question_id) do update set option_id = excluded.option_id, accepted = null;
    end if;
  end loop;
  delete from public.options where question_id = p_id and label <> all (v_labels::char(1)[]);
  if v_type = 'skala' then
    delete from public.answer_keys where question_id = p_id;
    if (select count(*) from public.options where question_id = p_id) < 2 then
      raise exception 'skala butuh minimal dua pilihan';
    end if;
  elsif not exists (select 1 from public.answer_keys where question_id = p_id and option_id is not null) then
    raise exception 'kunci tidak cocok dengan opsi';
  end if;
end $$;

-- ------------------------------ admin: hasil ------------------------------
create or replace function public.admin_attempt_detail(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'attempt', (select jsonb_build_object('id', a.id, 'full_name', p.full_name, 'participant_no', p.participant_no,
                  'status', a.status, 'score', a.score, 'correct_count', a.correct_count,
                  'section_scores', a.section_scores, 'scale_scores', a.scale_scores,
                  'started_at', a.started_at, 'ends_at', a.ends_at, 'submitted_at', a.submitted_at)
                from public.attempts a join public.profiles p on p.id = a.user_id where a.id = p_attempt_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'position', aq.position, 'section', q.section, 'type', q.type, 'question', q.body,
        'reverse', q.reverse,
        'chosen', case when q.type in ('isian', 'uraian') then a.answer_text
                       else (select o.body from public.options o where o.id = a.option_id) end,
        'correct', case when q.type = 'isian' then array_to_string(k.accepted, ' | ')
                        when q.type = 'pg' then (select o.body from public.options o where o.id = k.option_id) end,
        'is_correct', case when q.type in ('pg', 'isian') then coalesce(public._is_correct(q.type, a, k), false) end,
        'weight', case when q.type = 'skala' and a.option_id is not null then public._scale_weight(q.id, a.option_id) end,
        'manual_correct', a.manual_correct,
        'flagged', coalesce(a.flagged, false)) order by aq.position)
      from public.attempt_questions aq
      join public.questions q on q.id = aq.question_id
      left join public.answers a on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
      left join public.answer_keys k on k.question_id = q.id
      where aq.attempt_id = p_attempt_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'created_at', e.created_at) order by e.created_at)
                        from public.events e where e.attempt_id = p_attempt_id), '[]'::jsonb)
  );
end $$;

-- koreksi manual hanya untuk soal isian
create or replace function public.admin_set_manual_correct(p_attempt_id uuid, p_question_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select status into v_status from public.attempts where id = p_attempt_id;
  if v_status is null then raise exception 'not_found'; end if;
  if v_status = 'in_progress' then raise exception 'masih_dikerjakan'; end if;
  if not exists (select 1 from public.attempt_questions aq join public.questions q on q.id = aq.question_id
                  where aq.attempt_id = p_attempt_id and aq.question_id = p_question_id and q.type = 'isian') then
    raise exception 'not_found';
  end if;
  insert into public.answers (attempt_id, question_id, manual_correct)
  values (p_attempt_id, p_question_id, p_value)
  on conflict (attempt_id, question_id) do update set manual_correct = excluded.manual_correct;
  perform public.grade_attempt(p_attempt_id);
end $$;

drop view public.results;
create view public.results with (security_invoker = true) as
select a.id as attempt_id, p.full_name, p.participant_no, a.score, a.correct_count, a.status,
       a.section_scores, a.scale_scores,
       (select count(*) from public.answers x join public.questions q on q.id = x.question_id
         where x.attempt_id = a.id and q.type in ('pg', 'isian')
           and (x.option_id is not null or coalesce(x.answer_text, '') <> ''))::int as terjawab,
       (select count(*) from public.attempt_questions aq join public.questions q on q.id = aq.question_id
         where aq.attempt_id = a.id and q.type in ('pg', 'isian'))::int as total_soal,
       pm.passed,
       (select count(*) from public.events e where e.attempt_id = a.id)::int as kejadian,
       rank() over (order by a.score desc nulls last) as rank
  from public.attempts a
  join public.profiles p on p.id = a.user_id
  left join public.pass_marks pm on pm.attempt_id = a.id
 where a.status in ('submitted', 'expired') and public.is_admin();

do $$ declare r record; begin
  for r in select id from public.attempts where status in ('submitted', 'expired') loop
    perform public.grade_attempt(r.id);
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.grade_attempt(uuid) from authenticated;
revoke execute on function public._scale_weight(uuid, uuid) from authenticated;
grant select on public.results to authenticated;
