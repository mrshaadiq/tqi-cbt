import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { rowsToDrafts, parseExcelBuffer, parseCsvText } from '@/lib/import/excel';
import { itemsToLines } from '@/lib/import/pdf';
import { importFile, enforceLimits } from '@/lib/import';
import { emptyDraft } from '@/lib/import/types';

const header = ['no', 'pengantar', 'soal', 'A', 'B', 'C', 'D', 'E', 'kunci'];

describe('excel / csv', () => {
  it('rowsToDrafts: opsi kosong dilewati dan kunci dipetakan ulang', () => {
    const d = rowsToDrafts([header, ['1', '', 'S1', 'a', '', 'c', 'd', '', 'C']]);
    expect(d[0].options.map((o) => [o.label, o.body])).toEqual([['A', 'a'], ['B', 'c'], ['C', 'd']]);
    expect(d[0].answer).toBe('B'); // kunci "C" asli = opsi kedua yang terisi
  });

  it('kolom tidak lengkap -> error', () => {
    expect(() => rowsToDrafts([['x', 'y'], ['1', '2']])).toThrow('KOLOM_TIDAK_LENGKAP');
  });

  it('xlsx: baca balik', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Soal');
    ws.addRow(header);
    ws.addRow([1, 'Bacaan', 'Soal satu', 'a', 'b', 'c', 'd', '', 'B']);
    ws.addRow([2, '', 'Soal dua', 'x', 'y', '', '', '', 'A']);
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const d = await parseExcelBuffer(buf);
    expect(d).toHaveLength(2);
    expect(d[0].stimulus).toBe('Bacaan');
    expect(d[0].answer).toBe('B');
    expect(d[1].options).toHaveLength(2);
  });

  it('csv', async () => {
    const d = await parseCsvText('no,soal,A,B,kunci\n1,Soal,satu,dua,B\n');
    expect(d[0].answer).toBe('B');
  });
});

describe('pdf', () => {
  it('itemsToLines: urut per baris dan per posisi x', () => {
    const lines = itemsToLines([
      { str: 'dua', x: 50, y: 700 }, { str: 'satu', x: 10, y: 701 }, { str: 'baris kedua', x: 10, y: 680 },
    ]);
    expect(lines).toEqual(['satu dua', 'baris kedua']);
  });
});

describe('importFile', () => {
  it('file 11 MB -> FILE_TOO_LARGE', async () => {
    await expect(importFile({ name: 'a.docx', size: 11 * 1024 * 1024 } as File)).rejects.toThrow('FILE_TOO_LARGE');
  });
  it('201 soal -> TOO_MANY_QUESTIONS', () => {
    expect(() => enforceLimits(Array.from({ length: 201 }, () => emptyDraft()))).toThrow('TOO_MANY_QUESTIONS');
    expect(enforceLimits(Array.from({ length: 200 }, () => emptyDraft()))).toHaveLength(200);
  });
  it('ekstensi tidak dikenal', async () => {
    await expect(importFile({ name: 'a.txt', size: 10 } as File)).rejects.toThrow('UNSUPPORTED_FILE');
  });
});
