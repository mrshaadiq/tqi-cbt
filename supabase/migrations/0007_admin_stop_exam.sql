-- 0007_admin_stop_exam.sql : hentikan ujian untuk semua peserta
-- Semua attempt yang masih in_progress dikumpulkan (submitted) dan dinilai dari jawaban yang sudah tersimpan.
-- Jendela Start ditutup sekarang supaya tidak ada peserta baru yang bisa mulai.
create or replace function public.admin_stop_exam(p_exam_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  update public.exams
     set closes_at = now()
   where id = p_exam_id and closes_at > now() and opens_at < now();

  for r in select id from public.attempts
            where exam_id = p_exam_id and status = 'in_progress' loop
    update public.attempts set submitted_at = now() where id = r.id;
    perform public.grade_attempt(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.admin_stop_exam(uuid) from public, anon;
grant execute on function public.admin_stop_exam(uuid) to authenticated;
