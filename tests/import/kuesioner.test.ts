// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseDocxBuffer } from '@/lib/import/docx';
import { parseQuestionText } from '@/lib/import/textFormat';
import { validateDrafts } from '@/lib/import/validate';

const fx = (f: string) => path.join(__dirname, '..', 'fixtures', f);

describe('kuesioner dari file asli', () => {
  it('PDF (baris teks hasil pdf.ts): 15 skala STS..SS + 5 uraian, tanpa error', () => {
    const d = validateDrafts(parseQuestionText(fs.readFileSync(fx('kuesioner-pdf.txt'), 'utf8')));
    expect(d.filter((x) => x.errors.length).map((x) => [x.sourceNo, x.errors])).toEqual([]);
    expect(d).toHaveLength(20);
    const skala = d.filter((x) => x.type === 'skala');
    expect(skala).toHaveLength(15);
    expect(skala[0].options.map((o) => o.body)).toEqual(['Sangat Tidak Setuju', 'Tidak Setuju', 'Setuju', 'Sangat Setuju']);
    expect(skala[0].body).toBe('Saya masuk ke pesantren ini atas keinginan dan kesadaran saya sendiri.');
    expect(skala[0].section).toBe('Pernyataan Penskalaan');
    const uraian = d.filter((x) => x.type === 'uraian');
    expect(uraian).toHaveLength(5);
    expect(uraian[1].body).toBe('Ceritakan dengan jujur bagaimana perasaanmu yang sebenarnya saat ini setelah tahu akan tinggal di asrama\npesantren?');
    expect(uraian[0].section).toBe('Pertanyaan Isian (Pendapat Diri)');
  });

  it('Word tanpa daftar bernomor, soal di dalam tabel: 25 skala per aspek + 5 uraian', async () => {
    const d = validateDrafts(await parseDocxBuffer(fs.readFileSync(fx('form-refleksi.docx'))));
    expect(d.filter((x) => x.errors.length).map((x) => [x.sourceNo, x.errors])).toEqual([]);
    const skala = d.filter((x) => x.type === 'skala');
    expect(skala).toHaveLength(25);
    expect(skala[0].options.map((o) => o.body)).toEqual(['Sangat Tidak Sesuai', 'Tidak Sesuai', 'Sesuai', 'Sangat Sesuai']);
    expect([...new Set(skala.map((x) => x.section))]).toEqual([
      'A. Keinginan Pribadi',
      'B. Kebebasan dalam Mengambil Keputusan',
      'C. Pemahaman dan Penerimaan terhadap Kehidupan di TQI',
      'D. Komitmen dan Kesungguhan',
      'E. Kemantapan Pilihan',
    ]);
    expect(skala[5].body).toBe('Saya mengikuti seleksi TQI terutama karena orang tua menginginkan saya masuk TQI.');
    const uraian = d.filter((x) => x.type === 'uraian');
    expect(uraian).toHaveLength(5);
    expect(uraian[0].section).toBe('Refleksi');
    expect(uraian[4].body).toMatch(/^Jika ternyata kamu tidak diterima di TQI/);
  });
});
