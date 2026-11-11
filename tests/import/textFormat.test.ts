import { describe, it, expect } from 'vitest';
import { parseQuestionText } from '@/lib/import/textFormat';
import { validateDrafts } from '@/lib/import/validate';

describe('parseQuestionText', () => {
  it('membaca soal, opsi, dan "Kunci: b" huruf kecil', () => {
    const d = parseQuestionText('1. Ibu kota Indonesia?\nA. Bandung\nB. Jakarta\nC. Medan\nKunci: b\n');
    expect(d).toHaveLength(1);
    expect(d[0].body).toBe('Ibu kota Indonesia?');
    expect(d[0].options.map((o) => o.body)).toEqual(['Bandung', 'Jakarta', 'Medan']);
    expect(d[0].answer).toBe('B');
  });

  it('format opsi "A)" dan spasi berlebih', () => {
    const d = parseQuestionText('1)   Soal satu\n  a)  Satu\n  b)   Dua  \n  Kunci:  A');
    expect(d[0].options).toHaveLength(2);
    expect(d[0].answer).toBe('A');
  });

  it('blok kunci di akhir dipetakan ke nomor', () => {
    const t = '1. S1\nA. a\nB. b\n2. S2\nA. c\nB. d\nKunci Jawaban\n1. B\n2-A';
    const d = parseQuestionText(t);
    expect(d.map((x) => x.answer)).toEqual(['B', 'A']);
  });

  it('baris lanjutan menyambung ke opsi terakhir', () => {
    const d = parseQuestionText('1. S\nA. kalimat panjang\nlanjutan kalimat\nB. dua\nKunci: A');
    expect(d[0].options[0].body).toBe('kalimat panjang lanjutan kalimat');
  });

  it('nomor loncat (1,2,4) ditandai error', () => {
    const t = [1, 2, 4].map((n) => `${n}. S${n}\nA. a${n}\nB. b${n}\nKunci: A`).join('\n');
    const r = validateDrafts(parseQuestionText(t));
    expect(r[2].errors.join()).toMatch(/nomor loncat/);
  });
});
