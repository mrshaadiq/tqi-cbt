'use client';
import { useId } from 'react';
import { LABELS, type DraftQuestion } from '@/lib/import/types';
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

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500">Teks pengantar (opsional)</span>
        <textarea dir="auto" rows={2} className={inputCls} value={draft.stimulus ?? ''} onChange={(e) => set({ stimulus: e.target.value || null })} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-stone-500">Pertanyaan</span>
        <textarea dir="auto" rows={2} className={inputCls} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
      </label>
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
    </div>
  );
}
