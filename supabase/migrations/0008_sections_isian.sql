-- 0008_sections_isian.sql : beberapa section dalam satu ujian + soal isian singkat
-- Satu timer untuk seluruh ujian. Soal isian dinilai otomatis (cocok dengan salah satu kunci
-- setelah dinormalisasi) dan bisa dikoreksi manual oleh admin.

-- ------------------------------ skema ------------------------------
alter table public.questions
  add column section text not null default 'Umum',
  add column type text not null default 'pg' check (type in ('pg', 'isian'));

-- kunci isian: daftar jawaban yang diterima. Soal PG tetap memakai option_id.
alter table public.answer_keys alter column option_id drop not null;
alter table public.answer_keys add column accepted text[];
alter table public.answer_keys add constraint answer_keys_one_kind
  check ((option_id is not null) <> (coalesce(cardinality(accepted), 0) > 0));

alter table public.answers
  add column answer_text text,
  add column manual_correct boolean;  -- null = pakai penilaian otomatis

alter table public.attempts add column section_scores jsonb;

-- ------------------------------ penilaian ------------------------------
create or replace function public.norm_answer(t text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(t, '')), '[^[:alnum:][:space:]]', '', 'g'), '\s+', ' ', 'g')), '');
$$;

-- benar/salah satu jawaban (dipakai penilaian dan halaman detail)
create or replace function public._is_correct(p_type text, a public.answers, k public.answer_keys) returns boolean
language sql stable as $$
  select case
    when a.manual_correct is not null then a.manual_correct
    when p_type = 'isian' then
      public.norm_answer(a.answer_text) is not null
      and exists (select 1 from unnest(coalesce(k.accepted, '{}')) x where public.norm_answer(x) = public.norm_answer(a.answer_text))
    else a.option_id is not null and a.option_id = k.option_id
  end;
$$;

create or replace function public.grade_attempt(p_attempt_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_correct int; v_sections jsonb;
begin
  with g as (
    select q.section, coalesce(public._is_correct(q.type, a, k), false) as ok,
           min(q.position) over (partition by q.section) as sec_order
      from public.attempt_questions aq
      join public.questions q on q.id = aq.question_id
      left join public.answers a on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
      left join public.answer_keys k on k.question_id = aq.question_id
     where aq.attempt_id = p_attempt_id
  ), s as (
    select section, min(sec_order) as o, count(*) as total, count(*) filter (where ok) as benar
      from g group by section
  )
  select (select count(*) from g), (select count(*) filter (where ok) from g),
         coalesce((select jsonb_agg(jsonb_build_object('section', section, 'total', total, 'correct', benar,
                     'score', round(benar * 100.0 / greatest(total, 1), 2)) order by o) from s), '[]'::jsonb)
    into v_total, v_correct, v_sections;

  update public.attempts
     set correct_count = v_correct,
         score = round(v_correct * 100.0 / greatest(v_total, 1), 2),
         section_scores = v_sections,
         status = case when submitted_at is not null then 'submitted' else 'expired' end
   where id = p_attempt_id;
end $$;

-- ------------------------------ peserta ------------------------------
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
     not exists (select 1 from public.answer_keys k where k.question_id = q.id
                  and ((q.type = 'pg' and k.option_id is not null)
                    or (q.type = 'isian' and coalesce(cardinality(k.accepted), 0) > 0)))
     or (q.type = 'pg' and (select count(*) from public.options o where o.question_id = q.id) < 2));
  if v_total = 0 or v_bad > 0 then raise exception 'no_active_questions'; end if;

  insert into public.attempts (exam_id, user_id, started_at, ends_at, status)
  values (p_exam_id, v_uid, now(), now() + make_interval(mins => v_exam.duration_minutes), 'in_progress')
  on conflict (user_id, exam_id) do nothing
  returning * into v_att;

  if v_att.id is null then
    select * into v_att from public.attempts where user_id = v_uid and exam_id = p_exam_id;
    return v_att;
  end if;

  -- section tetap berurutan (urutan kemunculan di bank soal), soal diacak di dalam section
  insert into public.attempt_questions (attempt_id, question_id, position, option_order)
  select v_att.id, x.id, row_number() over (order by x.sec_order, random()),
         coalesce((select array_agg(o.id order by random()) from public.options o where o.question_id = x.id), '{}')
    from (select q.id, min(q.position) over (partition by q.section) as sec_order
            from public.questions q where q.is_active) x;

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
        'id', q.id, 'position', aq.position, 'section', q.section, 'type', q.type,
        'stimulus', q.stimulus, 'body', q.body, 'image_path', q.image_path,
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'body', o.body, 'image_path', o.image_path)
                                    order by array_position(aq.option_order, o.id)), '[]'::jsonb)
          from public.options o where o.question_id = q.id)
      ) order by aq.position)
      from public.attempt_questions aq join public.questions q on q.id = aq.question_id
      where aq.attempt_id = v_att.id), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'option_id', a.option_id,
                                          'answer_text', a.answer_text, 'flagged', a.flagged))
      from public.answers a where a.attempt_id = v_att.id), '[]'::jsonb),
    'snapshot_slots', coalesce((
      select jsonb_agg(s.slot) from public.snapshots s where s.attempt_id = v_att.id), '[]'::jsonb)
  );
