import { cellText } from './excel';

export type ParticipantInput = { fullName: string; participantNo: string };

const NAME_HEADERS = ['nama', 'nama peserta', 'nama lengkap'];
const NO_HEADERS = ['nomor pendaftaran', 'no pendaftaran', 'no. pendaftaran', 'nomor peserta', 'no peserta', 'no. peserta', 'nomor', 'no'];

/**
 * Baris tabel -> peserta. Bila baris pertama berisi judul kolom (Nama, Nomor Pendaftaran, ...) kolom dicari
 * lewat judul; bila tidak, kolom 1 = Nama dan kolom 2 = Nomor pendaftaran.
 */
export function rowsToParticipants(rows: string[][]): ParticipantInput[] {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameCol = header.findIndex((h) => NAME_HEADERS.includes(h));
  const noCol = header.findIndex((h) => NO_HEADERS.includes(h));
  const hasHeader = nameCol >= 0 && noCol >= 0;
  const [n, p] = hasHeader ? [nameCol, noCol] : [0, 1];
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((r) => ({ fullName: (r[n] ?? '').trim(), participantNo: (r[p] ?? '').trim() }))
    .filter((r) => r.fullName || r.participantNo);
}

export async function parseParticipantsExcel(file: File | Blob, name: string): Promise<ParticipantInput[]> {
  if (name.toLowerCase().endsWith('.csv')) {
    const Papa = (await import('papaparse')).default;
    const res = Papa.parse<string[]>((await file.text()).replace(/^﻿/, ''), { skipEmptyLines: true });
    return rowsToParticipants(res.data);
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('EXCEL_KOSONG');
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    rows.push((row.values as unknown[]).slice(1).map(cellText));
  });
  return rowsToParticipants(rows);
}
