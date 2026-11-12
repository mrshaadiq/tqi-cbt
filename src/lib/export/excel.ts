import type { ParticipantCredential } from '../credentials';

export type ResultRow = {
  rank: number; fullName: string; participantNo: string; score: number; correctCount: number;
  passed: boolean | null; eventCount: number;
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function newWorkbook() {
  const ExcelJS = (await import('exceljs')).default;
  return new ExcelJS.Workbook();
}

export async function exportAccountsXlsx(creds: ParticipantCredential[]): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Akun Peserta');
  ws.columns = [
    { header: 'Nama', key: 'n', width: 32 },
    { header: 'Nomor Peserta', key: 'no', width: 18 },
    { header: 'Username', key: 'u', width: 18 },
    { header: 'Password', key: 'p', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  creds.forEach((c) => ws.addRow({ n: c.fullName, no: c.participantNo, u: c.username, p: c.password }));
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX });
}

export async function exportParticipantTemplateXlsx(): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Peserta');
  ws.columns = [{ header: 'Nama', key: 'n', width: 32 }, { header: 'Nomor Pendaftaran', key: 'no', width: 22 }];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ n: 'Ahmad Fauzi', no: '2026-0147' });
  ws.addRow({ n: 'Siti Aisyah', no: '2026-0148' });
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX });
}

/** Urut: nilai turun, lalu nama. Kolom Ranking dihitung ulang (nilai sama = ranking sama). */
export async function exportResultsXlsx(rows: ResultRow[]): Promise<Blob> {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName));
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Hasil');
  ws.columns = [
    { header: 'Ranking', key: 'rank', width: 10 },
    { header: 'Nama', key: 'n', width: 32 },
    { header: 'Nomor Peserta', key: 'no', width: 18 },
    { header: 'Nilai', key: 's', width: 10 },
    { header: 'Jumlah Benar', key: 'c', width: 14 },
    { header: 'Status', key: 'p', width: 14 },
    { header: 'Kejadian', key: 'e', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  let lastScore: number | null = null;
  let lastRank = 0;
  sorted.forEach((r, i) => {
    const rank = r.score === lastScore ? lastRank : i + 1;
    lastScore = r.score;
    lastRank = rank;
    ws.addRow({
      rank, n: r.fullName, no: r.participantNo, s: r.score, c: r.correctCount,
      p: r.passed === null ? '' : r.passed ? 'Lulus' : 'Tidak lulus', e: r.eventCount,
    });
  });
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX });
}

export async function exportTemplateXlsx(): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Soal');
  ws.columns = ['no', 'pengantar', 'soal', 'A', 'B', 'C', 'D', 'E', 'kunci'].map((h, i) => ({ header: h, key: h, width: i === 1 || i === 2 ? 40 : 18 }));
  ws.getRow(1).font = { bold: true };
  ws.addRow([1, '', 'Ibu kota Indonesia adalah ....', 'Bandung', 'Jakarta', 'Medan', 'Surabaya', '', 'B']);
  ws.addRow([2, 'Bacalah pantun berikut! (teks pengantar boleh kosong)', 'Pantun di atas termasuk jenis ....', 'Sampiran', 'Isi', 'Syair', '', '', 'B']);
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