end $$;

drop function public.save_answer(uuid, uuid, uuid, boolean, bigint, uuid);
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
  values (p_attempt_id, p_question_id, p_option_id, nullif(left(p_answer_text, 500), ''),
          coalesce(p_flagged, false), p_client_seq, now())
  on conflict (attempt_id, question_id) do update
     set option_id = excluded.option_id, answer_text = excluded.answer_text, flagged = excluded.flagged,
         client_seq = excluded.client_seq, updated_at = now()
   where public.answers.client_seq < excluded.client_seq;
end $$;

-- ------------------------------ admin: bank soal ------------------------------
-- payload: [{section, type:'pg'|'isian', stimulus, body, image_path, is_active, answer:'B', accepted:['..'], options:[...]}]
create or replace function public._save_key(p_qid uuid, q jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_acc text[];
begin
  if coalesce(q->>'type', 'pg') = 'isian' then
    select array_agg(btrim(x)) into v_acc
      from jsonb_array_elements_text(coalesce(q->'accepted', '[]'::jsonb)) x where btrim(x) <> '';
    if coalesce(cardinality(v_acc), 0) = 0 then raise exception 'soal isian belum punya kunci'; end if;
    delete from public.options where question_id = p_qid;
    insert into public.answer_keys (question_id, option_id, accepted) values (p_qid, null, v_acc)
    on conflict (question_id) do update set option_id = null, accepted = excluded.accepted;
  end if;
end $$;

create or replace function public.admin_save_questions(p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare q jsonb; o jsonb; v_qid uuid; v_oid uuid; v_pos int; v_cnt int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select coalesce(max(position), 0) into v_pos from public.questions;
  for q in select * from jsonb_array_elements(p_payload) loop
    v_pos := v_pos + 1;
    insert into public.questions (position, section, type, stimulus, body, image_path, is_active)
    values (v_pos, coalesce(nullif(btrim(q->>'section'), ''), 'Umum'), coalesce(q->>'type', 'pg'),
            nullif(q->>'stimulus', ''), q->>'body', nullif(q->>'image_path', ''),
            coalesce((q->>'is_active')::boolean, true))
    returning id into v_qid;
    if coalesce(q->>'type', 'pg') = 'isian' then
      perform public._save_key(v_qid, q);
    else
      for o in select * from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) loop
        insert into public.options (question_id, label, body, image_path)
        values (v_qid, o->>'label', coalesce(o->>'body', ''), nullif(o->>'image_path', ''))
        returning id into v_oid;
        if o->>'label' = q->>'answer' then
          insert into public.answer_keys (question_id, option_id) values (v_qid, v_oid);
        end if;
      end loop;
      if not exists (select 1 from public.answer_keys where question_id = v_qid) then
        raise exception 'soal_ke_% tidak punya kunci yang cocok', v_cnt + 1;
      end if;
    end if;
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end $$;

create or replace function public.admin_update_question(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb; v_oid uuid; v_labels text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.questions
     set stimulus = nullif(p->>'stimulus', ''), body = p->>'body',
         section = coalesce(nullif(btrim(p->>'section'), ''), section),
         type = coalesce(p->>'type', type),
         image_path = nullif(p->>'image_path', ''), is_active = coalesce((p->>'is_active')::boolean, is_active)
   where id = p_id;
  if not found then raise exception 'not_found'; end if;

  if coalesce(p->>'type', 'pg') = 'isian' then
    perform public._save_key(p_id, p);
    return;
  end if;

  for o in select * from jsonb_array_elements(coalesce(p->'options', '[]'::jsonb)) loop
    v_labels := v_labels || (o->>'label');
    insert into public.options (question_id, label, body, image_path)
    values (p_id, o->>'label', coalesce(o->>'body', ''), nullif(o->>'image_path', ''))
    on conflict (question_id, label) do update set body = excluded.body, image_path = excluded.image_path
    returning id into v_oid;
    if o->>'label' = p->>'answer' then
      insert into public.answer_keys (question_id, option_id, accepted) values (p_id, v_oid, null)
      on conflict (question_id) do update set option_id = excluded.option_id, accepted = null;
    end if;
  end loop;
  delete from public.options where question_id = p_id and label <> all (v_labels::char(1)[]);
  if not exists (select 1 from public.answer_keys where question_id = p_id and option_id is not null) then
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
                  'status', a.status, 'score', a.score, 'correct_count', a.correct_count, 'section_scores', a.section_scores,
                  'started_at', a.started_at, 'ends_at', a.ends_at, 'submitted_at', a.submitted_at)
                from public.attempts a join public.profiles p on p.id = a.user_id where a.id = p_attempt_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'position', aq.position, 'section', q.section, 'type', q.type, 'question', q.body,
        'chosen', case when q.type = 'isian' then a.answer_text
                       else (select o.body from public.options o where o.id = a.option_id) end,
        'correct', case when q.type = 'isian' then array_to_string(k.accepted, ' | ')
                        else (select o.body from public.options o where o.id = k.option_id) end,
        'is_correct', coalesce(public._is_correct(q.type, a, k), false),
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

-- koreksi manual satu jawaban (null = kembali ke penilaian otomatis), lalu nilai dihitung ulang
create or replace function public.admin_set_manual_correct(p_attempt_id uuid, p_question_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select status into v_status from public.attempts where id = p_attempt_id;
  if v_status is null then raise exception 'not_found'; end if;
  if v_status = 'in_progress' then raise exception 'masih_dikerjakan'; end if;
  if not exists (select 1 from public.attempt_questions where attempt_id = p_attempt_id and question_id = p_question_id) then
    raise exception 'not_found';
  end if;
  insert into public.answers (attempt_id, question_id, manual_correct)
  values (p_attempt_id, p_question_id, p_value)
  on conflict (attempt_id, question_id) do update set manual_correct = excluded.manual_correct;
  perform public.grade_attempt(p_attempt_id);
end $$;

-- nilai yang sudah ada dihitung ulang supaya section_scores terisi
do $$ declare r record; begin
  for r in select id from public.attempts where status in ('submitted', 'expired') loop
    perform public.grade_attempt(r.id);
  end loop;
end $$;

create or replace view public.live_status with (security_invoker = true) as
select p.id as user_id, p.full_name, p.participant_no, p.camera_excluded,
       a.id as attempt_id, coalesce(a.status, 'belum_mulai') as status,
       a.started_at, a.ends_at, a.submitted_at,
       case when a.status = 'in_progress' then greatest(0, extract(epoch from (a.ends_at - now()))::int) end as sisa_detik,
       (select count(*) from public.answers x where x.attempt_id = a.id
          and (x.option_id is not null or coalesce(x.answer_text, '') <> ''))::int as terjawab,
       (select count(*) from public.events e where e.attempt_id = a.id)::int as kejadian,
       (select count(*) from public.snapshots s where s.attempt_id = a.id)::int as foto
  from public.profiles p
  left join public.attempts a
         on a.user_id = p.id and a.exam_id = (select id from public.exams order by created_at desc limit 1)
 where p.role = 'peserta' and public.is_admin();

drop view public.results;
create view public.results with (security_invoker = true) as
select a.id as attempt_id, p.full_name, p.participant_no, a.score, a.correct_count, a.status,
       a.section_scores,
       (select count(*) from public.answers x where x.attempt_id = a.id
          and (x.option_id is not null or coalesce(x.answer_text, '') <> ''))::int as terjawab,
       (select count(*) from public.attempt_questions aq where aq.attempt_id = a.id)::int as total_soal,
       pm.passed,
       (select count(*) from public.events e where e.attempt_id = a.id)::int as kejadian,
       rank() over (order by a.score desc nulls last) as rank
  from public.attempts a
  join public.profiles p on p.id = a.user_id
  left join public.pass_marks pm on pm.attempt_id = a.id
 where a.status in ('submitted', 'expired') and public.is_admin();

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.grade_attempt(uuid) from authenticated;
revoke execute on function public._save_key(uuid, jsonb) from authenticated;
revoke execute on function public._is_correct(text, public.answers, public.answer_keys) from authenticated;
grant execute on function
  public.save_answer(uuid, uuid, uuid, boolean, bigint, uuid, text),
  public.admin_set_manual_correct(uuid, uuid, boolean),
  public.norm_answer(text)
to authenticated;
grant select on public.live_status, public.results to authenticated;
