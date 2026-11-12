// Domain email sintetis untuk login peserta. Harus SAMA dengan yang di Edge Function.
export const EMAIL_DOMAIN = 'psb.local';

// Jadwal foto kamera (menit) dan toleransi jawaban setelah waktu habis (detik, ditegakkan di database)
export const PHOTO_INTERVAL_MIN = 10;

// Password awal yang sama untuk semua peserta (bisa diubah per peserta lewat "Reset password").
export const DEFAULT_PARTICIPANT_PASSWORD = 'cerdas123';

export const normalizeNo = (no: string) => no.trim().toLowerCase();
export const toEmail = (no: string) => `${normalizeNo(no)}@${EMAIL_DOMAIN}`;
