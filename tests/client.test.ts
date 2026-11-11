import { describe, it, expect, vi, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { AnswerQueue, type AnswerPayload } from '@/lib/answerQueue';
import { ServerClock } from '@/lib/serverClock';
import { generateCredentials, parsePastedRows } from '@/lib/credentials';
import { dueSlots, SnapshotScheduler } from '@/lib/snapshotScheduler';
import { isMostlyArabic, formatSeconds } from '@/lib/text';
import { exportAccountsXlsx, exportResultsXlsx } from '@/lib/export/excel';

afterEach(() => vi.useRealTimers());
const base = { attemptId: 'a', optionId: 'o1', flagged: false, token: 't' };

describe('AnswerQueue', () => {
  it('dua enqueue soal sama sebelum flush -> hanya yang terbaru dikirim', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const q = new AnswerQueue(send);
    q.enqueue({ ...base, questionId: 'q1', optionId: 'x' });
    q.enqueue({ ...base, questionId: 'q1', optionId: 'y' });
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].optionId).toBe('y');
  });

  it('clientSeq selalu naik', async () => {
    const seen: number[] = [];
    const q = new AnswerQueue(async (p: AnswerPayload) => void seen.push(p.clientSeq));
    for (let i = 0; i < 5; i++) {
      q.enqueue({ ...base, questionId: 'q' + i });
      await q.flush();
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(5);
  });

  it('gagal jaringan lalu sukses: terkirim ulang, tidak hilang', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    const q = new AnswerQueue(send, () => {}, { baseDelayMs: 1000, maxDelayMs: 8000 });
    q.enqueue({ ...base, questionId: 'q1' });
    await q.flush();
    expect(q.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.pending()).toBe(0);
  });

  it('session_replaced: onFatal dipanggil dan tidak mencoba lagi', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValue(new Error('session_replaced'));
    const fatal = vi.fn();
    const q = new AnswerQueue(send, fatal);
    q.enqueue({ ...base, questionId: 'q1' });
    await q.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fatal).toHaveBeenCalledWith('session_replaced');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('ServerClock', () => {
  it('now() mengikuti offset setelah sync', () => {
    const c = new ServerClock();
    c.sync(new Date(Date.now() + 60_000).toISOString());
    expect(Math.abs(c.now() - (Date.now() + 60_000))).toBeLessThan(50);
  });
});

describe('credentials', () => {
  it('500 kredensial unik dan tanpa karakter ambigu', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ fullName: 'Anak ' + i, participantNo: 'tqi-' + String(i).padStart(3, '0') }));
    const c = generateCredentials(rows);
    expect(new Set(c.map((x) => x.password)).size).toBe(500);
    expect(c.every((x) => /^[^0O1lI]{8}$/.test(x.password))).toBe(true);
    expect(c[0].username).toBe('tqi-000');
  });
  it('nomor duplikat atau tidak valid ditolak', () => {
    expect(() => generateCredentials([{ fullName: 'A', participantNo: 'x-1' }, { fullName: 'B', participantNo: 'X-1' }])).toThrow('NOMOR_DUPLIKAT');
    expect(() => generateCredentials([{ fullName: 'A', participantNo: 'a b' }])).toThrow('NOMOR_TIDAK_VALID');
  });
  it('parsePastedRows: tab, titik koma, koma', () => {
    expect(parsePastedRows('Budi Santoso\tTQI-001\nSiti;tqi-002\nAni, tqi-003')).toEqual([
      { fullName: 'Budi Santoso', participantNo: 'TQI-001' },
      { fullName: 'Siti', participantNo: 'tqi-002' },
      { fullName: 'Ani', participantNo: 'tqi-003' },
    ]);
  });
});

describe('dueSlots dan SnapshotScheduler', () => {
  const T0 = 1_000_000;
  const min = (m: number) => m * 60_000;
  it('slot jatuh tempo pada 0, 9:59, 10:00, 25:00', () => {
    expect(dueSlots(T0, T0, new Set())).toEqual([0]);
    expect(dueSlots(T0, T0 + min(9) + 59_000, new Set([0]))).toEqual([]);
    expect(dueSlots(T0, T0 + min(10), new Set([0]))).toEqual([1]);
    expect(dueSlots(T0, T0 + min(25), new Set([0]))).toEqual([1, 2]);
  });
  it('setelah muat ulang (0 dan 1 selesai) tidak mengulang', () => {
    expect(dueSlots(T0, T0 + min(12), new Set([0, 1]))).toEqual([]);
  });

  it('unggah gagal dua kali lalu sukses -> satu foto per slot', async () => {
    const clock = new ServerClock();
    const upload = vi.fn().mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const s = new SnapshotScheduler({ clock, stream: () => ({}) as MediaStream, capture: async () => new Blob(['x']), upload, onCameraLost: () => {} }, 1000);
    s.start(clock.now(), []);
    await s.tick(); await s.tick(); await s.tick(); await s.tick();
    s.stop();
    expect(upload.mock.calls.filter((c) => c[0] === 0)).toHaveLength(3);
  });

  it('stream null: onCameraLost dipanggil sekali dan tidak melempar', async () => {
    const clock = new ServerClock();
    const lost = vi.fn();
    const s = new SnapshotScheduler({ clock, stream: () => null, capture: async () => new Blob(), upload: async () => {}, onCameraLost: lost }, 1000);
    s.start(clock.now(), []);
    await s.tick(); await s.tick();
    s.stop();
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe('text', () => {
  it('isMostlyArabic per blok', () => {
    expect(isMostlyArabic('أَمْلَهُمْ')).toBe(true);
    expect(isMostlyArabic('Berikut yang termasuk bacaan izhar syafawi adalah')).toBe(false);
    expect(isMostlyArabic('12 + 3 = ?')).toBe(false);
  });
  it('formatSeconds', () => {
    expect(formatSeconds(65)).toBe('01:05');
    expect(formatSeconds(5400)).toBe('1:30:00');
    expect(formatSeconds(-3)).toBe('00:00');
  });
});

describe('export excel', () => {
  async function read(b: Blob) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await b.arrayBuffer());
    return wb.worksheets[0];
  }
  it('akun: header dan jumlah baris', async () => {
    const ws = await read(await exportAccountsXlsx([{ fullName: 'A', participantNo: 'a-1', username: 'a-1', password: 'Abcdefg2' }]));
    expect(ws.getRow(1).getCell(1).value).toBe('Nama');
    expect(ws.rowCount).toBe(2);
  });
  it('hasil: urut nilai turun, nilai sama = ranking sama', async () => {
    const mk = (n: string, s: number) => ({ rank: 0, fullName: n, participantNo: n, score: s, correctCount: s, passed: null, eventCount: 0 });
    const ws = await read(await exportResultsXlsx([mk('Budi', 80), mk('Ani', 90), mk('Cici', 80)]));
    const names = [2, 3, 4].map((r) => ws.getRow(r).getCell(2).value);
    const ranks = [2, 3, 4].map((r) => ws.getRow(r).getCell(1).value);
    expect(names).toEqual(['Ani', 'Budi', 'Cici']);
    expect(ranks).toEqual([1, 2, 2]);
  });
});
