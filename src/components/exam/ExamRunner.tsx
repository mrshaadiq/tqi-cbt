'use client';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AnswerQueue } from '@/lib/answerQueue';
import { captureJpeg, requestCamera, streamIsLive } from '@/lib/camera';
import { fetchState, logEvent, sendAnswer, submit, uploadSnapshot, type AttemptState } from '@/lib/examApi';
import type { Profile } from '@/lib/auth';
import type { ServerClock } from '@/lib/serverClock';
import { SnapshotScheduler } from '@/lib/snapshotScheduler';
import { isMostlyArabic } from '@/lib/text';
import { questionImageUrl } from '@/lib/supabase';
import RtlText from '@/components/RtlText';
import { Button, Icon, Modal } from '@/components/ui';
import QuestionNav, { type AnswerMap } from './QuestionNav';

type Props = {
  state: AttemptState;
  token: string;
  profile: Profile;
  clock: ServerClock;
  streamRef: MutableRefObject<MediaStream | null>;
  onFinished: () => void;
  onSessionLost: () => void;
};

const LETTERS = 'ABCDE';

export default function ExamRunner({ state, token, profile, clock, streamRef, onFinished, onSessionLost }: Props) {
  const { questions } = state;
  const attemptId = state.attempt_id;

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>(() =>
    Object.fromEntries(state.answers.map((a) => [a.question_id, { optionId: a.option_id, flagged: a.flagged }])),
  );
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((Date.parse(state.ends_at) - clock.now()) / 1000)));
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [tabWarn, setTabWarn] = useState(false);
  const [camWarn, setCamWarn] = useState(false);

  const finishing = useRef(false);
  const queueRef = useRef<AnswerQueue | null>(null);
  const cb = useRef({ onFinished, onSessionLost });
  cb.current = { onFinished, onSessionLost };

  const finish = useCallback(async (auto: boolean) => {
    if (finishing.current) return;
    finishing.current = true;
    setSubmitting(true);
    setSubmitError('');
    const q = queueRef.current!;
    for (;;) {
      try {
        // kirim sisa jawaban dulu (maks ~10 detik), lalu submit
        for (let i = 0; i < 20 && q.pending() > 0; i++) {
          await q.flush();
          if (q.pending() > 0) await new Promise((r) => setTimeout(r, 500));
        }
        await submit(attemptId, token);
        queueRef.current?.stop();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        cb.current.onFinished();
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('session_replaced')) return cb.current.onSessionLost();
        if (!auto) {
          setSubmitError('Gagal mengirim. Periksa koneksi lalu tekan Selesai lagi.');
          setSubmitting(false);
          finishing.current = false;
          return;
        }
        await new Promise((r) => setTimeout(r, 3000)); // waktu habis: terus coba sampai berhasil
      }
    }
  }, [attemptId, token, streamRef]);

  if (!queueRef.current) {
    queueRef.current = new AnswerQueue(sendAnswer, (code) => {
      if (code === 'time_over') void finish(true);
      else cb.current.onSessionLost();
    });
  }

  // timer + indikator antrean
  useEffect(() => {
    const end = Date.parse(state.ends_at);
    const t = setInterval(() => {
      const r = Math.max(0, Math.ceil((end - clock.now()) / 1000));
      setRemaining(r);
      setPending(queueRef.current?.pending() ?? 0);
      if (r <= 0) void finish(true);
    }, 500);
    return () => clearInterval(t);
  }, [state.ends_at, clock, finish]);

  // sinkron jam server berkala (koreksi drift)
  useEffect(() => {
    const t = setInterval(() => {
      fetchState(attemptId, token).then((s) => clock.sync(s.server_now)).catch(() => {});
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [attemptId, token, clock]);

  // pindah tab/aplikasi dan koneksi
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        void logEvent(attemptId, 'tab_hidden', token);
        setTabWarn(true);
      }
    };
    const onOff = () => setOffline(true);
    const onOn = () => setOffline(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('offline', onOff);
    window.addEventListener('online', onOn);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('offline', onOff);
      window.removeEventListener('online', onOn);
    };
  }, [attemptId, token]);

  // kamera + foto berkala
  useEffect(() => {
    if (profile.camera_excluded) return;
    let sched: SnapshotScheduler | undefined;
    let cancelled = false;
    (async () => {
      if (!streamIsLive(streamRef.current)) {
        try {
          streamRef.current = await requestCamera();
        } catch {
          streamRef.current = null;
        }
      }
      if (cancelled) return;
      if (!streamIsLive(streamRef.current)) {
        setCamWarn(true);
        void logEvent(attemptId, 'camera_lost', token);
      }
      sched = new SnapshotScheduler({
        clock,
        stream: () => (streamIsLive(streamRef.current) ? streamRef.current : null),
        capture: (s) => captureJpeg(s),
        upload: (slot, blob) => uploadSnapshot(attemptId, slot, blob, token),
        onCameraLost: () => {
          setCamWarn(true);
          void logEvent(attemptId, 'camera_lost', token);
        },
      });
      sched.start(Date.parse(state.started_at), state.snapshot_slots);
    })();
    const watch = setInterval(() => setCamWarn(!streamIsLive(streamRef.current)), 5000);
    return () => {
      cancelled = true;
      sched?.stop();
      clearInterval(watch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enableCamera() {
    try {
      streamRef.current = await requestCamera();
      setCamWarn(false);
    } catch {
      setCamWarn(true);
    }
  }

  function save(qid: string, optionId: string | null, flagged: boolean) {
    setAnswers((a) => ({ ...a, [qid]: { optionId, flagged } }));
    queueRef.current!.enqueue({ attemptId, questionId: qid, optionId, flagged, token });
    setPending(queueRef.current!.pending());
  }

  const q = questions[idx];
  const cur = answers[q.id];
  const answeredCount = questions.filter((x) => answers[x.id]?.optionId).length;
  const flaggedCount = questions.filter((x) => answers[x.id]?.flagged).length;
  const unanswered = questions.length - answeredCount;
  const img = questionImageUrl(q.image_path);
  const low = remaining <= 300;
  const camOn = !camWarn || !!profile.camera_excluded;
  const goTo = (i: number) => { setIdx(i); setSheet(false); };
  const last = idx === questions.length - 1;
  const hms = (() => {
    const t = Math.max(0, remaining);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  })();

  const legend = (
    <div className="flex gap-3">
      {[
        ['bg-brand-600 border-brand-600', 'Terjawab'],
        ['bg-info-600 border-info-600', 'Ragu-ragu'],
        ['bg-white border-line-strong', 'Belum'],
      ].map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs font-medium leading-4 text-soft">
          <i className={`h-3 w-3 rounded-[3px] border ${cls}`} />{label}
        </span>
      ))}
    </div>
  );

  const banner = (text: string, action?: React.ReactNode) => (
    <div className="flex items-center gap-2.5 bg-warning-100 px-4 py-3 md:px-8">
      <Icon name="alert-amber" size={18} />
      <p className="flex-1 text-sm font-medium leading-5 text-warning-600">{text}</p>
      {action}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-page pb-[71px] md:h-screen md:pb-0">
      <header className="flex items-center gap-2.5 border-b border-line bg-white px-4 py-2.5 md:gap-4 md:px-8 md:py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand-600 md:h-9 md:w-9">
          <Icon name="shield-white-21" size={21} className="h-[19px] w-[19px] md:h-[21px] md:w-[21px]" />
        </div>
        <span className="hidden text-base font-semibold leading-6 text-brand-700 md:inline">Tes Kemampuan Dasar · TQI</span>
        <div className="order-last flex-1 md:order-none" />
        <div className={`order-2 flex items-center gap-2 rounded-full border px-3 py-1.5 md:order-none md:px-4 md:py-2 ${low ? 'border-danger-600/30 bg-danger-50' : 'border-brand-100 bg-brand-50'}`}>
          <Icon name="clock-brand-16" size={16} className="md:hidden" />
          <Icon name="clock-brand" size={18} className="hidden md:block" />
          <span className={`text-sm font-medium leading-5 tabular-nums md:text-base md:font-semibold md:leading-6 ${low ? 'text-danger-600' : 'text-brand-700'}`}>{hms}</span>
        </div>
        <div className={`order-last flex items-center gap-1.5 rounded-full px-2.5 py-[5px] md:order-none md:gap-2 md:px-3 md:py-1.5 ${camOn ? 'bg-success-100' : 'bg-warning-100'}`}>
          <Icon name={camOn ? 'dot-green' : 'dot-amber'} size={8} />
          <span className={`text-xs font-medium leading-4 ${camOn ? 'text-success-600' : 'text-warning-600'}`}>
            <span className="md:hidden">Kamera</span>
            <span className="hidden md:inline">{camOn ? 'Kamera aktif' : 'Kamera mati'}</span>
          </span>
        </div>
        <Button className="hidden md:inline-flex" onClick={() => setConfirm(true)}>Kirim Jawaban</Button>
      </header>

      {offline && banner('Koneksi terputus. Jawaban tetap tersimpan di perangkat dan dikirim ulang otomatis saat koneksi kembali.')}
      {!offline && pending > 0 && <div className="px-4 pt-2 text-xs text-soft md:px-8">Mengirim {pending} jawaban…</div>}
      {tabWarn && banner('Anda meninggalkan halaman ujian. Kejadian ini dicatat panitia.', <button className="text-sm font-semibold text-warning-600" onClick={() => setTabWarn(false)}>Mengerti</button>)}
      {camWarn && !profile.camera_excluded && banner(
        'Kamera tidak aktif. Nyalakan kembali kamera agar foto berkala tetap terambil. Ujian tetap berjalan dan jawaban Anda aman.',
        <button className="text-sm font-semibold text-warning-600 underline" onClick={enableCamera}>Nyalakan</button>,
      )}

      <div className="flex min-h-0 flex-1 items-stretch">
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:gap-5 md:p-8">
          <div className="flex items-center gap-2 md:gap-3">
            <h1 className="text-base font-semibold leading-6 text-ink md:text-xl md:leading-7">Soal {idx + 1} dari {questions.length}</h1>
            <div className="flex-1" />
            <button
              onClick={() => save(q.id, cur?.optionId ?? null, !cur?.flagged)}
              aria-pressed={!!cur?.flagged}
              className={`rounded-[10px] px-5 py-3 text-sm font-medium leading-5 ${cur?.flagged ? 'border border-info-600 bg-info-600 text-white' : 'border border-line-strong bg-white text-brand-600'}`}
            >
              Ragu-ragu
            </button>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 md:gap-5 md:p-8">
            {q.stimulus && (
              <div className="flex flex-col gap-1 rounded-xl bg-subtle p-4">
                <span className="text-xs font-medium leading-4 text-muted">TEKS PENGANTAR</span>
                <RtlText text={q.stimulus} className="text-base leading-6 text-ink" />
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img && <img src={img} alt="" className="max-h-72 self-start rounded-lg" />}
            <RtlText text={q.body} className="text-base font-semibold leading-6 text-ink md:text-xl md:leading-7" />

            <div className="flex flex-col gap-2 md:gap-3" role="radiogroup">
              {q.options.map((o, i) => {
                const selected = cur?.optionId === o.id;
                const oi = questionImageUrl(o.image_path);
                const rtl = isMostlyArabic(o.body);
                return (
                  <button
                    key={o.id}
                    role="radio"
                    aria-checked={selected}
                    dir={rtl ? 'rtl' : 'ltr'}
                    onClick={() => save(q.id, o.id, cur?.flagged ?? false)}
                    className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition md:gap-3.5 md:p-4 ${selected ? 'border-2 border-brand-600 bg-brand-50' : 'border border-line bg-white hover:bg-brand-50/50'}`}
                  >
                    <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-sm font-medium leading-5 md:h-[34px] md:w-[34px] ${selected ? 'bg-brand-600 text-white' : 'bg-subtle text-soft'}`}>{LETTERS[i]}</span>
                    <span className="min-w-0 flex-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {oi && <img src={oi} alt="" className="mb-1 max-h-32 rounded" />}
                      {o.body && (
                        <span
                          lang={rtl ? 'ar' : 'id'}
                          className={`block whitespace-pre-line text-ink ${rtl ? 'text-right font-arab text-xl leading-9' : 'text-base leading-6'}`}
                        >
                          {o.body}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <Button variant="secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Sebelumnya</Button>
            <div className="flex-1" />
            {last
              ? <Button onClick={() => setConfirm(true)}>Kirim Jawaban</Button>
              : <Button onClick={() => setIdx(idx + 1)}>Berikutnya</Button>}
          </div>
        </main>

        <aside className="hidden w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-white p-6 md:flex">
          <h2 className="text-base font-semibold leading-6 text-ink">Navigasi soal</h2>
          <p className="text-sm font-medium leading-5 text-soft">Terjawab {answeredCount} dari {questions.length}</p>
          <div className="h-2 w-full rounded-full bg-subtle">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
          </div>
          <QuestionNav questions={questions} answers={answers} current={idx} onGo={goTo} size={32} />
          {legend}
        </aside>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-white p-3 md:hidden">
        <Button variant="secondary" className="flex-1" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Sebelumnya</Button>
        <button onClick={() => setSheet(true)} aria-label="Daftar soal" className="flex items-center gap-1.5 rounded-[10px] border border-brand-600 bg-brand-50 p-3 text-sm font-medium leading-5 text-brand-700">
          <Icon name="grid-brand" size={18} />{idx + 1}/{questions.length}
        </button>
        {last
          ? <Button className="flex-1" onClick={() => setConfirm(true)}>Kirim</Button>
          : <Button className="flex-1" onClick={() => setIdx(idx + 1)}>Berikutnya</Button>}
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-[rgba(31,18,13,0.55)] md:hidden" onClick={() => setSheet(false)}>
          <div className="flex max-h-[90vh] w-full flex-col gap-3.5 overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold leading-6 text-ink">Navigasi soal</h2>
              <span className="text-xs font-medium leading-4 text-soft">{answeredCount} dari {questions.length} terjawab</span>
            </div>
            <QuestionNav questions={questions} answers={answers} current={idx} onGo={goTo} size={36} />
            {legend}
            <Button className="w-full" onClick={() => { setSheet(false); setConfirm(true); }}>Kirim Jawaban</Button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,18,13,0.55)] p-4">
          <div className="flex w-full max-w-[480px] flex-col items-center gap-4 rounded-2xl bg-white p-8 shadow-[0_16px_40px_rgba(0,0,0,0.2)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-100">
              <Icon name="alert-amber" size={28} />
            </div>
            <h2 className="text-center text-xl font-semibold leading-7 text-ink">Kirim jawaban sekarang?</h2>
            <p className="text-center text-sm leading-5 text-soft">
              Anda baru menjawab {answeredCount} dari {questions.length} soal
              {unanswered > 0 ? `, ${unanswered} soal belum dijawab` : ''}
              {flaggedCount > 0 ? `${unanswered > 0 ? ' dan' : ','} ${flaggedCount} soal masih ditandai ragu-ragu` : ''}. Setelah dikirim, jawaban tidak dapat diubah.
            </p>
            {submitError && <p className="w-full rounded-[10px] bg-danger-50 p-3 text-sm text-danger-600">{submitError}</p>}
            <div className="flex w-full gap-3">
              <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => setConfirm(false)}>Periksa lagi</Button>
              <Button className="flex-1" disabled={submitting} onClick={() => void finish(false)}>{submitting ? 'Mengirim…' : 'Kirim sekarang'}</Button>
            </div>
          </div>
        </div>
      )}

      {remaining <= 0 && <Modal open title="Waktu habis"><p className="text-sm">Jawaban Anda sedang dikirim…</p></Modal>}
    </div>
  );
}
