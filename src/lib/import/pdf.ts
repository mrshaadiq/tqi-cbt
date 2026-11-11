import type { DraftQuestion } from './types';
import { parseQuestionText } from './textFormat';

type Item = { str: string; x: number; y: number };

/** Gabungkan potongan teks PDF menjadi baris: kelompokkan per koordinat y, urut x. */
export function itemsToLines(items: Item[], tolerance = 2): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; parts: Item[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tolerance) last.parts.push(it);
    else lines.push({ y: it.y, parts: [it] });
  }
  return lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim());
}

export async function parsePdf(file: File | Blob): Promise<DraftQuestion[]> {
  const pdfjs = await import('pdfjs-dist');
  // worker disalin ke public/ oleh skrip "postinstall" (lihat panduan)
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const all: string[] = [];
  let chars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = content.items
      .filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i)
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
    chars += items.reduce((n, i) => n + i.str.trim().length, 0);
    all.push(...itemsToLines(items));
  }
  if (chars < 20) throw new Error('PDF_SCAN_NOT_SUPPORTED');
  return parseQuestionText(all.join('\n'));
}
