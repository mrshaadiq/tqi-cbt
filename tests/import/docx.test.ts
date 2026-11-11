// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseDocxBuffer } from '@/lib/import/docx';
import { validateDrafts } from '@/lib/import/validate';
import type { DraftQuestion } from '@/lib/import/types';

let d: DraftQuestion[];

beforeAll(async () => {
  const buf = fs.readFileSync(path.join(__dirname, '../fixtures/soal-asli.docx'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  d = validateDrafts(await parseDocxBuffer(ab));
});

describe('soal-asli.docx', () => {
  it('terbaca tepat 100 soal', () => expect(d).toHaveLength(100));

  it('soal 1: 4 opsi, kunci C', () => {
    expect(d[0].body).toBe('Apa arti kata “Laa ilaha Illallah”');
    expect(d[0].options).toHaveLength(4);
    expect(d[0].answer).toBe('C');
    expect(d[0].errors).toEqual([]);
  });

  it('soal 2 dan 5: kunci dari teks merah', () => {
    expect(d[1].answer).toBe('A');
    expect(d[1].options[0].body).toBe('Garuda Pancasila');
    expect(d[4].answer).toBe('C');
    expect(d[4].options[2].body).toBe('Nabi Nuh alaihissalam');
  });

  it('soal 41: pantun menempel ke soalnya, kunci D', () => {
    expect(d[40].body).toContain('Kemana kancil akan dikejar');
    expect(d[40].answer).toBe('D');
  });

  it('soal 47: hanya 3 opsi dan tidak dianggap error', () => {
    expect(d[46].body).toBe('Tempat keluarnya huruf disebut');
    expect(d[46].options).toHaveLength(3);
    expect(d[46].answer).toBe('B');
    expect(d[46].errors).toEqual([]);
  });

  it('soal 59: opsi Arab utuh dengan harakat', () => {
    expect(d[58].options[0].body).toBe('أَمْلَهُمْ');
    expect(d[58].answer).toBe('A');
  });

  it('soal 87: rumus ditandai merah', () => {
    expect(d[86].errors.some((e) => /rumus/i.test(e))).toBe(true);
    expect(d[86].options.every((o) => o.body === '[RUMUS]')).toBe(true);
  });

  it('hanya soal berumus yang bermasalah (86 dan 87)', () => {
    const bad = d.map((q, i) => (q.errors.length ? i + 1 : 0)).filter(Boolean);
    expect(bad).toEqual([86, 87]);
  });

  it('teks pengantar terdeteksi pada soal 16, 37, 63', () => {
    for (const n of [16, 37, 63]) expect(d[n - 1].stimulus).toBeTruthy();
  });
});
