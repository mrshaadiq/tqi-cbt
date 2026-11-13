import { LABELS, SKALA_DEFAULT, emptyDraft, type DraftQuestion, type Label } from './types';
import { SECTION_RE, splitAccepted } from './docx';

const isLabel = (s: string): s is Label => (LABELS as string[]).includes(s);

/** Baris isian kosong: titik-titik, garis bawah, kotak centang. */
const BLANK_RE = /^[.\-_…·☐□\s]+$/;
/** "STS : Sangat Tidak Setuju | TS : ..." atau "1 = Sangat Tidak Sesuai 2 = ..." */
const LEGEND_RE = /(?:^|[\s|\-])(STS|TS|SS|S|[1-5])\s*[:=]\s*([A-Za-z][A-Za-z ]*?)\s*(?=\||$|\s(?:STS|TS|SS|S|[1-5])\s*[:=])/g;
/** Judul kolom tabel skala: "No Pernyataan STS TS S SS" / "No. Pernyataan 1 2 3 4" */
const SCALE_HEADER_RE = /^no\.?\s+pernyataan\b\s*(.*)$/i;
/** Judul bagian kuesioner berhuruf kapital: "A. KEINGINAN PRIBADI", "BAGIAN REFLEKSI" */
const CAPS_SECTION_RE = /^(?:([A-Z])\.\s+|(?:BAGIAN|SECTION|SESI)\s+)([A-Z][A-Z0-9 ,&/()\-]+)$/;
const DEFAULT_CODES: Record<string, string> = { STS: 'Sangat Tidak Setuju', TS: 'Tidak Setuju', S: 'Setuju', SS: 'Sangat Setuju' };

