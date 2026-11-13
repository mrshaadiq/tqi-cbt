import { describe, expect, it } from 'vitest';
import { parseQuestionText } from '@/lib/import/textFormat';
import { rowsToDrafts } from '@/lib/import/excel';
import { validateDrafts } from '@/lib/import/validate';

describe('section dan soal isian', () => {
  it('teks: judul bagian dan soal isian dengan beberapa kunci', () => {
    const d = parseQuestionText([
      'Bagian: Bahasa',
      '1. Ibu kota Indonesia?',
      'A. Bandung',
      'B. Jakarta',
      'Kunci: B',
      'Bagian 2: Matematika',
      '2. 12 x 3 = ....',
      'Kunci: 36 | tiga puluh enam',
    ].join('\n'));
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ section: 'Bahasa', answer: 'B' });
    expect(d[0].type ?? 'pg').toBe('pg');
    expect(d[1]).toMatchObject({ section: 'Matematika', type: 'isian', accepted: ['36', 'tiga puluh enam'] });
    expect(validateDrafts(d).every((x) => x.errors.length === 0)).toBe(true);
  });

  it('excel: kolom bagian dan tipe', () => {
    const d = rowsToDrafts([
      ['no', 'bagian', 'tipe', 'soal', 'A', 'B', 'C', 'D', 'E', 'kunci'],
      ['1', 'Umum', 'pg', 'Pilih', 'x', 'y', '', '', '', 'B'],
      ['2', 'Hitung', 'isian', '2+2', '', '', '', '', '', '4|empat'],
    ]);
    expect(d[0]).toMatchObject({ section: 'Umum', answer: 'B' });
    expect(d[1]).toMatchObject({ section: 'Hitung', type: 'isian', accepted: ['4', 'empat'], options: [] });
  });

  it('excel: kuesioner skala (default 4 pilihan, dibalik) dan uraian', () => {
    const d = validateDrafts(rowsToDrafts([
      ['no', 'bagian', 'tipe', 'soal', 'A', 'B', 'C', 'D', 'E', 'kunci', 'dibalik'],
      ['1', 'A. Keinginan', 'skala', 'Saya ingin', '', '', '', '', '', '', ''],
      ['2', 'A. Keinginan', 'skala', 'Karena orang tua', '', '', '', '', '', '', 'ya'],
      ['3', 'Refleksi', 'uraian', 'Ceritakan', '', '', '', '', '', '', ''],
    ]));
    expect(d.every((x) => x.errors.length === 0)).toBe(true);
    expect(d[0]).toMatchObject({ type: 'skala', reverse: false });
    expect(d[0].options.map((o) => o.body)).toEqual(['Sangat Tidak Sesuai', 'Tidak Sesuai', 'Sesuai', 'Sangat Sesuai']);
    expect(d[1].reverse).toBe(true);
    expect(d[2]).toMatchObject({ type: 'uraian', options: [] });
  });

  it('isian tanpa kunci ditandai error', () => {
    const [v] = validateDrafts([{ type: 'isian', stimulus: null, body: 'x', options: [], answer: null, accepted: [''], errors: [], notes: [] }]);
    expect(v.errors).toContain('kunci isian kosong');
  });
});
