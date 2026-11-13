import { RUMUS, type DraftQuestion } from './types';

export function validateDrafts(drafts: DraftQuestion[]): DraftQuestion[] {
  let prevNo: number | undefined;
  return drafts.map((d) => {
    const errors: string[] = [];
    if (d.sourceNo !== undefined) {
      if (prevNo !== undefined && d.sourceNo !== prevNo + 1) {
        errors.push(`nomor loncat (setelah ${prevNo} muncul ${d.sourceNo})`);
      }
      prevNo = d.sourceNo;
    }
    if (!d.body.trim()) errors.push('teks soal kosong');
    if (d.body.includes(RUMUS) || (d.stimulus ?? '').includes(RUMUS)) {
      errors.push('soal masih berisi [RUMUS] (rumus tidak terbaca), ganti dengan teks rumus');
    }
    if (d.type === 'isian') {
      if (!(d.accepted ?? []).some((x) => x.trim())) errors.push('kunci isian kosong');
      return { ...d, errors };
    }
    if (d.options.length < 2) errors.push('opsi kurang dari dua');
    if (d.options.length > 5) errors.push('opsi lebih dari lima');

    const optMath = d.options.filter((o) => o.body.includes(RUMUS)).map((o) => o.label);
    if (optMath.length) {
      errors.push(`opsi ${optMath.join(', ')} masih berisi [RUMUS] (rumus tidak terbaca), isi manual`);
    }
    const optEmpty = d.options.filter((o) => !o.body.trim() && !o.image).map((o) => o.label);
    if (optEmpty.length) errors.push(`opsi ${optEmpty.join(', ')} kosong`);

    const seen = new Set<string>();
    let dup = false;
    for (const o of d.options) {
      const k = o.body.trim().toLowerCase();
      if (!k || k.includes(RUMUS.toLowerCase())) continue;
      if (seen.has(k)) dup = true;
      seen.add(k);
    }
    if (dup) errors.push('opsi duplikat');

    if (d.answer === null) {
      errors.push(d.keyCandidates && d.keyCandidates.length > 1 ? 'kunci lebih dari satu' : 'kunci tidak ada');
    } else if (!d.options.some((o) => o.label === d.answer)) {
      errors.push('kunci tidak cocok dengan opsi');
    }
    return { ...d, errors };
  });
}