const SMALL_WORDS = new Set(['di', 'dan', 'dalam', 'terhadap', 'yang', 'ke', 'dari', 'atau', 'untuk']);
/** "PEMAHAMAN DAN PENERIMAAN DI TQI" -> "Pemahaman dan Penerimaan di TQI" (singkatan ≤3 huruf tetap kapital) */
const titleCase = (s: string) =>
  s.split(/\s+/).map((w, i) => {
    const low = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(low)) return low;
    if (w.length <= 3 && /^[A-Z]+$/.test(w) && !SMALL_WORDS.has(low)) return w;
    return low.replace(/(^|[(/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }).join(' ');

/**
 * Teks polos (dari PDF, atau Word tanpa daftar bernomor) -> draf soal.
 * Soal tes: nomor "1." atau "1)", opsi "A." atau "A)", kunci "Kunci: B" setelah soal,
 * atau blok "Kunci Jawaban" di akhir berisi "1. B" / "1-B" / "1 B".
 * Kuesioner: keterangan skala ("STS : Sangat Tidak Setuju | ..."), tabel "No Pernyataan STS TS S SS"
 * berisi baris "1 Pernyataan ..." -> soal skala; pertanyaan bernomor tanpa opsi dan tanpa kunci -> uraian.
 */
export function parseQuestionText(text: string): DraftQuestion[] {
  const drafts: DraftQuestion[] = [];
  const keyMap = new Map<number, Label>();
  const keyTextMap = new Map<number, string>();
  let cur: DraftQuestion | null = null;
  let inKeyBlock = false;
  let section = 'Umum';
  let hasKeys = false;
  let questionnaire = false;
  const legend = new Map<string, string>();
  let scale: string[] | null = null; // pilihan skala aktif (urutan = skor 1..n)

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || BLANK_RE.test(line)) continue;

    if (/^kunci( jawaban)?\s*:?\s*$/i.test(line)) {
      inKeyBlock = true;
      hasKeys = true;
      continue;
    }
    if (inKeyBlock) {
      for (const m of line.matchAll(/(\d{1,3})\s*[.\-:)]*\s*([A-Ea-e])(?![A-Za-z])/g)) {
        keyMap.set(Number(m[1]), m[2].toUpperCase() as Label);
      }
      const one = line.match(/^(\d{1,3})\s*[.\-:)]+\s*(.+)$/);
      if (one) keyTextMap.set(Number(one[1]), one[2].trim());
      continue;
    }

    // keterangan skala
    const pairs = [...line.matchAll(LEGEND_RE)];
    if (pairs.length >= 2) {
      for (const m of pairs) legend.set(m[1].toUpperCase(), m[2].trim());
      questionnaire = true;
      continue;
    }

    const header = line.match(SCALE_HEADER_RE);
    if (header) {
      const codes = header[1].split(/\s+/).filter(Boolean);
      scale = codes.length >= 2
        ? codes.map((c, i) => legend.get(c.toUpperCase()) ?? DEFAULT_CODES[c.toUpperCase()] ?? SKALA_DEFAULT[i] ?? c)
        : SKALA_DEFAULT;
      questionnaire = true;
      cur = null;
      continue;
    }
    if (/^nilai maksimal/i.test(line)) continue;

    const sec = line.match(SECTION_RE);
    const caps = questionnaire ? line.match(CAPS_SECTION_RE) : null;
    if (sec || caps) {
      section = sec ? sec[1].trim() : (caps![1] ? `${caps![1]}. ` : '') + titleCase(caps![2].trim());
      cur = null;
      scale = null;
      continue;
    }

    const key = line.match(/^(?:kunci|jawaban)\s*[:=]\s*(.+)$/i);
    if (key && cur) {
      hasKeys = true;
      const v = key[1].trim();
      if (cur.options.length && /^[A-Ea-e]$/.test(v)) cur.answer = v.toUpperCase() as Label;
      else if (!cur.options.length) cur.accepted = splitAccepted(v);
      continue;
    }

    // baris tabel skala: "12 Saya siap ..."
    const row = scale ? line.match(/^(\d{1,3})\s+(?![.)])(.+)$/) : null;
    if (row && scale) {
      cur = {
        ...emptyDraft(), section, type: 'skala', body: row[2].trim(), sourceNo: Number(row[1]),
        options: scale.map((body, i) => ({ label: LABELS[i], body })), reverse: false,
      };
      drafts.push(cur);
      continue;
    }

    const opt = line.match(/^([A-Ea-e])\s*[.)]\s*(.*)$/);
    if (opt && cur && cur.type !== 'skala') {
      const label = opt[1].toUpperCase();
      if (isLabel(label)) {
        cur.options.push({ label, body: opt[2].trim() });
        continue;
      }
    }

    const qm = line.match(/^(\d{1,3})\s*[.)]\s+(.*)$/);
    if (qm) {
      cur = { ...emptyDraft(), section, body: qm[2].trim(), sourceNo: Number(qm[1]) };
      drafts.push(cur);
      continue;
    }

    // baris lanjutan: ke opsi terakhir bila sudah ada opsi (bukan skala), kalau belum ke teks soal
    if (cur) {
      const text = line.replace(/[._…]{4,}\s*$/, '').trim();
      if (!text) continue;
      if (cur.options.length && cur.type !== 'skala') {
        const last = cur.options[cur.options.length - 1];
        last.body = (last.body + ' ' + text).trim();
      } else {
        cur.body = (cur.body + (cur.type === 'skala' ? ' ' : '\n') + text).trim();
      }
    }
  }

  for (const d of drafts) {
    if (d.type === 'skala') {
      d.notes.push('skala: periksa apakah pernyataan ini negatif (skor dibalik)');
      continue;
    }
    if (!d.options.length) {
      if (!d.accepted?.length && d.sourceNo !== undefined && keyTextMap.has(d.sourceNo)) {
        d.accepted = splitAccepted(keyTextMap.get(d.sourceNo));
      }
      // kuesioner tanpa kunci sama sekali: pertanyaan terbuka = uraian
      d.type = questionnaire && !hasKeys && !d.accepted?.length ? 'uraian' : 'isian';
      continue;
    }
    if (d.answer === null && d.sourceNo !== undefined && keyMap.has(d.sourceNo)) d.answer = keyMap.get(d.sourceNo)!;
  }
  return drafts;
}
