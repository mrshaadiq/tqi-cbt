'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { attemptDetail, setManualCorrect, setPassed, signedSnapshotUrls, type AttemptDetail } from '@/lib/adminApi';
import { supabase } from '@/lib/supabase';
import RtlText from '@/components/RtlText';
import { Badge, Button, Icon, Spinner } from '@/components/ui';

const hhmm = (s: string) => new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace(':', '.');

const EVENT: Record<string, { label: string; tone: 'warning' | 'danger' | 'neutral'; tag: string }> = {
  tab_hidden: { label: 'Pindah tab atau aplikasi', tone: 'warning', tag: 'Cek' },
  camera_lost: { label: 'Kamera mati', tone: 'danger', tag: 'Penting' },
  offline: { label: 'Koneksi terputus', tone: 'neutral', tag: 'Info' },
};

function Detail() {
  const id = useSearchParams().get('id');
  const [d, setD] = useState<AttemptDetail | null>(null);
  const [photos, setPhotos] = useState<{ takenAt: string; slot: number; url: string }[]>([]);
  const [passed, setPassedState] = useState<boolean | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const answers = useRef<HTMLDivElement>(null);

  const loadPass = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from('pass_marks').select('passed').eq('attempt_id', id).maybeSingle();
    setPassedState(data ? (data.passed as boolean) : null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    attemptDetail(id).then(setD).catch((e) => setErr(e.message));
    signedSnapshotUrls(id).then(setPhotos).catch(() => {});
    void loadPass();
  }, [id, loadPass]);

  if (!id) return <p>Parameter id tidak ada.</p>;
  if (err) return <p className="text-danger-600">{err}</p>;
  if (!d) return <Spinner />;

  const total = d.rows.length;
  const benar = d.rows.filter((r) => r.is_correct).length;
  const kosong = d.rows.filter((r) => !r.chosen).length;
  const salah = total - benar - kosong;
  const score = d.attempt.score === null ? null : Number(d.attempt.score);

  async function mark(v: boolean | null) {
    try { await setPassed(id!, v); await loadPass(); } catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); }
  }

  async function correct(questionId: string, v: boolean | null) {
    try { await setManualCorrect(id!, questionId, v); setD(await attemptDetail(id!)); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal mengoreksi'); }
  }

  async function purge() {
    if (!confirm('Hapus semua foto peserta ini? Tidak bisa dibatalkan.')) return;
    const { data } = await supabase.from('snapshots').select('path').eq('attempt_id', id!);
    if (data?.length) await supabase.storage.from('snapshots').remove(data.map((r) => r.path as string));
    await supabase.from('snapshots').delete().eq('attempt_id', id!);
    setPhotos([]);
    setMsg('Foto dihapus.');
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">{d.attempt.full_name}</h1>
          <p className="whitespace-pre-wrap text-sm leading-5 text-soft">
            {d.attempt.participant_no}{d.attempt.submitted_at ? `  ·  Selesai ${hhmm(d.attempt.submitted_at)} WIB` : ''}{'  ·  '}
            <Link href="/admin/hasil/" className="font-medium text-brand-600">Kembali ke Hasil</Link>
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => answers.current?.scrollIntoView({ behavior: 'smooth' })}>Lihat jawaban detail</Button>
          <Button variant="secondary" disabled={passed === false} onClick={() => mark(false)}>Tandai tidak lulus</Button>
          <Button disabled={passed === true} onClick={() => mark(true)}>Tandai lulus</Button>
        </div>
      </div>
      {msg && <p className="rounded-[10px] bg-brand-50 p-3 text-sm text-ink">{msg}</p>}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-4 lg:w-[340px] lg:shrink-0">
          <div className="flex flex-col gap-3.5 rounded-xl border border-line bg-white p-5">
            <span className="text-xs font-medium leading-4 text-muted">NILAI TOTAL</span>
            <span className="text-[32px] font-bold leading-10 text-brand-600">{score ?? '-'}</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-subtle"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${score ?? 0}%` }} /></div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{benar} benar</Badge>
              <Badge tone="danger">{salah} salah</Badge>
              <Badge tone="neutral">{kosong} kosong</Badge>
            </div>
            {(d.attempt.section_scores?.length ?? 0) > 1 && (
              <div className="flex flex-col gap-1.5 rounded-[10px] bg-subtle p-3 text-sm leading-5">
                <span className="text-xs font-medium leading-4 text-muted">NILAI PER BAGIAN</span>
                {d.attempt.section_scores!.map((s) => (
                  <div key={s.section} className="flex"><span className="text-ink">{s.section}</span><div className="flex-1" />
                    <span className="tabular-nums text-ink">{Number(s.score).toFixed(0)} <span className="text-muted">({s.correct}/{s.total})</span></span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1.5 text-sm leading-5">
              {[
                ['Mulai', `${hhmm(d.attempt.started_at)} WIB`],
                ['Selesai', d.attempt.submitted_at ? `${hhmm(d.attempt.submitted_at)} WIB` : '-'],
                ['Terjawab', `${total - kosong} dari ${total}`],
              ].map(([k, v]) => (
                <div key={k} className="flex"><span className="text-muted">{k}</span><div className="flex-1" /><span className="text-ink">{v}</span></div>
              ))}
              <div className="flex"><span className="text-muted">Status</span><div className="flex-1" />
                {passed === true ? <Badge tone="success">Lulus</Badge> : passed === false ? <Badge tone="danger">Tidak lulus</Badge> : <Badge tone="neutral">Belum dinilai</Badge>}
              </div>
            </div>
            {passed !== null && <button className="self-start text-sm font-medium text-soft" onClick={() => mark(null)}>Batalkan tanda</button>}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
            <div className="flex items-center">
              <h2 className="text-base font-semibold leading-6 text-ink">Log kejadian</h2>
              <div className="flex-1" />
              <Badge tone={d.events.length ? 'warning' : 'neutral'}>{d.events.length} kejadian</Badge>
            </div>
            {d.events.length ? d.events.map((e, i) => {
              const t = EVENT[e.type] ?? { label: e.type, tone: 'neutral' as const, tag: 'Info' };
              return (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="text-sm font-medium leading-5 text-muted">{hhmm(e.created_at)}</span>
                  <span className="text-sm leading-5 text-ink">{t.label}</span>
                  <div className="flex-1" />
                  <Badge tone={t.tone}>{t.tag}</Badge>
                </div>
              );
            }) : <p className="text-sm text-muted">Tidak ada kejadian.</p>}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-xl border border-line bg-white p-5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold leading-6 text-ink">Foto kamera</h2>
            <Badge tone="neutral">{photos.length} foto</Badge>
            <div className="flex-1" />
            <Button variant="danger" disabled={!photos.length} onClick={purge}>Hapus semua foto</Button>
          </div>
          {photos.length ? (
            <div className="flex flex-wrap gap-3">
              {photos.map((p, i) => (
                <figure key={p.slot} className="flex flex-col gap-1.5">
                  {p.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={`Foto ${p.slot}`} draggable={false} className="h-[120px] w-[158px] rounded-[10px] bg-ink object-cover" />
                  ) : (
                    <div className="flex h-[120px] w-[158px] items-center justify-center rounded-[10px] border border-line-strong bg-subtle"><Icon name="camera-fail" size={40} /></div>
                  )}
                  <figcaption className={`whitespace-pre text-xs font-medium leading-4 ${p.url ? 'text-soft' : 'text-danger-600'}`}>
                    {p.url ? `${hhmm(p.takenAt)}${i === 0 ? '  (Start)' : ''}` : 'Gagal unggah'}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : <p className="text-sm text-muted">Belum ada foto.</p>}
          <div className="flex items-start gap-2 rounded-[10px] bg-info-50 p-3">
            <Icon name="info-blue-b" size={16} />
            <p className="flex-1 text-xs font-medium leading-4 text-info-600">
              Foto bersifat pribadi. Hanya admin yang dapat melihat (tautan bertanda tangan berumur pendek) dan dihapus otomatis 30 hari setelah ujian.
            </p>
          </div>
        </div>
      </div>

      <div ref={answers} className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold leading-6 text-ink">Jawaban per soal</h2>
        <ul className="divide-y divide-line">
          {d.rows.map((r, i) => (
            <li key={r.position} className="flex flex-col">
              {(i === 0 || d.rows[i - 1].section !== r.section) && new Set(d.rows.map((x) => x.section)).size > 1 && (
                <span className="pb-1 pt-3 text-xs font-semibold uppercase leading-4 text-muted">{r.section}</span>
              )}
              <div className="flex items-start gap-3 py-2.5">
                <span className="w-8 shrink-0 text-sm font-semibold text-ink">{r.position}</span>
                <div className="min-w-0 flex-1 text-sm leading-5">
                  <RtlText text={r.question} className="mb-1 font-medium text-ink" />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-soft">
                    <span>{r.type === 'isian' ? 'Jawaban' : 'Dipilih'}: {r.chosen ? <RtlText text={r.chosen} className="inline-block text-ink" /> : <i className="text-muted">kosong</i>}</span>
                    {(!r.is_correct || r.type === 'isian') && <span className="text-success-600">Kunci: <RtlText text={r.correct ?? '-'} className="inline-block" /></span>}
                  </div>
                  {r.type === 'isian' && d.attempt.status !== 'in_progress' && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-medium">
                      {r.manual_correct !== null && <span className="text-muted">Dikoreksi manual</span>}
                      {r.manual_correct !== true && <button className="text-success-600" onClick={() => correct(r.question_id, true)}>Tandai benar</button>}
                      {r.manual_correct !== false && <button className="text-danger-600" onClick={() => correct(r.question_id, false)}>Tandai salah</button>}
                      {r.manual_correct !== null && <button className="text-soft" onClick={() => correct(r.question_id, null)}>Kembalikan otomatis</button>}
                    </div>
                  )}
                </div>
                <Badge tone={r.is_correct ? 'success' : r.chosen ? 'danger' : 'neutral'}>{r.is_correct ? 'Benar' : r.chosen ? 'Salah' : 'Kosong'}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export default function DetailPage() {
  return <Suspense fallback={<Spinner />}><Detail /></Suspense>;
}
