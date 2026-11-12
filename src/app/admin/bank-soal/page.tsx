'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deleteQuestion, isProblematic, listQuestions, rowToDraft, saveQuestions, setQuestionActive, updateQuestion, type QuestionRow } from '@/lib/adminApi';
import { validateDrafts } from '@/lib/import/validate';
import { emptyDraft, type DraftQuestion } from '@/lib/import/types';
import { isMostlyArabic } from '@/lib/text';
import { questionImageUrl } from '@/lib/supabase';
import QuestionEditor from '@/components/QuestionEditor';
import RtlText from '@/components/RtlText';
import { Badge, Button, Icon, Spinner } from '@/components/ui';

type Filter = 'semua' | 'arab' | 'pengantar' | 'gambar' | 'nonaktif' | 'bermasalah';
const PAGE = 8;
const cols = 'md:grid md:grid-cols-[50px_minmax(0,1fr)_60px_60px_130px_230px] md:items-center md:gap-3';

const hasArabic = (q: QuestionRow) => isMostlyArabic(q.body) || q.options.some((o) => isMostlyArabic(o.body));

export default function BankSoalPage() {
  const [rows, setRows] = useState<QuestionRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('semua');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftQuestion | null>(null);
  const [adding, setAdding] = useState<DraftQuestion | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => listQuestions().then(setRows).catch((e) => setMsg(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const matches = useMemo(() => (rows ?? []).filter((q) => {
    if (filter === 'arab' && !hasArabic(q)) return false;
    if (filter === 'pengantar' && !q.stimulus) return false;
    if (filter === 'gambar' && !q.image_path && !q.options.some((o) => o.image_path)) return false;
    if (filter === 'nonaktif' && q.is_active) return false;
    if (filter === 'bermasalah' && !isProblematic(q)) return false;
    return !search || (q.body + ' ' + (q.stimulus ?? '')).toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search]);

  if (!rows) return msg ? <p className="text-danger-600">{msg}</p> : <Spinner />;

  const pages = Math.max(1, Math.ceil(matches.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = matches.slice(cur * PAGE, cur * PAGE + PAGE);
  const problematic = rows.filter(isProblematic).length;
  const chips: { id: Filter; label: string }[] = [
    { id: 'semua', label: `Semua (${rows.length})` },
    { id: 'arab', label: `Teks Arab (${rows.filter(hasArabic).length})` },
    { id: 'pengantar', label: 'Ada teks pengantar' },
    { id: 'gambar', label: 'Ada gambar' },
    { id: 'nonaktif', label: 'Nonaktif' },
    ...(problematic ? [{ id: 'bermasalah' as Filter, label: `Bermasalah (${problematic})` }] : []),
  ];

  async function saveEdit(q: QuestionRow) {
    const [v] = validateDrafts([draft!]);
    setDraft(v);
    if (v.errors.length) return setMsg('Perbaiki dulu: ' + v.errors.join('; '));
    try { await updateQuestion(q.id, v, q.is_active, q.image_path); setEditId(null); setMsg(''); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal menyimpan'); }
  }

  async function saveNew() {
    const [v] = validateDrafts([adding!]);
    setAdding(v);
    if (v.errors.length) return setMsg('Perbaiki dulu: ' + v.errors.join('; '));
    try { await saveQuestions([v]); setAdding(null); setMsg(''); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal menyimpan'); }
  }

  function label(q: QuestionRow) {
    if (isProblematic(q)) return <Badge tone="danger">Perlu diisi</Badge>;
    if (!q.is_active) return <Badge tone="neutral">Nonaktif</Badge>;
    if (q.stimulus) return <Badge tone="brand">Ada pengantar</Badge>;
    if (hasArabic(q)) return <Badge tone="info">Teks Arab</Badge>;
    return <Badge tone="success">Aktif</Badge>;
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">Bank Soal</h1>
          <p className="whitespace-pre text-sm leading-5 text-soft">{rows.filter((r) => r.is_active).length} soal pilihan ganda{'  ·  '}Tes Kemampuan Dasar Akademik</p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setAdding({ ...emptyDraft(), options: ['A', 'B', 'C', 'D'].map((l) => ({ label: l as 'A', body: '' })) })}>Tambah Soal</Button>
          <Link href="/admin/import/" className="inline-flex items-center justify-center rounded-[10px] bg-brand-600 px-5 py-3 text-sm font-medium leading-5 text-white hover:bg-brand-700">Impor Soal</Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-3.5 md:w-[300px]">
          <Icon name="search-muted" size={16} />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Cari teks soal" className="min-w-0 flex-1 bg-transparent text-sm leading-5 text-ink outline-none placeholder:text-muted" />
        </label>
        <div className="flex gap-2 overflow-x-auto md:gap-3">
          {chips.map((c) => (
            <button key={c.id} onClick={() => { setFilter(c.id); setPage(0); }}
              className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium leading-5 ${filter === c.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-soft'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="rounded-[10px] bg-danger-50 p-3 text-sm text-danger-600">{msg}</p>}

      {adding && (
        <div className="rounded-xl border border-line bg-white p-5">
          <h2 className="mb-3 text-base font-semibold text-ink">Soal baru</h2>
          <QuestionEditor draft={adding} onChange={setAdding} />
          {adding.errors.map((e) => <p key={e} className="mt-2 text-sm text-danger-600">⚠ {e}</p>)}
          <div className="mt-3 flex gap-2"><Button onClick={saveNew}>Simpan</Button><Button variant="secondary" onClick={() => setAdding(null)}>Batal</Button></div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="hidden bg-subtle px-4 py-2.5 text-xs font-medium leading-4 text-muted md:grid md:grid-cols-[50px_minmax(0,1fr)_60px_60px_130px_230px] md:gap-3">
          <span>NO</span><span>TEKS SOAL</span><span>OPSI</span><span>KUNCI</span><span>KETERANGAN</span><span>AKSI</span>
        </div>
        {shown.map((q) => {
          const key = q.options.find((o) => o.id === q.answer_keys?.option_id);
          const img = questionImageUrl(q.image_path);
          const text = [q.stimulus?.split('\n')[0], q.body].filter(Boolean).join(' ');
          return (
            <div key={q.id} className={`border-b border-line last:border-b-0 ${q.is_active ? '' : 'opacity-70'}`}>
              <div className={`${cols} flex flex-col items-start gap-2 px-4 py-3`}>
                <span className="text-sm leading-5 text-ink">{q.position}</span>
                <p dir="auto" className="min-w-0 text-sm leading-5 text-ink md:truncate md:pr-2">{text}</p>
                <span className="text-sm leading-5 text-ink">{q.options.length || '-'}</span>
                <span className="text-sm leading-5 text-ink">{key?.label ?? '-'}</span>
                <div>{label(q)}</div>
                <div className="flex gap-3.5 text-sm font-medium leading-5">
                  <button className="text-brand-600" onClick={() => { setEditId(editId === q.id ? null : q.id); setDraft(rowToDraft(q)); }}>{editId === q.id ? 'Tutup' : 'Edit'}</button>
                  <button className="text-soft" onClick={async () => { await setQuestionActive(q.id, !q.is_active); await load(); }}>{q.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  <button className="text-danger-600" onClick={async () => { if (!confirm('Hapus soal ini?')) return; try { await deleteQuestion(q.id); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : ''); } }}>Hapus</button>
                </div>
              </div>
              {editId === q.id && draft && (
                <div className="border-t border-line bg-page px-4 py-4">
                  {/* pratinjau isi soal */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img && <img src={img} alt="" className="mb-2 max-h-40 rounded" />}
                  {q.stimulus && <div className="mb-3 rounded-xl bg-subtle p-3 text-sm"><RtlText text={q.stimulus} /></div>}
                  <QuestionEditor draft={draft} onChange={setDraft} />
                  {draft.errors.map((e) => <p key={e} className="mt-2 text-sm text-danger-600">⚠ {e}</p>)}
                  <div className="mt-3"><Button onClick={() => saveEdit(q)}>Simpan perubahan</Button></div>
                </div>
              )}
            </div>
          );
        })}
        {!shown.length && <p className="p-4 text-sm text-muted">Tidak ada soal yang cocok.</p>}
      </div>

      <div className="flex items-center gap-3">
        <p className="text-xs font-medium leading-4 text-muted">Menampilkan {shown.length} dari {matches.length} soal</p>
        <div className="flex-1" />
        <Button variant="secondary" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Sebelumnya</Button>
        <Button variant="secondary" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Berikutnya</Button>
      </div>
    </>
  );
}
