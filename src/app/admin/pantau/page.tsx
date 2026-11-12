'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { extendAttempt, finalizeExpired, getExam, liveStatus, purgeSnapshots, questionSummary, reopenAttempt, resetTryout, stopExam, type LiveRow } from '@/lib/adminApi';
import { formatSeconds } from '@/lib/text';
import { Badge, Button, Icon, Spinner } from '@/components/ui';

const STATUS: Record<LiveRow['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  belum_mulai: { label: 'Belum mulai', tone: 'neutral' },
  in_progress: { label: 'Mengerjakan', tone: 'info' },
  submitted: { label: 'Selesai', tone: 'success' },
  expired: { label: 'Waktu habis', tone: 'warning' },
};

type Filter = 'semua' | 'mengerjakan' | 'belum' | 'selesai' | 'kejadian';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'semua', label: 'Semua' },
  { id: 'mengerjakan', label: 'Mengerjakan' },
  { id: 'belum', label: 'Belum mulai' },
  { id: 'selesai', label: 'Selesai' },
  { id: 'kejadian', label: 'Ada kejadian' },
];

const card = 'flex flex-1 flex-col gap-1 rounded-xl border border-line bg-white p-3.5 md:p-5';
const cols = 'md:grid md:grid-cols-[230px_130px_100px_170px_90px_130px_1fr] md:items-center md:gap-3';

