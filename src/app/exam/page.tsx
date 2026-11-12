'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { claimSession, currentProfile, getToken, logout, type Profile } from '@/lib/auth';
import { fetchState, latestExam, myAttempt, serverNow, startAttempt, type AttemptState, type Exam } from '@/lib/examApi';
import { ServerClock } from '@/lib/serverClock';
import { Spinner } from '@/components/ui';
import ExamRunner from '@/components/exam/ExamRunner';
import { Consent, Finished, Message, Waiting } from '@/components/exam/Screens';

type Phase =
  | { k: 'loading' }
  | { k: 'error'; msg: string }
  | { k: 'noexam' }
  | { k: 'closed' }
  | { k: 'waiting'; exam: Exam }
  | { k: 'consent'; exam: Exam }
  | { k: 'running'; state: AttemptState }
  | { k: 'finished' };

const START_ERRORS: Record<string, string> = {
  window_closed: 'Waktu untuk memulai ujian sudah ditutup. Hubungi panitia.',
  no_active_questions: 'Soal belum siap. Hubungi panitia.',
  exam_not_found: 'Ujian tidak ditemukan. Hubungi panitia.',
};

export default function ExamPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [startErr, setStartErr] = useState('');
  const [starting, setStarting] = useState(false);
  const clock = useRef(new ServerClock());
  const token = useRef<string>('');
  const stream = useRef<MediaStream | null>(null);

  const goLogin = useCallback(async () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    await logout();
    router.replace('/');
  }, [router]);

  useEffect(() => {
    (async () => {
      try {
        const p = await currentProfile();
        if (!p) return router.replace('/');
        if (p.role === 'admin') return router.replace('/admin/pantau/');
        setProfile(p);
        token.current = getToken() ?? (await claimSession());
        clock.current.sync(await serverNow());

        const exam = await latestExam();
        if (!exam) return setPhase({ k: 'noexam' });

        const attempt = await myAttempt(exam.id);
        if (attempt) {
          const state = await fetchState(attempt.id, token.current);
          clock.current.sync(state.server_now);
          return setPhase(state.status === 'in_progress' ? { k: 'running', state } : { k: 'finished' });
        }
        const now = clock.current.now();
        if (now < Date.parse(exam.opens_at)) setPhase({ k: 'waiting', exam });
        else if (now > Date.parse(exam.closes_at)) setPhase({ k: 'closed' });
        else setPhase({ k: 'consent', exam });
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('session_replaced')) return void goLogin();
        setPhase({ k: 'error', msg: 'Tidak dapat memuat ujian. Periksa koneksi lalu muat ulang halaman.' });
      }
    })();
  }, [router, goLogin]);

  async function onStart(exam: Exam) {
    setStarting(true);
    setStartErr('');
    try {
      const attempt = await startAttempt(exam.id, token.current);
      const state = await fetchState(attempt.id, token.current);
      clock.current.sync(state.server_now);
      setPhase(state.status === 'in_progress' ? { k: 'running', state } : { k: 'finished' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('session_replaced')) return void goLogin();
      const known = Object.keys(START_ERRORS).find((c) => msg.includes(c));
      setStartErr(known ? START_ERRORS[known] : 'Gagal memulai. Periksa koneksi lalu coba lagi.');
      setStarting(false);
    }
  }

  const onOpen = useCallback(() => setPhase((p) => (p.k === 'waiting' ? { k: 'consent', exam: p.exam } : p)), []);

  if (!profile || phase.k === 'loading') return <Spinner />;
  switch (phase.k) {
    case 'error': return <Message title="Terjadi masalah" text={phase.msg} />;
    case 'noexam': return <Message title="Belum ada ujian" text="Panitia belum menyiapkan ujian. Silakan kembali nanti." />;
    case 'closed': return <Message title="Waktu mulai ditutup" text="Jendela waktu untuk memulai ujian sudah lewat. Hubungi panitia." />;
    case 'waiting': return <Waiting exam={phase.exam} clock={clock.current} profile={profile} onOpen={onOpen} onLogout={goLogin} />;
    case 'consent': return <Consent exam={phase.exam} profile={profile} streamRef={stream} onStart={() => onStart(phase.exam)} error={startErr} busy={starting} />;
    case 'running':
      return <ExamRunner state={phase.state} token={token.current} profile={profile} clock={clock.current} streamRef={stream}
        onFinished={() => setPhase({ k: 'finished' })} onSessionLost={goLogin} />;
    case 'finished': return <Finished onLogout={goLogin} />;
  }
}
