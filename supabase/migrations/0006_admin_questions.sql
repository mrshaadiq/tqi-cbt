-- 0006_admin_questions.sql : simpan, ubah, dan bersihkan bank soal (atomik per panggilan)

-- payload: [{stimulus, body, image_path, is_active, answer:'B', options:[{label:'A', body, image_path}]}]
create or replace function public.admin_save_questions(p_payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare q jsonb; o jsonb; v_qid uuid; v_oid uuid; v_pos int; v_cnt int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select coalesce(max(position), 0) into v_pos from public.questions;
  for q in select * from jsonb_array_elements(p_payload) loop
    v_pos := v_pos + 1;
    insert into public.questions (position, stimulus, body, image_path, is_active)
    values (v_pos, nullif(q->>'stimulus', ''), q->>'body', nullif(q->>'image_path', ''),
            coalesce((q->>'is_active')::boolean, true))
    returning id into v_qid;
    for o in select * from jsonb_array_elements(q->'options') loop
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
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end $$;

-- ubah satu soal (opsi diperbarui di tempat supaya id opsi tetap)
create or replace function public.admin_update_question(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb; v_oid uuid; v_labels text[] := '{}';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.questions
     set stimulus = nullif(p->>'stimulus', ''), body = p->>'body',
         image_path = nullif(p->>'image_path', ''), is_active = coalesce((p->>'is_active')::boolean, is_active)
   where id = p_id;
  if not found then raise exception 'not_found'; end if;
  for o in select * from jsonb_array_elements(p->'options') loop
    v_labels := v_labels || (o->>'label');
    insert into public.options (question_id, label, body, image_path)
    values (p_id, o->>'label', coalesce(o->>'body', ''), nullif(o->>'image_path', ''))
    on conflict (question_id, label) do update set body = excluded.body, image_path = excluded.image_path
    returning id into v_oid;
    if o->>'label' = p->>'answer' then
      insert into public.answer_keys (question_id, option_id) values (p_id, v_oid)
      on conflict (question_id) do update set option_id = excluded.option_id;
    end if;
  end loop;
  delete from public.options where question_id = p_id and label <> all (v_labels::char(1)[]);
  if not exists (select 1 from public.answer_keys where question_id = p_id) then
    raise exception 'kunci tidak cocok dengan opsi';
  end if;
end $$;

-- kosongkan bank: soal yang sudah dipakai attempt hanya dinonaktifkan, sisanya dihapus
create or replace function public.admin_clear_bank() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.questions set is_active = false
   where exists (select 1 from public.attempt_questions aq where aq.question_id = questions.id);
  delete from public.questions q
   where not exists (select 1 from public.attempt_questions aq where aq.question_id = q.id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.admin_save_questions(jsonb), public.admin_update_question(uuid, jsonb), public.admin_clear_bank()
to authenticated;
