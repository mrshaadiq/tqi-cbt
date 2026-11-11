export type Label = 'A' | 'B' | 'C' | 'D' | 'E';
export const LABELS: Label[] = ['A', 'B', 'C', 'D', 'E'];

export type DraftOption = { label: Label; body: string; image?: Blob };

export type DraftQuestion = {
  stimulus: string | null;
  body: string;
  options: DraftOption[];
  answer: Label | null;
  /** huruf-huruf opsi bertanda merah bila lebih dari satu (diisi parser Word) */
  keyCandidates?: Label[];
  image?: Blob;
  /** nomor soal di file sumber (dipakai untuk mendeteksi nomor loncat) */
  sourceNo?: number;
  errors: string[]; // diisi validateDrafts, jangan diisi manual
  notes: string[]; // catatan non-blokir
};

export const RUMUS = '[RUMUS]';

export function emptyDraft(): DraftQuestion {
  return { stimulus: null, body: '', options: [], answer: null, errors: [], notes: [] };
}
