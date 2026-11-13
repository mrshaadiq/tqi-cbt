import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations') + path.sep;
const db = new PGlite();

// --- stub Supabase ---
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
grant usage on schema auth, storage, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated, public;
`);

for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(dir + f, 'utf8')); console.log('OK  ', f); }
  catch (e) { console.log('FAIL', f, e.message); process.exit(1); }
}
await db.exec(`grant all on all tables in schema public to authenticated; grant all on all tables in schema storage to authenticated;`);
await db.exec(`revoke all on all tables in schema public from anon;`);

const A = '00000000-0000-0000-0000-000000000010';
const P1 = '00000000-0000-0000-0000-000000000011';
const P2 = '00000000-0000-0000-0000-000000000012';
await db.exec(`
insert into auth.users values ('${A}','a@x'), ('${P1}','p1@psb.local'), ('${P2}','p2@psb.local');
insert into profiles (id, role, full_name, participant_no) values
 ('${A}','admin','Admin','admin'), ('${P1}','peserta','Peserta Satu','p1'), ('${P2}','peserta','Peserta Dua','p2');
`);

let pass = 0, fail = 0;
const as = async (uid, role = 'authenticated') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra ?? ''); } };
const throwsMsg = async (name, sql, needle) => {
  try { await db.query(sql); fail++; console.log('  FAIL', name, '(tidak error)'); }
  catch (e) { const ok = e.message.includes(needle); ok ? pass++ : fail++; console.log(ok ? '  ok  ' : '  FAIL', name, ok ? '' : e.message); }
};

// --- admin menyiapkan ujian dan 4 soal (satu hanya 3 opsi) ---
await as(A);
await db.query(`insert into exams (title, duration_minutes, opens_at, closes_at) values ('Tes', 90, now() - interval '1 hour', now() + interval '1 hour')`);
const payload = [1, 2, 3, 4].map((n) => ({
  stimulus: n === 2 ? 'Teks pengantar' : '', body: 'Soal ' + n, answer: n === 4 ? 'B' : 'A',
  options: ['A', 'B', 'C', 'D'].slice(0, n === 4 ? 3 : 4).map((l) => ({ label: l, body: 'Opsi ' + l + n })),
}));
const saved = (await q(`select admin_save_questions($1::jsonb) n`, [JSON.stringify(payload)]))[0].n;
check('admin_save_questions menyimpan 4 soal', saved === 4);
await throwsMsg('payload tanpa kunci cocok ditolak (atomik)',
  `select admin_save_questions('[{"body":"x","answer":"Z","options":[{"label":"A","body":"a"},{"label":"B","body":"b"}]}]'::jsonb)`, 'tidak punya kunci');
check('soal gagal tidak tersimpan', (await q(`select count(*)::int n from questions`))[0].n === 4);
const examId = (await q(`select id from exams limit 1`))[0].id;

// --- RLS peserta ---
await as(P1);
check('peserta tidak bisa baca answer_keys', (await q(`select * from answer_keys`)).length === 0);
check('peserta tidak bisa baca questions langsung', (await q(`select * from questions`)).length === 0);
check('peserta hanya melihat profil sendiri', (await q(`select * from profiles`)).length === 1);
await throwsMsg('peserta tidak bisa insert answers langsung', `insert into answers (attempt_id, question_id) values (gen_random_uuid(), gen_random_uuid())`, 'row-level security');
await throwsMsg('peserta tidak bisa memanggil admin_clear_bank', `select admin_clear_bank()`, 'forbidden');
await throwsMsg('peserta tidak bisa memanggil grade_attempt', `select grade_attempt(gen_random_uuid())`, 'permission denied');

// --- alur peserta 1 ---
const t1 = (await q(`select claim_session() t`))[0].t;
await throwsMsg('start dengan token salah ditolak', `select start_attempt('${examId}', gen_random_uuid())`, 'session_replaced');
const a1 = (await q(`select * from start_attempt($1, $2)`, [examId, t1]))[0];
const a1b = (await q(`select * from start_attempt($1, $2)`, [examId, t1]))[0];
check('start dua kali -> satu attempt', a1.id === a1b.id && (await q(`select count(*)::int n from attempts`))[0].n === 1);
check('4 attempt_questions', (await q(`select count(*)::int n from attempt_questions`))[0].n === 4);
const dur = (await q(`select extract(epoch from (ends_at - started_at))/60 m from attempts`))[0].m;
check('durasi 90 menit', Number(dur) === 90);

const st = (await q(`select get_attempt_state($1,$2) s`, [a1.id, t1]))[0].s;
check('state memuat 4 soal', st.questions.length === 4);
check('state tanpa kunci', !JSON.stringify(st).includes('answer_key') && !JSON.stringify(st).includes('"answer"'));
const st2 = (await q(`select get_attempt_state($1,$2) s`, [a1.id, t1]))[0].s;
check('urutan soal dan opsi stabil', JSON.stringify(st) === JSON.stringify({ ...st2, server_now: st.server_now }));

// jawab: ambil kunci lewat admin untuk menyusun jawaban benar
await as(A);
const keys = await q(`select q.body, k.option_id from questions q join answer_keys k on k.question_id = q.id`);
const keyOf = Object.fromEntries(keys.map((k) => [k.body, k.option_id]));
await as(P1);
const byBody = Object.fromEntries(st.questions.map((x) => [x.body, x]));
const wrongOpt = (qq) => qq.options.find((o) => o.id !== keyOf[qq.body]).id;

await db.query(`select save_answer($1,$2,$3,false,10,$4)`, [a1.id, byBody['Soal 1'].id, keyOf['Soal 1'], t1]);
await db.query(`select save_answer($1,$2,$3,true,5,$4)`, [a1.id, byBody['Soal 1'].id, wrongOpt(byBody['Soal 1']), t1]);
let ans = (await q(`select * from answers where question_id = $1`, [byBody['Soal 1'].id]))[0];
check('jawaban lama (seq lebih kecil) tidak menimpa', ans.option_id === keyOf['Soal 1'] && ans.flagged === false);
await db.query(`select save_answer($1,$2,$3,false,11,$4)`, [a1.id, byBody['Soal 2'].id, keyOf['Soal 2'], t1]);
await db.query(`select save_answer($1,$2,$3,false,12,$4)`, [a1.id, byBody['Soal 3'].id, wrongOpt(byBody['Soal 3']), t1]);
// soal 4 dikosongkan
await throwsMsg('opsi dari soal lain ditolak', `select save_answer('${a1.id}','${byBody['Soal 1'].id}','${keyOf['Soal 2']}',false,20,'${t1}')`, 'invalid_option');

// login kedua menimpa token
const t2 = (await q(`select claim_session() t`))[0].t;
await throwsMsg('token lama ditolak setelah login baru', `select save_answer('${a1.id}','${byBody['Soal 1'].id}',null,false,30,'${t1}')`, 'session_replaced');

// waktu: +4 detik diterima, +6 detik ditolak
await db.exec(`reset role; update attempts set ends_at = now() - interval '4 seconds'`);
await as(P1);
await db.query(`select save_answer($1,$2,$3,false,40,$4)`, [a1.id, byBody['Soal 4'].id, keyOf['Soal 4'], t2]);
check('jawaban pada ends_at + 4 detik diterima', true);
await db.exec(`reset role; update attempts set ends_at = now() - interval '6 seconds'`);
await as(P1);
await throwsMsg('jawaban pada ends_at + 6 detik ditolak', `select save_answer('${a1.id}','${byBody['Soal 4'].id}',null,false,50,'${t2}')`, 'time_over');

// get_attempt_state menilai otomatis attempt yang waktunya habis
const st3 = (await q(`select get_attempt_state($1,$2) s`, [a1.id, t2]))[0].s;
check('state setelah waktu habis: status expired', st3.status === 'expired');
await db.exec(`reset role;`);
const g = (await q(`select score, correct_count, status from attempts`))[0];
check('nilai: 3 benar dari 4 = 75', Number(g.score) === 75 && g.correct_count === 3, JSON.stringify(g));
await as(P1);
await db.query(`select submit_attempt($1,$2)`, [a1.id, t2]);
check('submit setelah expired aman diulang', true);

// peserta 2: jendela ujian tutup
await as(P2);
const tp2 = (await q(`select claim_session() t`))[0].t;
await as(A);
await db.exec(`update exams set closes_at = now() - interval '1 minute', opens_at = now() - interval '2 hour'`);
await as(P2);
await throwsMsg('start di luar jendela ditolak', `select start_attempt('${examId}','${tp2}')`, 'window_closed');
await as(P1);
const again = (await q(`select * from start_attempt($1,$2)`, [examId, t2]))[0];
check('yang sudah punya attempt tetap bisa memanggil start setelah jendela tutup', again.id === a1.id);

// bank bermasalah
await as(A);
await db.exec(`update exams set closes_at = now() + interval '1 hour'`);
await db.exec(`reset role; insert into questions (body) values ('Soal tanpa kunci')`);
await as(P2);
await throwsMsg('soal aktif tanpa kunci -> no_active_questions', `select start_attempt('${examId}','${tp2}')`, 'no_active_questions');
await db.exec(`reset role; delete from questions where body = 'Soal tanpa kunci'`);

// admin
await as(A);
check('live_status menampilkan 2 peserta', (await q(`select * from live_status`)).length === 2);
const r = await q(`select * from results`);
check('results: 1 baris, rank 1', r.length === 1 && Number(r[0].rank) === 1);
await db.query(`select admin_reopen_attempt($1, 30)`, [a1.id]);
const re = (await q(`select status, score from attempts`))[0];
check('reopen: kembali in_progress, nilai kosong', re.status === 'in_progress' && re.score === null);
await as(P1);
await db.query(`select save_answer($1,$2,$3,false,60,$4)`, [a1.id, byBody['Soal 4'].id, keyOf['Soal 4'], t2]);
check('setelah reopen jawaban diterima lagi', true);
await as(A);
await db.query(`select admin_extend_attempt($1, 10)`, [a1.id]);
const d = (await q(`select admin_attempt_detail($1) d`, [a1.id]))[0].d;
check('detail jawaban memuat 4 baris', d.rows.length === 4);
check('finalize_expired aman: 0 yang perlu dinilai', (await q(`select finalize_expired($1) n`, [examId]))[0].n === 0);
check('peserta melihat results kosong', (await (async () => { await as(P1); return q(`select * from results`); })()).length === 0);
await as(A);
check('stop ujian: 1 peserta in_progress dikumpulkan', (await q(`select admin_stop_exam($1) n`, [examId]))[0].n === 1);
const stopped = (await q(`select status, score from attempts`))[0];
check('stop ujian: status submitted dan sudah bernilai', stopped.status === 'submitted' && stopped.score !== null, JSON.stringify(stopped));
check('stop ujian: jendela Start ditutup', (await q(`select closes_at <= now() c from exams`))[0].c === true);
check('stop ujian aman diulang: 0', (await q(`select admin_stop_exam($1) n`, [examId]))[0].n === 0);
await as(P1);
await throwsMsg('peserta tidak boleh menghentikan ujian', `select admin_stop_exam('${examId}')`, 'forbidden');
await as(A);
await db.query(`select admin_reset_tryout()`);
check('reset tryout menghapus attempt dan turunannya', (await q(`select (select count(*) from attempts)::int + (select count(*) from answers)::int + (select count(*) from attempt_questions)::int n`))[0].n === 0);
const upd = { stimulus: 'baru', body: 'Soal 1 diubah', answer: 'C', is_active: true, options: [{ label: 'A', body: 'x' }, { label: 'B', body: 'y' }, { label: 'C', body: 'z' }] };
const qid = (await q(`select id from questions where body='Soal 1'`))[0].id;
await db.query(`select admin_update_question($1, $2::jsonb)`, [qid, JSON.stringify(upd)]);
const after = (await q(`select (select count(*) from options where question_id=$1)::int n, (select o.label from answer_keys k join options o on o.id=k.option_id where k.question_id=$1) k`, [qid]))[0];
check('update soal: 3 opsi, kunci C', after.n === 3 && after.k === 'C', JSON.stringify(after));

// --- section + soal isian ---
await db.query(`select admin_clear_bank()`);
await db.query(`update exams set opens_at = now() - interval '1 hour', closes_at = now() + interval '1 hour'`);
const secPayload = [
  { section: 'Matematika', type: 'isian', body: '2 + 2 = ...', accepted: ['4', 'empat'] },
  { section: 'Bahasa', type: 'pg', body: 'PG bahasa', answer: 'A', options: [{ label: 'A', body: 'benar' }, { label: 'B', body: 'salah' }] },
  { section: 'Matematika', type: 'pg', body: 'PG mtk', answer: 'B', options: [{ label: 'A', body: 'x' }, { label: 'B', body: 'y' }] },
  { section: 'Bahasa', type: 'isian', body: 'Ibu kota?', accepted: ['Jakarta'] },
];
check('simpan 4 soal campuran', (await q(`select admin_save_questions($1::jsonb) n`, [JSON.stringify(secPayload)]))[0].n === 4);
await throwsMsg('isian tanpa kunci ditolak', `select admin_save_questions('[{"type":"isian","body":"x","accepted":[]}]'::jsonb)`, 'belum punya kunci');
await as(P1);
const ts = (await q(`select claim_session() t`))[0].t;
const as1 = (await q(`select * from start_attempt($1, $2)`, [examId, ts]))[0];
const sst = (await q(`select get_attempt_state($1,$2) s`, [as1.id, ts]))[0].s;
const secs = sst.questions.map((x) => x.section);
check('section berurutan: Matematika dulu lalu Bahasa', secs.join(',') === 'Matematika,Matematika,Bahasa,Bahasa', secs.join(','));
const qb = Object.fromEntries(sst.questions.map((x) => [x.body, x]));
check('soal isian tanpa opsi, bertipe isian', qb['2 + 2 = ...'].type === 'isian' && qb['2 + 2 = ...'].options.length === 0);
await db.query(`select save_answer($1,$2,null,false,1,$3,$4)`, [as1.id, qb['2 + 2 = ...'].id, ts, '  Empat. ']);
await db.query(`select save_answer($1,$2,null,false,2,$3,$4)`, [as1.id, qb['Ibu kota?'].id, ts, 'Bandung']);
await db.query(`select save_answer($1,$2,$3,false,3,$4)`, [as1.id, qb['PG bahasa'].id, qb['PG bahasa'].options.find((o) => o.body === 'benar').id, ts]);
const sst2 = (await q(`select get_attempt_state($1,$2) s`, [as1.id, ts]))[0].s;
check('jawaban isian tersimpan', sst2.answers.some((a) => a.answer_text === '  Empat. '));
await db.query(`select submit_attempt($1,$2)`, [as1.id, ts]);
await as(A);
const g1 = (await q(`select score, correct_count, section_scores from attempts where id=$1`, [as1.id]))[0];
check('isian dinormalisasi: 2 benar dari 4 = 50', Number(g1.score) === 50 && g1.correct_count === 2, JSON.stringify(g1));
const ss = g1.section_scores;
check('nilai per section', ss.length === 2 && ss[0].section === 'Matematika' && ss[0].correct === 1 && ss[1].correct === 1, JSON.stringify(ss));
await db.query(`select admin_set_manual_correct($1,$2,true)`, [as1.id, qb['Ibu kota?'].id]);
check('koreksi manual menaikkan nilai ke 75', Number((await q(`select score from attempts where id=$1`, [as1.id]))[0].score) === 75);
const det = (await q(`select admin_attempt_detail($1) d`, [as1.id]))[0].d;
const rIsian = det.rows.find((r) => r.question === 'Ibu kota?');
check('detail isian: jawaban, kunci, manual', rIsian.chosen === 'Bandung' && rIsian.correct === 'Jakarta' && rIsian.manual_correct === true && rIsian.is_correct === true);
await db.query(`select admin_set_manual_correct($1,$2,null)`, [as1.id, qb['Ibu kota?'].id]);
check('batal koreksi manual: kembali 50', Number((await q(`select score from attempts where id=$1`, [as1.id]))[0].score) === 50);
const res = (await q(`select terjawab, total_soal, section_scores from results where attempt_id=$1`, [as1.id]))[0];
check('results memuat terjawab dan section', res.terjawab === 3 && res.total_soal === 4 && res.section_scores.length === 2, JSON.stringify(res));
await as(P1);
await throwsMsg('peserta tidak boleh koreksi manual', `select admin_set_manual_correct('${as1.id}','${qb['Ibu kota?'].id}',true)`, 'forbidden');

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
