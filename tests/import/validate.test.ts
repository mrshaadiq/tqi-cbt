import { describe, it, expect } from 'vitest';
import { validateDrafts } from '@/lib/import/validate';
import { emptyDraft, type DraftQuestion } from '@/lib/import/types';

const ok = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
  ...emptyDraft(),
  body: 'Soal',
  options: [{ label: 'A', body: 'a' }, { label: 'B', body: 'b' }],
  answer: 'A',
  ...over,
});
const errs = (d: DraftQuestion) => validateDrafts([d])[0].errors;

describe('validateDrafts', () => {
  it('soal sehat tanpa error', () => expect(errs(ok())).toEqual([]));
  it('opsi kurang dari dua', () => expect(errs(ok({ options: [{ label: 'A', body: 'a' }] }))).toContain('opsi kurang dari dua'));
  it('kunci tidak ada', () => expect(errs(ok({ answer: null }))).toContain('kunci tidak ada'));
  it('kunci lebih dari satu', () =>
    expect(errs(ok({ answer: null, keyCandidates: ['A', 'B'] }))).toContain('kunci lebih dari satu'));
  it('kunci tidak cocok dengan opsi', () => expect(errs(ok({ answer: 'D' }))).toContain('kunci tidak cocok dengan opsi'));
  it('opsi duplikat', () =>
    expect(errs(ok({ options: [{ label: 'A', body: 'x' }, { label: 'B', body: ' X ' }] }))).toContain('opsi duplikat'));
  it('teks soal kosong', () => expect(errs(ok({ body: '  ' }))).toContain('teks soal kosong'));
  it('opsi kosong tanpa gambar', () => expect(errs(ok({ options: [{ label: 'A', body: '' }, { label: 'B', body: 'b' }] }))[0]).toMatch(/kosong/));
  it('[RUMUS] di opsi memblokir', () =>
    expect(errs(ok({ options: [{ label: 'A', body: '[RUMUS]' }, { label: 'B', body: 'b' }] })).join()).toMatch(/rumus/i));
  it('nomor loncat 1,2,4', () => {
    const r = validateDrafts([ok({ sourceNo: 1 }), ok({ sourceNo: 2 }), ok({ sourceNo: 4 })]);
    expect(r[0].errors).toEqual([]);
    expect(r[1].errors).toEqual([]);
    expect(r[2].errors[0]).toMatch(/nomor loncat/);
  });
  it('mengisi ulang error setelah admin memperbaiki (derived)', () => {
    const bad = validateDrafts([ok({ answer: null })])[0];
    expect(bad.errors).toContain('kunci tidak ada');
    expect(validateDrafts([{ ...bad, answer: 'B' }])[0].errors).toEqual([]);
  });
});
