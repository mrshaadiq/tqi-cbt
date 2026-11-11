-- 0004_admin_functions.sql : fungsi dan view khusus admin
create or replace function public.finalize_expired(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  for r in select id from public.attempts
            where exam_id = p_exam_id and status = 'in_progress' and now() > ends_at loop
    perform public.grade_attempt(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.admin_extend_attempt(p_attempt_id uuid, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.attempts
     set ends_at = ends_at + make_interval(mins => p_minutes), extra_minutes = extra_minutes + p_minutes
   where id = p_attempt_id and status = 'in_progress';
  if not found then raise exception 'not_in_progress'; end if;
end $$;

create or replace function public.admin_reopen_attempt(p_attempt_id uuid, p_minutes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.attempts
     set status = 'in_progress', submitted_at = null, score = null, correct_count = null,
         ends_at = now() + make_interval(mins => p_minutes)
   where id = p_attempt_id;
  if not found then raise exception 'not_found'; end if;
end $$;

-- ringkasan jawaban satu peserta untuk halaman detail
create or replace function public.admin_attempt_detail(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'attempt', (select jsonb_build_object('id', a.id, 'full_name', p.full_name, 'participant_no', p.participant_no,
                  'status', a.status, 'score', a.score, 'correct_count', a.correct_count,
                  'started_at', a.started_at, 'ends_at', a.ends_at, 'submitted_at', a.submitted_at)
                from public.attempts a join public.profiles p on p.id = a.user_id where a.id = p_attempt_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', aq.position, 'question', q.body,
        'chosen', (select o.body from public.options o where o.id = a.option_id),
        'correct', (select o.body from public.options o join public.answer_keys k on k.option_id = o.id where k.question_id = q.id),
        'is_correct', (a.option_id is not null and a.option_id = (select k.option_id from public.answer_keys k where k.question_id = q.id)),
        'flagged', coalesce(a.flagged, false)) order by aq.position)
      from public.attempt_questions aq
      join public.questions q on q.id = aq.question_id
      left join public.answers a on a.attempt_id = aq.attempt_id and a.question_id = aq.question_id
      where aq.attempt_id = p_attempt_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('type', e.type, 'created_at', e.created_at) order by e.created_at)
                        from public.events e where e.attempt_id = p_attempt_id), '[]'::jsonb)
  );
end $$;

-- dipakai setelah tes coba: hapus semua attempt (jawaban, foto, kejadian ikut terhapus)
create or replace function public.admin_reset_tryout() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select count(*) into n from public.attempts;
  delete from public.attempts;
  return n;
end $$;

-- pantauan: satu baris per peserta untuk ujian terbaru
create or replace view public.live_status with (security_invoker = true) as
select p.id as user_id, p.full_name, p.participant_no, p.camera_excluded,
       a.id as attempt_id, coalesce(a.status, 'belum_mulai') as status,
       a.started_at, a.ends_at, a.submitted_at,
       case when a.status = 'in_progress' then greatest(0, extract(epoch from (a.ends_at - now()))::int) end as sisa_detik,
       (select count(*) from public.answers x where x.attempt_id = a.id and x.option_id is not null)::int as terjawab,
       (select count(*) from public.events e where e.attempt_id = a.id)::int as kejadian,
       (select count(*) from public.snapshots s where s.attempt_id = a.id)::int as foto
  from public.profiles p
  left join public.attempts a
         on a.user_id = p.id and a.exam_id = (select id from public.exams order by created_at desc limit 1)
 where p.role = 'peserta' and public.is_admin();

create or replace view public.results with (security_invoker = true) as
select a.id as attempt_id, p.full_name, p.participant_no, a.score, a.correct_count, a.status,
       pm.passed,
       (select count(*) from public.events e where e.attempt_id = a.id)::int as kejadian,
       rank() over (order by a.score desc nulls last) as rank
  from public.attempts a
  join public.profiles p on p.id = a.user_id
  left join public.pass_marks pm on pm.attempt_id = a.id
 where a.status in ('submitted', 'expired') and public.is_admin();

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.finalize_expired(uuid), public.admin_extend_attempt(uuid, int), public.admin_reopen_attempt(uuid, int),
  public.admin_attempt_detail(uuid), public.admin_reset_tryout()
to authenticated;
grant select on public.live_status, public.results to authenticated;