export default function PantauPage() {
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [total, setTotal] = useState(100);
  const [examId, setExamId] = useState<string | null>(null);
  const [examTitle, setExamTitle] = useState('Tes Kemampuan Dasar Akademik');
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('semua');

  const load = useCallback(() => liveStatus().then(setRows).catch((e) => setMsg(e.message)), []);
  useEffect(() => {
    void load();
    getExam().then((e) => { setExamId(e?.id ?? null); if (e?.title) setExamTitle(e.title); });
    questionSummary().then((s) => s.active && setTotal(s.active));
    const t = setInterval(load, 10_000); // polling 10 detik (hemat kuota, tanpa realtime)
    return () => clearInterval(t);
  }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => {
    if (q && !`${r.full_name} ${r.participant_no}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'mengerjakan') return r.status === 'in_progress';
    if (filter === 'belum') return r.status === 'belum_mulai';
    if (filter === 'selesai') return r.status === 'submitted' || r.status === 'expired';
    if (filter === 'kejadian') return r.kejadian > 0;
    return true;
  }), [rows, q, filter]);

  if (!rows) return msg ? <p className="text-danger-600">{msg}</p> : <Spinner />;
  const count = (s: LiveRow['status']) => rows.filter((r) => r.status === s).length;
  const working = rows.filter((r) => r.status === 'in_progress');
  const avgLeft = working.length ? Math.round(working.reduce((a, r) => a + (r.sisa_detik ?? 0), 0) / working.length / 60) : 0;
  const events = rows.reduce((a, r) => a + r.kejadian, 0);

  async function ask(label: string, fn: (min: number) => Promise<unknown>) {
    const v = prompt(label, '10');
    const min = Number(v);
    if (!v || !Number.isFinite(min) || min <= 0) return;
    try { await fn(min); setMsg('Berhasil.'); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); }
  }

  async function run(fn: () => Promise<string>) {
    try { setMsg(await fn()); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); }
  }
  const stop = () => run(async () => {
    if (!confirm(`Hentikan ujian SEKARANG?\n\n${working.length} peserta yang sedang mengerjakan akan langsung dikumpulkan dan dinilai dari jawaban yang sudah tersimpan. Peserta yang belum mulai tidak bisa memulai lagi.`)) return 'Dibatalkan.';
    return `Ujian dihentikan. ${await stopExam(examId!)} peserta dikumpulkan dan dinilai.`;
  });
  const reset = () => run(async () => {
    if (!confirm('Reset ujian?\n\nSEMUA jawaban, nilai, kejadian, dan foto kamera semua peserta dihapus. Akun peserta tetap ada. Tidak bisa dibatalkan.')) return 'Dibatalkan.';
    if (prompt('Ketik RESET untuk melanjutkan') !== 'RESET') return 'Dibatalkan.';
    await purgeSnapshots();
    return `Ujian direset. ${await resetTryout()} attempt dihapus. Atur ulang jam Start di menu Pengaturan Ujian bila perlu.`;
  });
  const actions = (
    <>
      <Button variant="secondary" disabled={!examId} onClick={() => run(async () => `${await finalizeExpired(examId!)} peserta yang waktunya habis dinilai.`)}>Finalisasi waktu habis</Button>
      <Button variant="danger" disabled={!examId} onClick={stop}>Hentikan ujian</Button>
      <Button variant="danger" onClick={reset}>Reset ujian</Button>
    </>
  );

  const stats = [
    { label: 'Belum mulai', big: 'BELUM MULAI', n: count('belum_mulai'), color: 'text-ink', sub: `dari ${rows.length} peserta` },
    { label: 'Mengerjakan', big: 'SEDANG MENGERJAKAN', n: working.length, color: 'text-brand-600', sub: `rata-rata sisa ${avgLeft} menit` },
    { label: 'Selesai', big: 'SELESAI', n: count('submitted') + count('expired'), color: 'text-success-600', sub: 'sudah submit' },
    { label: 'Kejadian', big: 'KEJADIAN MENCURIGAKAN', n: events, color: 'text-danger-600', sub: 'pindah tab dan kamera mati' },
  ];

  return (
    <>
      <div className="hidden items-center gap-3 md:flex">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">Pantauan Live</h1>
          <p className="whitespace-pre text-sm leading-5 text-soft">{examTitle}{'  ·  '}Sedang berlangsung</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 rounded-full bg-success-100 px-3 py-2">
          <Icon name="refresh-green" size={14} />
          <span className="text-xs font-medium leading-4 text-success-600">Perbarui otomatis tiap 10 detik</span>
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-2 md:hidden">{actions}</div>

      <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
        {stats.map((s) => (
          <div key={s.big} className={card}>
            <span className="text-xs font-medium leading-4 text-muted"><span className="md:hidden">{s.label}</span><span className="hidden md:inline">{s.big}</span></span>
            <span className={`text-2xl font-bold leading-8 md:text-[32px] md:leading-10 ${s.color}`}>{s.n}</span>
            <span className="hidden text-xs font-medium leading-4 text-soft md:block">{s.sub}</span>
          </div>
        ))}
      </div>

      {msg && <p className="rounded-[10px] bg-brand-50 p-3 text-sm text-ink">{msg}</p>}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-3.5 md:w-[300px]">
          <Icon name="search-muted" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau nomor peserta" className="min-w-0 flex-1 bg-transparent text-sm leading-5 text-ink outline-none placeholder:text-muted" />
        </label>
        <div className="flex gap-2 overflow-x-auto md:gap-3">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium leading-5 ${filter === f.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-soft'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className={`hidden bg-subtle px-4 py-2.5 text-xs font-medium leading-4 text-muted md:grid md:grid-cols-[230px_130px_100px_170px_90px_130px_1fr] md:gap-3`}>
          <span>PESERTA</span><span>STATUS</span><span>SISA WAKTU</span><span>TERJAWAB</span><span>KEJADIAN</span><span>KAMERA</span><span>AKSI</span>
        </div>
        {shown.map((r) => {
          const pct = r.attempt_id ? Math.min(100, (r.terjawab / total) * 100) : 0;
          return (
            <div key={r.user_id} className={`${cols} flex flex-col items-start gap-2 border-b border-line px-4 py-3 last:border-b-0`}>
              <div className="flex flex-col gap-0.5 font-medium">
                <span className="text-sm leading-5 text-ink">{r.full_name}</span>
                <span className="text-xs leading-4 text-muted">{r.participant_no}</span>
              </div>
              <div><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></div>
              <span className="text-sm leading-5 tabular-nums text-ink">{r.sisa_detik !== null ? formatSeconds(r.sisa_detik) : '-'}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm leading-5 tabular-nums text-ink">{r.attempt_id ? `${r.terjawab}/${total}` : '-'}</span>
                {r.attempt_id && (
                  <div className="h-1.5 w-20 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
                )}
              </div>
              <div>
                {!r.attempt_id || r.kejadian === 0
                  ? <span className="text-sm leading-5 text-muted">{r.attempt_id ? 0 : '-'}</span>
                  : <Badge tone={r.kejadian >= 5 ? 'danger' : 'warning'}>{r.kejadian}</Badge>}
              </div>
              <div>
                {r.camera_excluded ? <Badge tone="neutral">Dikecualikan</Badge>
                  : r.attempt_id && r.foto > 0 ? <Badge tone="success">Aktif</Badge>
                  : r.attempt_id && r.status === 'in_progress' ? <Badge tone="warning">Mati</Badge>
                  : <span className="text-sm text-muted">-</span>}
              </div>
              <div className="flex gap-4 text-sm font-medium leading-5 text-brand-600">
                {r.status === 'in_progress' && <button onClick={() => ask('Tambah berapa menit?', (m) => extendAttempt(r.attempt_id!, m))}>Tambah waktu</button>}
                {(r.status === 'expired' || r.status === 'submitted') && <button onClick={() => ask('Buka kembali, beri waktu berapa menit?', (m) => reopenAttempt(r.attempt_id!, m))}>Buka kembali</button>}
                {r.attempt_id && <Link href={`/admin/detail/?id=${r.attempt_id}`}>Detail</Link>}
              </div>
            </div>
          );
        })}
        {!shown.length && <p className="p-4 text-sm text-muted">{rows.length ? 'Tidak ada peserta yang cocok.' : 'Belum ada peserta.'}</p>}
      </div>
    </>
  );
}
