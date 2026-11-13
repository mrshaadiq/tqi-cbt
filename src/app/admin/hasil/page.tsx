'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { finalizeExpired, getExam, listParticipants, questionSummary, results, setPassed, type ResultDbRow } from '@/lib/adminApi';
import { supabase } from '@/lib/supabase';
import { downloadBlob, exportResultsXlsx } from '@/lib/export/excel';
import { Badge, Button, Icon, Spinner } from '@/components/ui';

const cols = 'md:grid md:grid-cols-[40px_220px_110px_190px_90px_130px_1fr] md:items-center md:gap-3';

/** Jumlah jawaban terisi per attempt (dibaca per halaman 1000 baris karena batas API). */
async function answeredCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('answers').select('attempt_id').not('option_id', 'is', null).range(from, from + 999);
    if (error) throw new Error(error.message);
    data.forEach((r) => { out[r.attempt_id as string] = (out[r.attempt_id as string] ?? 0) + 1; });
    if (data.length < 1000) return out;
  }
}

export default function HasilPage() {
  const [rows, setRows] = useState<ResultDbRow[] | null>(null);
  const [answered, setAnswered] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(100);
  const [accounts, setAccounts] = useState(0);
  const [exam, setExam] = useState<{ id: string; title: string } | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => results().then(setRows).catch((e) => setMsg(e.message)), []);
  useEffect(() => {
    void load();
    answeredCounts().then(setAnswered).catch(() => {});
    questionSummary().then((s) => s.active && setTotal(s.active));
    listParticipants().then((p) => setAccounts(p.length)).catch(() => {});
    getExam().then((e) => e && setExam({ id: e.id, title: e.title }));
  }, [load]);

  if (!rows) return msg ? <p className="text-danger-600">{msg}</p> : <Spinner />;

  const scores = rows.map((r) => Number(r.score ?? 0));
  const avg = rows.length ? scores.reduce((a, b) => a + b, 0) / rows.length : 0;
  const top = rows.length ? rows.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a)) : null;
  const low = rows.length ? rows.reduce((a, b) => (Number(b.score) < Number(a.score) ? b : a)) : null;
  const passed = rows.filter((r) => r.passed === true).length;
  const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });

  const stats = [
    { label: 'RATA-RATA NILAI', value: fmt(avg), color: 'text-ink', sub: `dari ${rows.length} peserta` },
    { label: 'NILAI TERTINGGI', value: top ? fmt(Number(top.score)) : '-', color: 'text-success-600', sub: top?.full_name ?? '-' },
    { label: 'NILAI TERENDAH', value: low ? fmt(Number(low.score)) : '-', color: 'text-danger-600', sub: low?.full_name ?? '-' },
    { label: 'DITANDAI LULUS', value: String(passed), color: 'text-brand-600', sub: `dari ${accounts || rows.length} peserta` },
  ];

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">Hasil Ujian</h1>
          <p className="whitespace-pre-wrap text-sm leading-5 text-soft">{exam?.title ?? 'Tes Kemampuan Dasar Akademik'}{'  ·  '}{rows.length} dari {accounts || rows.length} peserta sudah selesai</p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-3">
          <Button variant="secondary" disabled={!exam} onClick={async () => { setMsg(`${await finalizeExpired(exam!.id)} peserta yang waktunya habis dinilai.`); await load(); }}>Finalisasi waktu habis</Button>
          <Button onClick={async () => downloadBlob(await exportResultsXlsx(rows.map((r) => ({
            rank: r.rank, fullName: r.full_name, participantNo: r.participant_no, score: Number(r.score), correctCount: r.correct_count,
            passed: r.passed, eventCount: r.kejadian,
            sections: (r.section_scores ?? []).map((s) => ({ name: s.section, score: Number(s.score) })),
            scales: (r.scale_scores ?? []).map((s) => ({ name: s.section, score: s.score, max: s.max })),
          }))), 'hasil-tes.xlsx')}>Ekspor Excel</Button>
        </div>
      </div>

      {msg && <p className="rounded-[10px] bg-brand-50 p-3 text-sm text-ink">{msg}</p>}

      <div className="grid grid-cols-2 gap-3 md:flex md:gap-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-1 flex-col gap-1 rounded-xl border border-line bg-white p-3.5 md:p-5">
            <span className="text-xs font-medium leading-4 text-muted">{s.label}</span>
            <span className={`text-2xl font-bold leading-8 md:text-[32px] md:leading-10 ${s.color}`}>{s.value}</span>
            <span className="truncate text-xs font-medium leading-4 text-soft">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="hidden bg-subtle px-4 py-2.5 text-xs font-medium leading-4 text-muted md:grid md:grid-cols-[40px_220px_110px_190px_90px_130px_1fr] md:gap-3">
          <span>#</span><span>PESERTA</span><span>NILAI (0-100)</span><span>BENAR / SALAH / KOSONG</span><span>KEJADIAN</span><span>STATUS</span><span>AKSI</span>
        </div>
        {rows.map((r) => {
          const ans = r.terjawab ?? answered[r.attempt_id] ?? r.correct_count;
          const wrong = Math.max(0, ans - r.correct_count);
          const empty = Math.max(0, (r.total_soal || total) - ans);
          return (
            <div key={r.attempt_id} className={`${cols} flex flex-col items-start gap-2 border-b border-line px-4 py-3 last:border-b-0`}>
              <span className="text-sm leading-5 text-ink">{r.rank}</span>
              <div className="flex flex-col gap-0.5 font-medium">
                <span className="text-sm leading-5 text-ink">{r.full_name}</span>
                <span className="text-xs leading-4 text-muted">{r.participant_no}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-base font-semibold leading-6 text-ink">{Number(r.score).toFixed(0)}</span>
                {(r.section_scores?.length ?? 0) > 1 && (
                  <span className="text-xs leading-4 text-muted" title={r.section_scores!.map((s) => `${s.section}: ${Number(s.score).toFixed(0)}`).join('\n')}>
                    {r.section_scores!.map((s) => Number(s.score).toFixed(0)).join(' · ')}
                  </span>
                )}
              </div>
              <span className="whitespace-pre text-sm leading-5 text-ink">{`${r.correct_count}  /  ${wrong}  /  ${empty}`}</span>
              <div>
                {r.kejadian === 0 ? <span className="text-sm leading-5 text-muted">0</span> : <Badge tone={r.kejadian >= 5 ? 'danger' : 'warning'}>{r.kejadian}</Badge>}
              </div>
              <div>
                {r.passed === true ? <Badge tone="success">Lulus</Badge>
                  : r.passed === false ? <Badge tone="danger">Tidak lulus</Badge>
                  : <Badge tone={r.status === 'submitted' ? 'neutral' : 'warning'}>Belum dinilai</Badge>}
              </div>
              <div className="flex flex-wrap gap-3.5 text-sm font-medium leading-5 text-brand-600">
                <Link href={`/admin/detail/?id=${r.attempt_id}`}>Detail</Link>
                {r.passed === null ? (
                  <>
                    <button onClick={async () => { await setPassed(r.attempt_id, true); await load(); }}>Tandai lulus</button>
                    <button className="text-soft" onClick={async () => { await setPassed(r.attempt_id, false); await load(); }}>Tidak lulus</button>
                  </>
                ) : (
                  <button className="text-soft" onClick={async () => { await setPassed(r.attempt_id, null); await load(); }}>Batalkan tanda</button>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && <p className="p-4 text-sm text-muted">Belum ada hasil.</p>}
      </div>

      <div className="flex items-center gap-2">
        <Icon name="info-muted" size={16} />
        <p className="text-xs font-medium leading-4 text-muted">Nilai total dari {total} soal; angka kecil di bawah nilai adalah nilai per bagian. Peserta tidak melihat nilai di website. Hasil hanya untuk panitia dan diekspor ke Excel.</p>
      </div>
    </>
  );
}
