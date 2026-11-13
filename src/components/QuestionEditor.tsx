'use client';
import { useId } from 'react';
import { LABELS, SKALA_DEFAULT, type DraftQuestion, type QuestionType } from '@/lib/import/types';
import { inputCls } from '@/components/ui';

/** Editor satu soal: teks pengantar, pertanyaan, 2-5 opsi, dan kunci. Dipakai di pratinjau impor dan bank soal. */
export default function QuestionEditor({ draft, onChange }: { draft: DraftQuestion; onChange: (d: DraftQuestion) => void }) {
  const gid = useId();
  const set = (patch: Partial<DraftQuestion>) => onChange({ ...draft, ...patch });

  function setOption(i: number, body: string) {
    set({ options: draft.options.map((o, j) => (j === i ? { ...o, body } : o)) });
  }
  function addOption() {
    if (draft.options.length >= 5) return;
    set({ options: [...draft.options, { label: LABELS[draft.options.length], body: '' }] });
  }
  function removeOption(i: number) {
    const removed = draft.options[i].label;
    const rest = draft.options.filter((_, j) => j !== i).map((o, j) => ({ ...o, label: LABELS[j] }));
    // kunci dipetakan ulang mengikuti huruf baru; bila yang dihapus adalah kunci, kosongkan
    let answer = draft.answer;
    if (answer === removed) answer = null;
    else if (answer) {
      const old = draft.options.findIndex((o) => o.label === answer);
      answer = LABELS[old > i ? old - 1 : old];
    }
    set({ options: rest, answer, keyCandidates: undefined });
  }

  const isian = draft.type === 'isian';

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row">
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-semibold text-stone-500">Bagian / section</span>
          <input dir="auto" className={inputCls} value={draft.section ?? 'Umum'} onChange={(e) => set({ section: e.target.value })} />
        </label>
        <label className="block md:w-56">
          <span className="mb-1 block text-xs font-semibold text-stone-500">Jenis soal</span>
          <select
            className={inputCls}
            value={draft.type ?? 'pg'}
            onChange={(e) => {
              const t = e.target.value as QuestionType;
              if (t === 'isian') set({ type: 'isian', accepted: draft.accepted ?? [] });
              else if (t === 'uraian') set({ type: 'uraian' });
              else if (t === 'skala') set({ type: 'skala', options: SKALA_DEFAULT.map((body, i) => ({ label: LABELS[i], body })) });
              else set({ type: 'pg', options: draft.options.length ? draft.options : LABELS.slice(0, 4).map((l) => ({ label: l, body: '' })) });
            }}
          >
            <option value="pg">Pilihan ganda (dinilai)</option>
            <option value="isian">Isian singkat (dinilai)</option>
            <option value="skala">Skala 1–4 (kuesioner)</option>
            <option value="uraian">Uraian (kuesioner)</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500">Teks pengantar (opsional)</span>
        <textarea dir="auto" rows={2} className={inputCls} value={draft.stimulus ?? ''} onChange={(e) => set({ stimulus: e.target.value || null })} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500">Pertanyaan</span>
        <textarea dir="auto" rows={2} className={inputCls} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
      </label>
      {draft.type === 'uraian' ? (
        <p className="rounded-[10px] bg-subtle p-3 text-xs text-soft">Peserta menulis jawaban bebas (maks 5000 karakter). Tidak ada kunci dan tidak ikut nilai; jawaban dibaca panitia di halaman Detail peserta.</p>
      ) : draft.type === 'skala' ? (
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-stone-500">Pilihan skala (urutan = skor: pilihan pertama 1, berikutnya 2, dst.). Tidak ikut nilai total.</span>
          {draft.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-sm font-bold">{i + 1}</span>
              <input dir="auto" className={inputCls} value={o.body} onChange={(e) => setOption(i, e.target.value)} />
              <button type="button" onClick={() => removeOption(i)} className="px-2 text-stone-400 hover:text-danger-600" aria-label={`Hapus pilihan ${i + 1}`}>✕</button>
            </div>
          ))}
          {draft.options.length < 5 && (
            <button type="button" onClick={addOption} className="text-sm font-semibold text-brand-700">+ Tambah pilihan</button>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={!!draft.reverse} onChange={(e) => set({ reverse: e.target.checked })} className="h-4 w-4 accent-[#D9480F]" />
            Pernyataan negatif: skor dibalik (pilihan pertama = skor tertinggi)
          </label>
        </div>
      ) : isian ? (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-stone-500">
            Kunci jawaban (pisahkan dengan | bila ada beberapa jawaban yang diterima; huruf besar/kecil, spasi, dan tanda baca diabaikan)
          </span>
          <input
            dir="auto"
            className={inputCls}
            value={(draft.accepted ?? []).join(' | ')}
            onChange={(e) => set({ accepted: e.target.value.split('|').map((x) => x.trim()) })}
            placeholder="contoh: 36 | tiga puluh enam"
          />
        </label>
      ) : (
      <div className="space-y-2">
        <span className="block text-xs font-semibold text-stone-500">Opsi (pilih lingkaran untuk menandai kunci)</span>
        {draft.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="radio" name={gid} aria-label={`Kunci ${o.label}`} checked={draft.answer === o.label}
              onChange={() => set({ answer: o.label, keyCandidates: undefined })} className="h-4 w-4 accent-[#D9480F]" />
            <span className="w-5 text-sm font-bold">{o.label}</span>
            <input dir="auto" className={inputCls} value={o.body} onChange={(e) => setOption(i, e.target.value)} />
            <button type="button" onClick={() => removeOption(i)} className="px-2 text-stone-400 hover:text-danger-600" aria-label={`Hapus opsi ${o.label}`}>✕</button>
          </div>
        ))}
        {draft.options.length < 5 && (
          <button type="button" onClick={addOption} className="text-sm font-semibold text-brand-700">+ Tambah opsi</button>
        )}
      </div>
      )}
    </div>
  );
}
