import type { ParticipantCredential } from '../credentials';

export type ResultRow = {
  rank: number; fullName: string; participantNo: string; score: number; correctCount: number;
  passed: boolean | null; eventCount: number;
  /** nilai per bagian (urutan sama untuk semua peserta) */
  sections?: { name: string; score: number }[];
  /** skor kuesioner skala per bagian */
  scales?: { name: string; score: number; max: number }[];
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

/** Jawaban lengkap satu peserta (dari admin_attempt_detail) untuk sheet rincian. */
export type ParticipantDetail = {
  fullName: string; participantNo: string;
  answers: { position: number; section: string; type: 'pg' | 'isian' | 'skala' | 'uraian'; question: string; chosen: string | null; weight: number | null; reverse: boolean; is_correct: boolean | null }[];
  events: { type: string; created_at: string }[];
};

const EVENT_LABEL: Record<string, string> = { tab_hidden: 'Pindah tab atau aplikasi', camera_lost: 'Kamera mati', offline: 'Koneksi terputus' };
const FILL = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const wib = (s: string) => new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'medium' });

/** Daftar soal unik (urut posisi) dari semua peserta untuk tipe tertentu. */
function questionsOf(details: ParticipantDetail[], types: string[]) {
  const m = new Map<number, ParticipantDetail['answers'][number]>();
  details.forEach((d) => d.answers.forEach((a) => { if (types.includes(a.type) && !m.has(a.position)) m.set(a.position, a); }));
  return [...m.values()].sort((a, b) => a.position - b.position);
}

type Workbook = Awaited<ReturnType<typeof newWorkbook>>;

function addDetailSheets(wb: Workbook, details: ParticipantDetail[]) {
  const people = [...details].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const find = (d: ParticipantDetail, pos: number) => d.answers.find((a) => a.position === pos);

  // Jawaban soal bernilai (pg, isian): hijau benar, merah salah, abu-abu kosong
  const graded = questionsOf(details, ['pg', 'isian']);
  if (graded.length) {
    const ws = wb.addWorksheet('Jawaban Soal');
    ws.columns = [{ header: 'Nama', width: 28 }, { header: 'Nomor Peserta', width: 16 }, ...graded.map((q) => ({ header: `No ${q.position}`, width: 8 }))];
    ws.getRow(1).font = { bold: true };
    people.forEach((d) => {
      const row = ws.addRow([d.fullName, d.participantNo, ...graded.map((q) => find(d, q.position)?.chosen ?? '')]);
      graded.forEach((q, i) => {
        const a = find(d, q.position);
        row.getCell(i + 3).fill = FILL(!a?.chosen ? 'FFE5E7EB' : a.is_correct ? 'FFC6EFCE' : 'FFFFC7CE');
      });
    });
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  }

  // Kuesioner skala: skor per pernyataan (sudah dibalik untuk pernyataan negatif) + total per bagian
  const scale = questionsOf(details, ['skala']);
  if (scale.length) {
    const sections = [...new Set(scale.map((q) => q.section))];
    const ws = wb.addWorksheet('Kuesioner Skala');
    ws.columns = [
      { header: 'Nama', width: 28 }, { header: 'Nomor Peserta', width: 16 },
      ...scale.map((q) => ({ header: `No ${q.position}${q.reverse ? '*' : ''}`, width: 8 })),
      ...sections.map((s) => ({ header: `Total ${s}`, width: 18 })),
    ];
    ws.getRow(1).font = { bold: true };
    people.forEach((d) => {
      const w = scale.map((q) => find(d, q.position)?.weight ?? null);
      const totals = sections.map((s) => scale.reduce((t, q, i) => t + (q.section === s ? w[i] ?? 0 : 0), 0));
      const row = ws.addRow([d.fullName, d.participantNo, ...w.map((v) => v ?? ''), ...totals]);
      w.forEach((v, i) => { if (v === null) row.getCell(i + 3).fill = FILL('FFE5E7EB'); });
    });
    ws.addRow([]);
    ws.addRow(['Isi sel = skor pilihan peserta (pilihan pertama 1, berikutnya 2, dst.). * = pernyataan negatif, skor sudah dibalik. Sel abu-abu = tidak diisi. Teks pernyataan ada di sheet "Keterangan Skala".']);
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    // keterangan per pernyataan: teks, dibalik, rata-rata, sebaran skor
    const maxW = Math.max(1, ...details.flatMap((d) => d.answers.filter((a) => a.type === 'skala').map((a) => a.weight ?? 0)));
    const ks = wb.addWorksheet('Keterangan Skala');
    ks.columns = [
      { header: 'No', width: 6 }, { header: 'Bagian', width: 24 }, { header: 'Pernyataan', width: 60 }, { header: 'Dibalik', width: 9 },
      { header: 'Rata-rata Skor', width: 14 }, { header: 'Terisi', width: 8 },
      ...Array.from({ length: maxW }, (_, i) => ({ header: `Skor ${i + 1}`, width: 9 })),
    ];
    ks.getRow(1).font = { bold: true };
    scale.forEach((q) => {
      const ws_ = details.map((d) => find(d, q.position)?.weight).filter((v): v is number => v != null);
      const avg = ws_.length ? Math.round((ws_.reduce((a, b) => a + b, 0) / ws_.length) * 100) / 100 : '';
      const row = ks.addRow([q.position, q.section, q.question, q.reverse ? 'Ya' : '', avg, ws_.length,
        ...Array.from({ length: maxW }, (_, i) => ws_.filter((v) => v === i + 1).length)]);
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    });
  }

  // Refleksi / uraian: jawaban teks lengkap
  const essays = questionsOf(details, ['uraian']);
  if (essays.length) {
    const ws = wb.addWorksheet('Refleksi (Uraian)');
    ws.columns = [{ header: 'Nama', width: 28 }, { header: 'Nomor Peserta', width: 16 }, ...essays.map((q) => ({ header: `${q.position}. ${q.question}`, width: 50 }))];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'top' };
    people.forEach((d) => {
      const row = ws.addRow([d.fullName, d.participantNo, ...essays.map((q) => find(d, q.position)?.chosen ?? '')]);
      row.alignment = { wrapText: true, vertical: 'top' };
    });
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  }

  // Log kejadian
  const ev = wb.addWorksheet('Log Kejadian');
  ev.columns = [{ header: 'Nama', width: 28 }, { header: 'Nomor Peserta', width: 16 }, { header: 'Waktu (WIB)', width: 22 }, { header: 'Kejadian', width: 26 }];
  ev.getRow(1).font = { bold: true };
  people.forEach((d) => [...d.events].sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((e) => ev.addRow([d.fullName, d.participantNo, wib(e.created_at), EVENT_LABEL[e.type] ?? e.type])));
}

