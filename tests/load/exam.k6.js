// Uji beban: ~100 peserta virtual. JALANKAN HANYA terhadap proyek Supabase staging, bukan produksi.
//
// Persiapan: buat users.json berisi [{"no":"tqi-001","password":"xxxx"}, ...] (sama dengan akun uji di staging).
//   k6 run -e SUPABASE_URL=https://xxx.supabase.co -e ANON_KEY=eyJ... -e START_AT_EPOCH=<detik epoch> tests/load/exam.k6.js
// Uji cepat (jeda jawaban 2-5 detik): tambahkan -e THINK_MIN=2 -e THINK_MAX=5 -e LOGIN_SPREAD_S=30
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';

const BASE = __ENV.SUPABASE_URL;
const KEY = __ENV.ANON_KEY;
const THINK_MIN = Number(__ENV.THINK_MIN || 20);
const THINK_MAX = Number(__ENV.THINK_MAX || 60);
const LOGIN_SPREAD_S = Number(__ENV.LOGIN_SPREAD_S || 300);

const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS_FILE || './users.json')));
const tStart = new Trend('start_attempt_ms', true);
const tSave = new Trend('save_answer_ms', true);

export const options = {
  scenarios: { exam: { executor: 'per-vu-iterations', vus: 100, iterations: 1, maxDuration: '120m' } },
  thresholds: {
    start_attempt_ms: ['p(95)<1000'],
    save_answer_ms: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

const rpc = (name, body, jwt) =>
  http.post(`${BASE}/rest/v1/rpc/${name}`, JSON.stringify(body), {
    headers: { apikey: KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  });

export default function () {
  const u = users[(__VU - 1) % users.length];

  sleep(Math.random() * LOGIN_SPREAD_S); // login tersebar (batas Auth per IP)
  const login = http.post(
    `${BASE}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: `${u.no}@psb.local`, password: u.password }),
    { headers: { apikey: KEY, 'Content-Type': 'application/json' } },
  );
  if (!check(login, { 'login 200': (r) => r.status === 200 })) return;
  const jwt = login.json('access_token');

  const token = rpc('claim_session', {}, jwt).json();
  const exam = http.get(`${BASE}/rest/v1/exams?select=id&order=created_at.desc&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${jwt}` },
  }).json()[0];

  // semua peserta menekan Start pada detik yang sama
  const startAt = Number(__ENV.START_AT_EPOCH || 0);
  while (Date.now() / 1000 < startAt) sleep(0.5);

  const s = rpc('start_attempt', { p_exam_id: exam.id, p_token: token }, jwt);
  tStart.add(s.timings.duration);
  if (!check(s, { 'start 200': (r) => r.status === 200 })) return;
  const attempt = s.json();

  const state = rpc('get_attempt_state', { p_attempt_id: attempt.id, p_token: token }, jwt).json();
  state.questions.forEach((q, i) => {
    sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
    const opt = q.options[Math.floor(Math.random() * q.options.length)];
    const r = rpc('save_answer', {
      p_attempt_id: attempt.id, p_question_id: q.id, p_option_id: opt.id,
      p_flagged: false, p_client_seq: Date.now() + i, p_token: token,
    }, jwt);
    tSave.add(r.timings.duration);
    check(r, { 'save 2xx': (x) => x.status >= 200 && x.status < 300 });
  });

  check(rpc('submit_attempt', { p_attempt_id: attempt.id, p_token: token }, jwt), { 'submit 2xx': (x) => x.status < 300 });
}
