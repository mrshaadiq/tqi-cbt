import { normalizeNo } from './config';

export type ParticipantCredential = { fullName: string; participantNo: string; username: string; password: string };

// tanpa karakter yang mirip: 0 O 1 l I
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function randomPassword(len = 8): string {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

/** Nomor peserta menjadi bagian email, jadi dibatasi huruf kecil, angka, titik, strip, garis bawah. */
export const PARTICIPANT_NO_RE = /^[a-z0-9._-]{3,40}$/;

/** Bila `fixedPassword` diberikan, semua peserta memakai password itu (bukan acak). */
export function generateCredentials(rows: { fullName: string; participantNo: string }[], fixedPassword?: string): ParticipantCredential[] {
  const seen = new Set<string>();
  const used = new Set<string>();
  return rows.map((r) => {
    const no = normalizeNo(r.participantNo);
    if (!r.fullName.trim()) throw new Error(`NAMA_KOSONG: ${r.participantNo}`);
    if (!PARTICIPANT_NO_RE.test(no)) throw new Error(`NOMOR_TIDAK_VALID: ${r.participantNo}`);
    if (seen.has(no)) throw new Error(`NOMOR_DUPLIKAT: ${r.participantNo}`);
    seen.add(no);
    let pw = fixedPassword ?? randomPassword();
    if (!fixedPassword) {
      while (used.has(pw)) pw = randomPassword();
      used.add(pw);
    }
    return { fullName: r.fullName.trim(), participantNo: no, username: no, password: pw };
  });
}

/** Baris tempel dari Excel/teks: "Nama<TAB|;|,>Nomor" (nomor = bagian terakhir). */
export function parsePastedRows(text: string): { fullName: string; participantNo: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|;|,/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) throw new Error(`BARIS_TIDAK_VALID: ${line}`);
      return { participantNo: parts[parts.length - 1], fullName: parts.slice(0, -1).join(' ') };
    });
}
