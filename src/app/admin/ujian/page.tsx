'use client';
import { useEffect, useState } from 'react';
import { getExam, listParticipants, purgeSnapshots, questionSummary, resetTryout, saveExam } from '@/lib/adminApi';
import { Badge, Button, Icon, Spinner, Toggle, inputCls } from '@/components/ui';

const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const hhmm = (v: string) => (v ? new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace(':', '.') : '-');

const MANUAL = [
  { id: 'supabase', label: 'Proyek Supabase aktif', doneLabel: 'Active' },
  { id: 'auth', label: 'Batas Auth dinaikkan', doneLabel: 'Selesai' },
  { id: 'load', label: 'Uji beban 100 peserta', doneLabel: 'Selesai' },
  { id: 'backup', label: 'Backup database', doneLabel: 'Selesai' },
];
const CHECK_KEY = 'tqi_checklist_hari_h';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-sm font-medium leading-5 text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs font-medium leading-4 text-muted">{hint}</span>}
    </label>
  );
}

const section = 'text-base font-semibold leading-6 text-ink';

export default function UjianPage() {
  const [loaded, setLoaded] = useState(false);
  const [examId, setExamId] = useState<string | undefined>();
  const [title, setTitle] = useState('Tes Kemampuan Dasar Akademik');
  const [duration, setDuration] = useState(90);
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [sum, setSum] = useState<{ active: number; problematic: number } | null>(null);
  const [accounts, setAccounts] = useState(0);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function fill() {
    const e = await getExam();
    if (e) { setExamId(e.id); setTitle(e.title); setDuration(e.duration_minutes); setOpens(toLocalInput(e.opens_at)); setCloses(toLocalInput(e.closes_at)); }
  }

  useEffect(() => {
    (async () => {
      await fill();
      setSum(await questionSummary());
      setAccounts((await listParticipants()).length);
      try { setChecks(JSON.parse(localStorage.getItem(CHECK_KEY) ?? '{}')); } catch { /* abaikan */ }
      setLoaded(true);
    })().catch((e) => setErr(e.message));
  }, []);

  function tick(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    try { localStorage.setItem(CHECK_KEY, JSON.stringify(next)); } catch { /* abaikan */ }
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setErr(''); setMsg('');
    try {
      await saveExam({ title, durationMinutes: duration, opensAt: new Date(opens).toISOString(), closesAt: new Date(closes).toISOString() }, examId);
      setMsg('Pengaturan ujian tersimpan.');
      const e = await getExam();
      setExamId(e?.id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menyimpan'); }
  }

  if (!loaded) return err ? <p className="text-danger-600">{err}</p> : <Spinner />;
  const questionsOk = !!sum?.active && !sum.problematic;
  const stat = 'flex flex-1 flex-col gap-0.5 rounded-[10px] bg-subtle p-4';

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">Pengaturan Ujian</h1>
          <p className="text-sm leading-5 text-soft">Atur durasi dan jendela waktu Start untuk {title}</p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-3">
          <Button type="button" variant="ghost" className="text-soft" onClick={() => void fill()}>Batal</Button>
          <Button type="submit">Simpan Pengaturan</Button>
        </div>
      </div>

      {err && <p className="rounded-[10px] bg-danger-50 p-3 text-sm text-danger-600">{err}</p>}
      {msg && <p className="rounded-[10px] bg-success-100 p-3 text-sm text-success-600">{msg}</p>}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5 rounded-xl border border-line bg-white p-5 md:p-6">
          <h2 className={section}>Informasi ujian</h2>
          <Field label="Nama ujian"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
          <div className="flex flex-col gap-4 md:flex-row">
            <Field label="Durasi (menit)" hint="Belum diputuskan. Atur sesuai keputusan panitia">
              <input type="number" min={1} max={600} className={inputCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))} required />
            </Field>
            <Field label="Total soal" hint="Otomatis dari jumlah soal aktif di bank soal">
              <input className={`${inputCls} bg-subtle`} value={`${sum?.active ?? 0} soal`} readOnly />
            </Field>
          </div>
          <div className="flex flex-col gap-4 md:flex-row">
            <Field label="Start dibuka"><input type="datetime-local" className={inputCls} value={opens} onChange={(e) => setOpens(e.target.value)} required /></Field>
            <Field label="Start ditutup" hint="Peserta yang sudah mulai tetap mendapat durasi penuh">
              <input type="datetime-local" className={inputCls} value={closes} onChange={(e) => setCloses(e.target.value)} required />
            </Field>
          </div>

          <h2 className={section}>Soal ujian</h2>
          <div className="flex gap-3">
            <div className={stat}><span className="text-xs font-medium leading-4 text-muted">SOAL AKTIF</span><span className="text-2xl font-bold leading-8 text-success-600">{sum?.active ?? 0}</span></div>
            <div className={stat}><span className="text-xs font-medium leading-4 text-muted">SOAL BERMASALAH</span><span className="text-2xl font-bold leading-8 text-ink">{sum?.problematic ?? 0}</span></div>
            <div className={`${stat} hidden md:flex`}><span className="text-xs font-medium leading-4 text-muted">OPSI PER SOAL</span><span className="text-2xl font-bold leading-8 text-ink">2-5</span></div>
          </div>
          <div className="flex items-start gap-2 rounded-[10px] bg-info-50 p-3">
            <Icon name="info-blue" size={16} />
            <p className="flex-1 text-xs font-medium leading-4 text-info-600">Ujian memakai semua soal aktif di bank soal, diacak per peserta. Tidak ada pembagian mapel. Kelola soal di menu Bank Soal.</p>
          </div>

          <h2 className={section}>Opsi ujian</h2>
          {[
            ['Acak urutan soal dan opsi per peserta', 'Setiap peserta mendapat urutan berbeda'],
            ['Foto kamera wajib', 'Foto saat Start dan tiap 10 menit'],
            ['Catat pindah tab atau aplikasi', 'Dicatat sebagai kejadian, tanpa diskualifikasi otomatis'],
          ].map(([a, b]) => (
            <div key={a} className="flex items-center gap-3">
              <div className="flex flex-col gap-0.5 font-medium"><span className="text-sm leading-5 text-ink">{a}</span><span className="text-xs leading-4 text-muted">{b}</span></div>
              <div className="flex-1" />
              <Toggle on label={a} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 lg:w-[340px] lg:shrink-0">
          <div className="flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50 p-5">
            <h2 className="text-base font-semibold leading-6 text-brand-700">Ringkasan</h2>
            {[
              ['Durasi', `${duration} menit`],
              ['Total soal', `${sum?.active ?? 0} soal`],
              ['Peserta terdaftar', `${accounts} akun`],
              ['Jendela Start', `${hhmm(opens)} - ${hhmm(closes)} WIB`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center text-sm leading-5"><span className="text-soft">{k}</span><div className="flex-1" /><span className="font-medium text-ink">{v}</span></div>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
            <h2 className={section}>Checklist sebelum hari H</h2>
            <div className="flex items-center text-sm leading-5 text-soft">
              {sum?.active ?? 0} soal diimpor dan diperiksa<div className="flex-1" />
              <Badge tone={questionsOk ? 'success' : 'warning'}>{questionsOk ? 'Selesai' : 'Belum'}</Badge>
            </div>
            {MANUAL.map((m) => (
              <div key={m.id} className="flex items-center text-sm leading-5 text-soft">
                {m.label}<div className="flex-1" />
                <button type="button" onClick={() => tick(m.id)} aria-pressed={!!checks[m.id]}>
                  <Badge tone={checks[m.id] ? 'success' : 'warning'}>{checks[m.id] ? m.doneLabel : 'Belum'}</Badge>
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-danger-600/30 bg-white p-5">
            <h2 className="text-base font-semibold leading-6 text-danger-600">Pembersihan data</h2>
            <Button type="button" variant="secondary" onClick={async () => { if (!confirm('Hapus foto yang lebih lama dari 30 hari?')) return; setMsg(`${await purgeSnapshots(30)} foto dihapus.`); }}>Hapus foto &gt; 30 hari</Button>
            <Button type="button" variant="danger" onClick={async () => { if (!confirm('Hapus SEMUA foto kamera? Tidak bisa dibatalkan.')) return; setMsg(`${await purgeSnapshots()} foto dihapus.`); }}>Hapus semua foto</Button>
            <Button type="button" variant="danger" onClick={async () => { if (!confirm('Hapus SEMUA hasil ujian (jawaban, nilai, kejadian)? Pakai setelah tes coba. Tidak bisa dibatalkan.')) return; setMsg(`${await resetTryout()} attempt dihapus. Hapus juga foto bila perlu.`); }}>Reset tes coba</Button>
          </div>
        </div>
      </div>
    </form>
  );
}
