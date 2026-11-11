import { LABELS, emptyDraft, type DraftQuestion, type Label } from './types';

const COL: Record<string, string[]> = {
  no: ['no', 'nomor'],
  stimulus: ['pengantar', 'stimulus', 'teks pengantar', 'bacaan'],
  body: ['soal', 'pertanyaan', 'teks soal'],
  key: ['kunci', 'jawaban', 'kunci jawaban'],
};

function findCol(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(h));
}

/** Baris tabel (baris pertama = judul kolom) -> draf soal. Kolom: no, pengantar, soal, A..E, kunci. */
export function rowsToDrafts(rows: string[][]): DraftQuestion[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/^opsi\s+/, ''));
  const c = {
    no: findCol(header, COL.no),
    stimulus: findCol(header, COL.stimulus),
    body: findCol(header, COL.body),
    key: findCol(header, COL.key),
    opt: LABELS.map((l) => header.indexOf(l.toLowerCase())),
  };
  if (c.body < 0 || c.opt.some((i) => i < 0) && c.opt.filter((i) => i >= 0).length < 2 || c.key < 0) {
    throw new Error('KOLOM_TIDAK_LENGKAP');
  }
  const out: DraftQuestion[] = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').toString().trim() : '');
    if (!get(c.body) && c.opt.every((i) => !get(i))) continue; // baris kosong
    const d = emptyDraft();
    d.body = get(c.body);
    d.stimulus = get(c.stimulus) || null;
    const no = Number(get(c.no));
    if (c.no >= 0 && Number.isFinite(no) && no > 0) d.sourceNo = no;

    // opsi yang terisi diberi huruf ulang berurutan; kunci ikut dipetakan
    const remap = new Map<string, Label>();
    LABELS.forEach((orig, i) => {
      const text = get(c.opt[i]);
      if (c.opt[i] < 0 || !text) return;
      const label = LABELS[d.options.length];
      remap.set(orig, label);
      d.options.push({ label, body: text });
    });
    const k = get(c.key).toUpperCase().replace(/[^A-E]/g, '');
    d.answer = k.length === 1 ? remap.get(k) ?? null : null;
    if (k.length > 1) d.keyCandidates = k.split('').map((x) => remap.get(x)).filter((x): x is Label => !!x);
    out.push(d);
  }
  return out;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.result !== undefined) return String(o.result);
    if (o.text !== undefined) return String(o.text);
    return '';
  }
  return String(v);
}

export async function parseExcelBuffer(buf: ArrayBuffer): Promise<DraftQuestion[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('EXCEL_KOSONG');
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[]; // indeks 1-based
    rows.push(vals.slice(1).map(cellText));
  });
  return rowsToDrafts(rows);
}

export async function parseCsvText(text: string): Promise<DraftQuestion[]> {
  const Papa = (await import('papaparse')).default;
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true });
  return rowsToDrafts(res.data);
}

export async function parseExcel(file: File | Blob, name: string): Promise<DraftQuestion[]> {
  if (name.toLowerCase().endsWith('.csv')) return parseCsvText(await file.text());
  return parseExcelBuffer(await file.arrayBuffer());
}
