import { LABELS, emptyDraft, type DraftQuestion, type Label } from './types';

const isLabel = (s: string): s is Label => (LABELS as string[]).includes(s);

/**
 * Teks polos (dari PDF) -> draf soal.
 * Nomor "1." atau "1)", opsi "A." atau "A)", kunci "Kunci: B" setelah soal,
 * atau blok "Kunci Jawaban" di akhir berisi "1. B" / "1-B" / "1 B".
 */
export function parseQuestionText(text: string): DraftQuestion[] {
  const drafts: DraftQuestion[] = [];
  const keyMap = new Map<number, Label>();
  let cur: DraftQuestion | null = null;
  let inKeyBlock = false;

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (/^kunci( jawaban)?\s*:?\s*$/i.test(line)) {
      inKeyBlock = true;
      continue;
    }
    if (inKeyBlock) {
      for (const m of line.matchAll(/(\d{1,3})\s*[.\-:)]*\s*([A-Ea-e])(?![A-Za-z])/g)) {
        keyMap.set(Number(m[1]), m[2].toUpperCase() as Label);
      }
      continue;
    }

    const key = line.match(/^(?:kunci|jawaban)\s*[:=]\s*([A-Ea-e])\b/i);
    if (key && cur) {
      cur.answer = key[1].toUpperCase() as Label;
      continue;
    }

    const opt = line.match(/^([A-Ea-e])\s*[.)]\s*(.*)$/);
    if (opt && cur) {
      const label = opt[1].toUpperCase();
      if (isLabel(label)) {
        cur.options.push({ label, body: opt[2].trim() });
        continue;
      }
    }

    const qm = line.match(/^(\d{1,3})\s*[.)]\s+(.*)$/);
    if (qm) {
      cur = { ...emptyDraft(), body: qm[2].trim(), sourceNo: Number(qm[1]) };
      drafts.push(cur);
      continue;
    }

    // baris lanjutan: ke opsi terakhir bila sudah ada opsi, kalau belum ke teks soal
    if (cur) {
      if (cur.options.length) {
        const last = cur.options[cur.options.length - 1];
        last.body = (last.body + ' ' + line).trim();
      } else {
        cur.body = (cur.body + '\n' + line).trim();
      }
    }
  }

  for (const d of drafts) {
    if (d.answer === null && d.sourceNo !== undefined && keyMap.has(d.sourceNo)) d.answer = keyMap.get(d.sourceNo)!;
  }
  return drafts;
}