/** Urut: nilai turun, lalu nama. Kolom Ranking dihitung ulang (nilai sama = ranking sama).
 *  Bila `details` diberikan, ditambah sheet rincian: jawaban soal, kuesioner skala, refleksi, log kejadian. */
export async function exportResultsXlsx(rows: ResultRow[], details?: ParticipantDetail[]): Promise<Blob> {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName));
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Hasil');
  const sectionNames = [...new Set(rows.flatMap((r) => (r.sections ?? []).map((s) => s.name)))];
  if (sectionNames.length < 2) sectionNames.length = 0; // satu bagian saja: cukup kolom Nilai
  const scaleNames = [...new Set(rows.flatMap((r) => (r.scales ?? []).map((s) => s.name)))];
  const scaleMax = scaleNames.map((n) => Math.max(0, ...rows.flatMap((r) => (r.scales ?? []).filter((s) => s.name === n).map((s) => s.max))));
  ws.columns = [
    { header: 'Ranking', key: 'rank', width: 10 },
    { header: 'Nama', key: 'n', width: 32 },
    { header: 'Nomor Peserta', key: 'no', width: 18 },
    { header: 'Nilai', key: 's', width: 10 },
    ...sectionNames.map((n, i) => ({ header: `Nilai ${n}`, key: `sec${i}`, width: 16 })),
    { header: 'Jumlah Benar', key: 'c', width: 14 },
    ...scaleNames.map((n, i) => ({ header: `${n} (maks ${scaleMax[i]})`, key: `sk${i}`, width: 18 })),
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
      ...Object.fromEntries(scaleNames.map((n, j) => [`sk${j}`, r.scales?.find((s) => s.name === n)?.score ?? ''])),
      ...Object.fromEntries(sectionNames.map((n, j) => [`sec${j}`, r.sections?.find((s) => s.name === n)?.score ?? ''])),
      rank, n: r.fullName, no: r.participantNo, s: r.score, c: r.correctCount,
      p: r.passed === null ? '' : r.passed ? 'Lulus' : 'Tidak lulus', e: r.eventCount,
    });
  });
  if (details?.length) addDetailSheets(wb, details);
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX });
}

export async function exportTemplateXlsx(): Promise<Blob> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet('Soal');
  ws.columns = ['no', 'bagian', 'tipe', 'pengantar', 'soal', 'A', 'B', 'C', 'D', 'E', 'kunci', 'dibalik'].map((h, i) => ({ header: h, key: h, width: i === 3 || i === 4 ? 40 : 16 }));
  ws.getRow(1).font = { bold: true };
  ws.addRow([1, 'Pengetahuan Umum', 'pg', '', 'Ibu kota Indonesia adalah ....', 'Bandung', 'Jakarta', 'Medan', 'Surabaya', '', 'B']);
  ws.addRow([2, 'Bahasa', 'pg', 'Bacalah pantun berikut! (teks pengantar boleh kosong)', 'Pantun di atas termasuk jenis ....', 'Sampiran', 'Isi', 'Syair', '', '', 'B']);
  ws.addRow([3, 'Matematika', 'isian', '', '12 x 3 = ....', '', '', '', '', '', '36 | tiga puluh enam']);
  // kuesioner (tidak ikut nilai): skala tanpa opsi = 4 pilihan Sangat Tidak Sesuai..Sangat Sesuai (skor 1-4)
  ws.addRow([4, 'A. Keinginan Pribadi', 'skala', '', 'Saya sendiri ingin menjadi santri TQI.', '', '', '', '', '', '', '']);
  ws.addRow([5, 'A. Keinginan Pribadi', 'skala', '', 'Saya mengikuti seleksi karena orang tua menginginkannya.', '', '', '', '', '', '', 'ya']);
  ws.addRow([6, 'Refleksi', 'uraian', '', 'Apa alasan paling utama yang membuatmu ingin menjadi santri TQI?', '', '', '', '', '', '', '']);
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
