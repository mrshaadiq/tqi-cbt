-- 0002_rls.sql : Row Level Security. Peserta TIDAK punya policy tulis sama sekali.
alter table public.profiles          enable row level security;
alter table public.questions         enable row level security;
alter table public.options           enable row level security;
alter table public.answer_keys       enable row level security;
alter table public.exams             enable row level security;
alter table public.attempts          enable row level security;
alter table public.attempt_questions enable row level security;
alter table public.answers           enable row level security;
alter table public.events            enable row level security;
alter table public.snapshots         enable row level security;
alter table public.pass_marks        enable row level security;

-- admin: akses penuh ke semua tabel
do $$
declare t text;
begin
  foreach t in array array['profiles','questions','options','answer_keys','exams','attempts',
                           'attempt_questions','answers','events','snapshots','pass_marks']
  loop
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- peserta: hanya baca miliknya sendiri
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
create policy read_exams on public.exams for select to authenticated using (true);
create policy own_attempts on public.attempts for select to authenticated using (user_id = auth.uid());
create policy own_attempt_questions on public.attempt_questions for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy own_answers on public.answers for select to authenticated
  using (exists (select 1 from public.attempts a where a.id = attempt_id and a.user_id = auth.uid()));
-- questions, options, answer_keys, events, snapshots, pass_marks: peserta tidak punya policy (tertutup).
-- Soal hanya terbaca lewat get_attempt_state().

-- anon tidak boleh menyentuh apa pun
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
