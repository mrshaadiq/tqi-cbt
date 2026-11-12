'use client';
import { useEffect, useState, type MutableRefObject } from 'react';
import { Badge, Button, Icon, PesertaHeader } from '@/components/ui';
import { requestCamera, streamIsLive } from '@/lib/camera';
import type { Exam } from '@/lib/examApi';
import type { Profile } from '@/lib/auth';
import type { ServerClock } from '@/lib/serverClock';

function Page({ profile, children, footer }: { profile?: Profile; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <PesertaHeader name={profile?.full_name} no={profile?.participant_no} />
      <main className="flex flex-1 flex-col items-center gap-5 px-4 py-4 pb-28 md:py-10 md:pb-10">{children}</main>
      {footer}
    </div>
  );
}

const card = 'w-full rounded-2xl border border-line bg-white';

export function Message({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <Page>
      <div className={`${card} flex max-w-[520px] flex-col items-center gap-4 p-8 text-center md:p-12`}>
        <h1 className="text-2xl font-bold leading-8 text-ink">{title}</h1>
        <p className="text-base leading-6 text-soft">{text}</p>
        {action}
      </div>
    </Page>
  );
}

const jakarta = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace(':', '.');

const CHECKS = [
  { long: 'Koneksi internet stabil dan baterai cukup atau charger tersambung', short: 'Koneksi stabil, baterai cukup' },
  { long: 'Kamera depan berfungsi, wajah terlihat jelas, cahaya cukup', short: 'Kamera depan berfungsi, cahaya cukup' },
  { long: 'Duduk di tempat tenang. Jangan berpindah tab atau aplikasi selama tes', short: 'Tempat tenang, jangan pindah tab' },
];

