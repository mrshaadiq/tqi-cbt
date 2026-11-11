import { parseDocx } from './docx';
import { parseExcel } from './excel';
import { parsePdf } from './pdf';
import { validateDrafts } from './validate';
import type { DraftQuestion } from './types';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_QUESTIONS = 200;

export function enforceLimits(drafts: DraftQuestion[]): DraftQuestion[] {
  if (drafts.length > MAX_QUESTIONS) throw new Error('TOO_MANY_QUESTIONS');
  return drafts;
}

export async function importFile(file: File): Promise<DraftQuestion[]> {
  if (file.size > MAX_BYTES) throw new Error('FILE_TOO_LARGE');
  const name = file.name.toLowerCase();
  let drafts: DraftQuestion[];
  if (name.endsWith('.docx')) drafts = await parseDocx(file);
  else if (name.endsWith('.xlsx') || name.endsWith('.csv')) drafts = await parseExcel(file, name);
  else if (name.endsWith('.pdf')) drafts = await parsePdf(file);
  else throw new Error('UNSUPPORTED_FILE');
  return validateDrafts(enforceLimits(drafts));
}

export const IMPORT_ERRORS: Record<string, string> = {
  FILE_TOO_LARGE: 'File lebih dari 10 MB. Pecah menjadi beberapa file.',
  TOO_MANY_QUESTIONS: 'Lebih dari 200 soal dalam satu file. Pecah menjadi beberapa file.',
  UNSUPPORTED_FILE: 'Format tidak didukung. Gunakan .docx, .xlsx, .csv, atau .pdf.',
  PDF_SCAN_NOT_SUPPORTED: 'PDF ini berupa gambar hasil scan dan tidak berisi teks. Gunakan file Word atau Excel.',
  DOCX_INVALID: 'File Word rusak atau bukan .docx yang valid.',
  DOCX_NO_NUMBERING: 'Tidak ada daftar bernomor di dokumen. Pakai fitur penomoran otomatis Word, atau gunakan Excel.',
  KOLOM_TIDAK_LENGKAP: 'Kolom Excel tidak lengkap. Unduh template dan pakai kolom: no, pengantar, soal, A, B, C, D, E, kunci.',
  EXCEL_KOSONG: 'File Excel tidak berisi sheet.',
};
