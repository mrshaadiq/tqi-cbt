'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { clearBank, deleteQuestion, isProblematic, listQuestions, moveQuestions, renameSection, reorderSections, rowToDraft, saveQuestions, sectionOrder, setQuestionActive, updateQuestion, type QuestionRow } from '@/lib/adminApi';
import { validateDrafts } from '@/lib/import/validate';
import { emptyDraft, type DraftQuestion } from '@/lib/import/types';
import { isMostlyArabic } from '@/lib/text';
import { questionImageUrl } from '@/lib/supabase';
import QuestionEditor from '@/components/QuestionEditor';
import RtlText from '@/components/RtlText';
import { Badge, Button, Icon, Spinner } from '@/components/ui';

type Filter = 'semua' | 'isian' | 'arab' | 'pengantar' | 'gambar' | 'nonaktif' | 'bermasalah';
const PAGE = 8;
const ALL = '__semua__';
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
  const [section, setSection] = useState<string>(ALL);
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listQuestions().then(setRows).catch((e) => setMsg(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const sections = useMemo(() => {
    const base = sectionOrder(rows ?? []);
    return [...base, ...extraSections.filter((x) => !base.includes(x))];
  }, [rows, extraSections]);

  const matches = useMemo(() => (rows ?? []).filter((q) => {
    if (section !== ALL && q.section !== section) return false;
    if (filter === 'arab' && !hasArabic(q)) return false;
    if (filter === 'pengantar' && !q.stimulus) return false;
    if (filter === 'gambar' && !q.image_path && !q.options.some((o) => o.image_path)) return false;
    if (filter === 'nonaktif' && q.is_active) return false;
    if (filter === 'isian' && q.type !== 'isian') return false;
    if (filter === 'bermasalah' && !isProblematic(q)) return false;
    return !search || (q.section + ' ' + q.body + ' ' + (q.stimulus ?? '')).toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search, section]);

  if (!rows) return msg ? <p className="text-danger-600">{msg}</p> : <Spinner />;

  const pages = Math.max(1, Math.ceil(matches.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = matches.slice(cur * PAGE, cur * PAGE + PAGE);
  const problematic = rows.filter(isProblematic).length;
  const chips: { id: Filter; label: string }[] = [
    { id: 'semua', label: `Semua (${rows.length})` },
    { id: 'isian', label: `Isian (${rows.filter((r) => r.type === 'isian').length})` },
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

  async function deleteAll() {
    if (!rows!.length) return;
    if (!confirm(`Hapus SEMUA ${rows!.length} soal? Soal yang sudah dipakai ujian hanya akan dinonaktifkan. Tindakan ini tidak bisa dibatalkan.`)) return;
    try { await clearBank(); setEditId(null); setPage(0); setMsg(''); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal menghapus soal'); }
  }

  const pick = (s: string) => { setSection(s); setPage(0); setSelected(new Set()); setEditId(null); };

  function newSection() {
    const name = prompt('Nama bagian baru, mis. "Matematika" atau "Bahasa Arab":')?.trim();
    if (!name) return;
    if (!sections.includes(name)) setExtraSections((x) => [...x, name]);
    pick(name);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); setMsg(''); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); }
    finally { setBusy(false); }
  }

  async function rename() {
    const name = prompt(`Ganti nama bagian "${section}" menjadi:`, section)?.trim();
    if (!name || name === section) return;
    if (sections.includes(name) && !confirm(`Bagian "${name}" sudah ada. Gabungkan soal "${section}" ke dalamnya?`)) return;
    await run(() => renameSection(section, name));
    setExtraSections((x) => x.map((v) => (v === section ? name : v)));
    pick(name);
  }

  async function shift(dir: -1 | 1) {
    const i = sections.indexOf(section);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    const order = [...sections];
    [order[i], order[j]] = [order[j], order[i]];
    await run(() => reorderSections(rows!, order));
  }

  async function moveSelected() {
    const target = moveTo === '__baru__' ? prompt('Nama bagian tujuan:')?.trim() : moveTo;
    if (!target) return;
    await run(() => moveQuestions([...selected], target));
    setSelected(new Set());
    setMoveTo('');
  }

  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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
          <p className="whitespace-pre text-sm leading-5 text-soft">{(() => {
            const act = rows.filter((r) => r.is_active);
            const isian = act.filter((r) => r.type === 'isian').length;
            const secs = new Set(act.map((r) => r.section)).size;
            return `${act.length} soal aktif (${act.length - isian} pilihan ganda, ${isian} isian)  ·  ${secs} bagian`;
          })()}</p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-3">
          <button disabled={!rows.length} onClick={deleteAll} className="inline-flex items-center justify-center rounded-[10px] border border-danger-600 bg-white px-5 py-3 text-sm font-medium leading-5 text-danger-600 hover:bg-danger-50 disabled:opacity-50">Hapus Semua</button>
          <Button variant="secondary" onClick={() => setAdding({ ...emptyDraft(), section: section === ALL ? 'Umum' : section, options: ['A', 'B', 'C', 'D'].map((l) => ({ label: l as 'A', body: '' })) })}>Tambah Soal</Button>
          <Link href="/admin/import/" className="inline-flex items-center justify-center rounded-[10px] bg-brand-600 px-5 py-3 text-sm font-medium leading-5 text-white hover:bg-brand-700">Impor Soal</Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold leading-5 text-ink">Bagian ujian</h2>
          <span className="text-xs leading-4 text-muted">Urutan di sini = urutan bagian saat ujian. Soal diacak di dalam bagiannya.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => pick(ALL)}
            className={`rounded-[10px] border px-3.5 py-2 text-left text-sm font-medium leading-5 ${section === ALL ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-soft'}`}>
            Semua bagian <span className="opacity-75">({rows.length})</span>
          </button>
          {sections.map((s, i) => {
            const list = rows.filter((r) => r.section === s);
            const act = list.filter((r) => r.is_active);
            const isian = act.filter((r) => r.type === 'isian').length;
            return (
              <button key={s} onClick={() => pick(s)}
                className={`flex flex-col rounded-[10px] border px-3.5 py-2 text-left ${section === s ? 'border-brand-600 bg-brand-50' : 'border-line bg-white'}`}>
                <span className="text-sm font-semibold leading-5 text-ink">{i + 1}. {s}</span>
                <span className="text-xs leading-4 text-muted">{list.length ? `${act.length} aktif · ${act.length - isian} PG, ${isian} isian` : 'belum ada soal'}</span>
              </button>
            );
          })}
          <button onClick={newSection} className="rounded-[10px] border border-dashed border-brand-600 px-3.5 py-2 text-sm font-medium leading-5 text-brand-600">+ Bagian baru</button>
        </div>
        {section !== ALL && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-sm font-medium leading-5">
            <span className="text-ink">Bagian &quot;{section}&quot;</span>
            <div className="flex-1" />
            <button className="text-soft disabled:opacity-40" disabled={busy || sections.indexOf(section) <= 0} onClick={() => shift(-1)}>↑ Naikkan</button>
            <button className="text-soft disabled:opacity-40" disabled={busy || sections.indexOf(section) >= sections.length - 1} onClick={() => shift(1)}>↓ Turunkan</button>
            <button className="text-brand-600 disabled:opacity-40" disabled={busy || !rows.some((r) => r.section === section)} onClick={rename}>Ganti nama</button>
            <Button variant="secondary" onClick={() => setAdding({ ...emptyDraft(), section, options: ['A', 'B', 'C', 'D'].map((l) => ({ label: l as 'A', body: '' })) })}>+ Soal di bagian ini</Button>
            <Link href={`/admin/import/?bagian=${encodeURIComponent(section)}`} className="text-brand-600">Impor ke bagian ini</Link>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-brand-600 bg-brand-50 px-4 py-3 text-sm">
          <span className="font-medium text-ink">{selected.size} soal dipilih</span>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="rounded-[10px] border border-line bg-white px-3 py-2">
            <option value="">Pindahkan ke bagian…</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__baru__">+ Bagian baru…</option>
          </select>
          <Button disabled={!moveTo || busy} onClick={moveSelected}>Pindahkan</Button>
          <button className="text-soft" onClick={() => setSelected(new Set())}>Batal pilih</button>
        </div>
      )}

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
                <label className="flex items-center gap-1.5 text-sm leading-5 text-ink">
                  <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggle(q.id)} aria-label={`Pilih soal ${q.position}`} className="h-4 w-4 accent-[#D9480F]" />
                  {q.position}
                </label>
                <p dir="auto" className="min-w-0 text-sm leading-5 text-ink md:truncate md:pr-2">
                  <span className="mr-1.5 rounded bg-subtle px-1.5 py-0.5 text-xs font-medium text-soft">{q.section}</span>{text}
                </p>
                <span className="text-sm leading-5 text-ink">{q.type === 'isian' ? 'Isian' : q.options.length || '-'}</span>
                <span className="truncate text-sm leading-5 text-ink" title={q.answer_keys?.accepted?.join(' | ')}>
                  {q.type === 'isian' ? q.answer_keys?.accepted?.[0] ?? '-' : key?.label ?? '-'}
                </span>
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
        <button className="text-xs font-medium text-brand-600" onClick={() => setSelected(new Set(matches.map((q) => q.id)))}>Pilih semua {matches.length} soal di daftar ini</button>
        <div className="flex-1" />
        <Button variant="secondary" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Sebelumnya</Button>
        <Button variant="secondary" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Berikutnya</Button>
      </div>
    </>
  );
}