/** Menunggu jendela Start dibuka. Login boleh 15-30 menit lebih awal. */
export function Waiting({ exam, clock, profile, onOpen, onLogout }: {
  exam: Exam; clock: ServerClock; profile: Profile; onOpen: () => void; onLogout: () => void;
}) {
  const [left, setLeft] = useState(() => Math.ceil((Date.parse(exam.opens_at) - clock.now()) / 1000));
  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.ceil((Date.parse(exam.opens_at) - clock.now()) / 1000);
      setLeft(l);
      if (l <= 0) onOpen();
    }, 500);
    return () => clearInterval(t);
  }, [exam.opens_at, clock, onOpen]);

  const t = Math.max(0, left);
  const parts = [
    { v: Math.floor(t / 3600), l: 'Jam' },
    { v: Math.floor((t % 3600) / 60), l: 'Menit' },
    { v: t % 60, l: 'Detik' },
  ];
  const info = [
    { icon: 'clock-muted', text: `Durasi ${exam.duration_minutes} menit` },
    { icon: 'file-muted', text: '100 soal pilihan ganda' },
    { icon: 'lock-muted', text: `Start dibuka ${jakarta(exam.opens_at)} - ${jakarta(exam.closes_at)} WIB` },
  ];

  return (
    <Page
      profile={profile}
      footer={
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white px-4 pb-4 pt-4 md:hidden">
          <Button variant="secondary" disabled className="w-full py-3.5">Start</Button>
          <p className="mt-2 text-center text-xs font-medium leading-4 text-muted">Start aktif setelah jendela dibuka dan kamera siap.</p>
        </div>
      }
    >
      <div className={`${card} flex max-w-[680px] flex-col items-center gap-6 p-6 md:p-8`}>
        <Badge tone="brand">Login berhasil</Badge>
        <h1 className="text-center text-xl font-bold leading-7 text-ink md:text-2xl md:leading-8">Selamat datang, {profile.full_name}</h1>
        <p className="text-center text-sm leading-5 text-soft md:text-base md:leading-6">{exam.title} TA 2026/2027</p>
        <p className="text-sm font-medium leading-5 text-muted">Tes dibuka dalam</p>
        <div className="flex gap-2 md:gap-3" aria-live="off">
          {parts.map((p) => (
            <div key={p.l} className="flex min-w-[75px] flex-col items-center gap-0.5 rounded-xl border border-brand-100 bg-brand-50 px-5 py-4 tabular-nums md:px-7">
              <span className="text-[32px] font-bold leading-10 text-brand-700">{String(p.v).padStart(2, '0')}</span>
              <span className="text-xs font-medium leading-4 text-soft">{p.l}</span>
            </div>
          ))}
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:gap-3">
          {info.map((i) => (
            <div key={i.icon} className="flex items-center gap-2 rounded-[10px] bg-subtle px-3.5 py-2.5">
              <Icon name={i.icon} size={16} />
              <span className="text-sm font-medium leading-5 text-soft">{i.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`${card} flex max-w-[680px] flex-col gap-3.5 p-5 md:p-6`}>
        <h2 className="text-base font-semibold leading-6 text-ink">Persiapan sebelum mulai</h2>
        {CHECKS.map((c) => (
          <div key={c.long} className="flex items-center gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-100 md:h-7 md:w-7">
              <Icon name="check-green" size={16} className="h-3.5 w-3.5 md:h-4 md:w-4" />
            </div>
            <p className="flex-1 text-sm leading-5 text-soft">
              <span className="md:hidden">{c.short}</span>
              <span className="hidden md:inline">{c.long}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="hidden flex-col items-center gap-5 md:flex">
        <Button variant="secondary" disabled>Start</Button>
        <p className="text-xs font-medium leading-4 text-muted">Tombol Start aktif setelah jendela dibuka dan izin kamera diberikan.</p>
      </div>
      <button className="text-xs font-medium text-muted underline" onClick={onLogout}>Keluar</button>
    </Page>
  );
}

function Step({ done, n, label }: { done: boolean; n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-[22px] w-[22px] items-center justify-center rounded-full md:h-7 md:w-7 ${done ? 'bg-success-600' : 'bg-subtle'}`}>
        {done
          ? <Icon name="check-white-16" size={16} className="h-[13px] w-[13px] md:h-4 md:w-4" />
          : <span className="text-xs font-medium text-soft md:text-sm">{n}</span>}
      </div>
      <span className={`text-xs font-medium md:text-sm md:leading-5 ${done ? 'text-ink' : 'text-muted'}`}>{label}</span>
    </div>
  );
}

const POINTS = [
  ['Foto wajah peserta diambil otomatis saat Start dan setiap 10 menit selama ujian.', 'Foto wajah diambil otomatis saat Start dan tiap 10 menit.'],
  ['Foto diambil di latar belakang tanpa pratinjau dan tanpa suara. Hanya panitia yang dapat melihatnya.', 'Diambil di latar belakang tanpa pratinjau. Hanya panitia yang melihat.'],
  ['Foto dihapus 30 hari setelah ujian selesai. Tidak ada pengenalan wajah otomatis.', 'Dihapus 30 hari setelah ujian selesai.'],
];

/** Persetujuan foto kamera dan wali, izin kamera, lalu tombol Start. */
export function Consent({ profile, streamRef, onStart, error, busy }: {
  exam: Exam; profile: Profile; streamRef: MutableRefObject<MediaStream | null>;
  onStart: () => void; error: string; busy: boolean;
}) {
  const [agree, setAgree] = useState(false);
  const [camOk, setCamOk] = useState(() => streamIsLive(streamRef.current));
  const [camErr, setCamErr] = useState('');
  const needCam = !profile.camera_excluded;

  async function enable() {
    setCamErr('');
    try {
      streamRef.current = await requestCamera();
      setCamOk(true);
    } catch {
      setCamErr('Kamera tidak dapat dinyalakan. Izinkan akses kamera pada browser, lalu coba lagi.');
    }
  }

  const camDone = !needCam || camOk;
  const startBtn = (
    <Button className="w-full" disabled={!agree || !camDone || busy} onClick={onStart}>
      {busy ? 'Memulai…' : 'Start Ujian'}
    </Button>
  );

  return (
    <Page
      profile={profile}
      footer={<div className="fixed inset-x-0 bottom-0 bg-white px-4 py-4 md:hidden">{startBtn}</div>}
    >
      <div className="flex items-center gap-3">
        <Step done={agree} n={1} label="Persetujuan" />
        <div className="h-0.5 w-6 bg-line-strong md:w-12" />
        <Step done={camDone} n={2} label="Izin kamera" />
        <div className="h-0.5 w-6 bg-line-strong md:w-12" />
        <Step done={false} n={3} label="Mulai ujian" />
      </div>

      <div className="flex w-full max-w-[984px] flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className={`${card} flex flex-col gap-4 p-5 md:w-[560px] md:shrink-0 md:p-8`}>
          <h2 className="text-base font-semibold leading-6 text-ink md:text-xl md:leading-7">Persetujuan foto kamera</h2>
          {POINTS.map(([long, short]) => (
            <div key={long} className="flex items-start gap-2.5">
              <Icon name="dot-brand" size={6} className="h-5 w-1.5" />
              <p className="flex-1 text-sm leading-5 text-soft">
                <span className="md:hidden">{short}</span>
                <span className="hidden md:inline">{long}</span>
              </p>
            </div>
          ))}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 p-4">
            <input type="checkbox" className="sr-only" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md ${agree ? 'bg-brand-600' : 'border border-line-strong bg-white'}`}>
              {agree && <Icon name="check-white-sm" size={14} />}
            </span>
            <span className="flex-1 text-sm font-medium leading-5 text-ink">
              Saya adalah peserta atau wali peserta dan menyetujui pengambilan foto kamera selama ujian.
            </span>
          </label>
        </div>

        <div className={`${card} flex flex-col items-center gap-4 p-5 md:w-[400px] md:shrink-0 md:p-8`}>
          <h2 className="hidden text-xl font-semibold leading-7 text-ink md:block">Izin kamera</h2>
          <div className="flex h-[170px] w-full flex-col items-center justify-center gap-2 rounded-xl bg-ink md:h-[230px]">
            <Icon name="user-light" size={72} className="h-14 w-14 md:h-[72px] md:w-[72px]" />
            {!needCam ? (
              <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium text-soft">Kamera tidak diperlukan</span>
            ) : camOk ? (
              <span className="flex items-center gap-1.5 rounded-full bg-success-100 px-2.5 py-1 text-xs font-medium leading-4 text-success-600">
                <Icon name="dot-green" size={8} /> Kamera aktif
              </span>
            ) : (
              <Button variant="secondary" className="px-4 py-2" onClick={enable}>Nyalakan kamera</Button>
            )}
          </div>
          {camErr && <p className="w-full text-sm text-danger-600">{camErr}</p>}
          <p className="hidden text-center text-xs font-medium leading-4 text-muted md:block">
            Pratinjau hanya tampil di layar ini. Saat ujian berjalan hanya ada titik hijau kecil di pojok layar.
          </p>
          {error && <p className="w-full rounded-[10px] bg-danger-50 p-3 text-sm text-danger-600">{error}</p>}
          <div className="hidden w-full md:block">{startBtn}</div>
        </div>
      </div>
    </Page>
  );
}

export function Finished({ onLogout }: { onLogout: () => void }) {
  const [at] = useState(() => jakarta(new Date().toISOString()));
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <PesertaHeader />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className={`${card} flex max-w-[520px] flex-col items-center gap-4 p-8 md:p-12`}>
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success-100">
            <Icon name="check-big" size={44} />
          </div>
          <h1 className="text-2xl font-bold leading-8 text-ink">Ujian selesai</h1>
          <p className="text-center text-base leading-6 text-soft">
            Jawaban Anda sudah tersimpan dan terkirim ke panitia. Hasil seleksi akan diumumkan panitia melalui jalur resmi.
          </p>
          <Badge tone="success">Dikirim {at} WIB</Badge>
          <Button variant="secondary" onClick={onLogout}>Keluar</Button>
        </div>
      </main>
    </div>
  );
}
