const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;

/** True bila sebagian besar huruf pada teks adalah huruf Arab (untuk menentukan dir="rtl" per blok). */
export function isMostlyArabic(s: string): boolean {
  const letters = s.replace(/[\s\d\p{P}\p{S}]/gu, '').replace(/[ً-ٰٟ]/g, '');
  if (!letters) return false;
  const ar = (letters.match(ARABIC) ?? []).length;
  return ar / letters.length > 0.5;
}

export function formatSeconds(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
