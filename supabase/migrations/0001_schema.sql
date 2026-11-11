-- 0001_schema.sql : tabel dan constraint
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'peserta' check (role in ('admin', 'peserta')),
  full_name text not null,
  participant_no text unique,
  camera_excluded boolean not null default false,
  session_token uuid,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  stimulus text,
  body text not null,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label char(1) not null check (label in ('A', 'B', 'C', 'D', 'E')),
  body text not null default '',
  image_path text,
  unique (question_id, label)
);

create table public.answer_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  option_id uuid not null references public.options(id) on delete cascade
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  duration_minutes int not null check (duration_minutes between 1 and 600),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired')),
  score numeric(5, 2),
  correct_count int,
  extra_minutes int not null default 0,
  unique (user_id, exam_id)
);

create table public.attempt_questions (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  position int not null,
  option_order uuid[] not null,
  primary key (attempt_id, question_id)
);

create table public.answers (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  option_id uuid references public.options(id),
  flagged boolean not null default false,
  client_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  type text not null,
  created_at timestamptz not null default now()
);
create index events_attempt_idx on public.events (attempt_id);

create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  slot int not null,
  path text not null,
  taken_at timestamptz not null default now(),
  unique (attempt_id, slot)
);

create table public.pass_marks (
  attempt_id uuid primary key references public.attempts(id) on delete cascade,
  passed boolean not null
);

-- helper: apakah pemanggil admin
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
