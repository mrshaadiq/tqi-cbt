import { supabase } from './supabase';
import type { DraftQuestion, Label } from './import/types';
import type { ParticipantCredential } from './credentials';
import type { Exam } from './examApi';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------ bank soal ------------------------------ */

export type QuestionRow = {
  id: string; position: number; section: string; type: 'pg' | 'isian'; stimulus: string | null; body: string; image_path: string | null; is_active: boolean;
  options: { id: string; label: Label; body: string; image_path: string | null }[];
  answer_keys: { option_id: string | null; accepted: string[] | null } | null;
};

export async function listQuestions(): Promise<QuestionRow[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('id, position, section, type, stimulus, body, image_path, is_active, options(id, label, body, image_path), answer_keys(option_id, accepted)')
    .order('position');
  if (error) throw new Error(error.message);
  return (data as unknown as QuestionRow[]).map((q) => ({
    ...q,
    options: [...q.options].sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

export function rowToDraft(q: QuestionRow): DraftQuestion {
  const key = q.options.find((o) => o.id === q.answer_keys?.option_id);
  return {
    section: q.section, type: q.type, accepted: q.answer_keys?.accepted ?? [],
    stimulus: q.stimulus, body: q.body, answer: key?.label ?? null,
    options: q.options.map((o) => ({ label: o.label, body: o.body })),
    errors: [], notes: [],
  };
}

export function isProblematic(q: QuestionRow): boolean {
  if (q.type === 'isian') return !q.answer_keys?.accepted?.length || !q.body.trim();
  return !q.answer_keys?.option_id || q.options.length < 2 || !q.body.trim() || q.options.some((o) => !o.body.trim() && !o.image_path);
}

export async function questionSummary(): Promise<{ active: number; problematic: number }> {
  const rows = (await listQuestions()).filter((q) => q.is_active);
  return { active: rows.length, problematic: rows.filter(isProblematic).length };
}

export async function uploadQuestionImage(blob: Blob): Promise<string> {
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : 'png';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('question-images').upload(path, blob, { contentType: blob.type || 'image/png' });
  if (error) throw new Error(error.message);
  return path;
}

/** Simpan draf (gambar diunggah dulu, lalu semua soal masuk dalam satu transaksi database). */
export async function saveQuestions(drafts: DraftQuestion[]): Promise<number> {
  const payload = [];
  for (const d of drafts) {
    const image_path = d.image ? await uploadQuestionImage(d.image) : null;
    const options = [];
    for (const o of d.options) options.push({ label: o.label, body: o.body, image_path: o.image ? await uploadQuestionImage(o.image) : null });
    payload.push({ section: d.section || 'Umum', type: d.type ?? 'pg', accepted: d.accepted ?? [], stimulus: d.stimulus, body: d.body, image_path, answer: d.answer, options, is_active: true });
  }
  return rpc<number>('admin_save_questions', { p_payload: payload });
}

export async function updateQuestion(id: string, d: DraftQuestion, isActive: boolean, imagePath: string | null): Promise<void> {
  await rpc('admin_update_question', {
    p: { section: d.section || 'Umum', type: d.type ?? 'pg', accepted: d.accepted ?? [], stimulus: d.stimulus, body: d.body, answer: d.answer, is_active: isActive, image_path: imagePath, options: d.options.map((o) => ({ label: o.label, body: o.body })) },
    p_id: id,
  });
}

export async function setQuestionActive(id: string, v: boolean) {
  const { error } = await supabase.from('questions').update({ is_active: v }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteQuestion(id: string) {
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) throw new Error('Soal ini sudah dipakai ujian. Nonaktifkan saja, jangan dihapus.');
}

export const clearBank = () => rpc<number>('admin_clear_bank');

/* ------------------------------ peserta ------------------------------ */

export type ParticipantRow = { id: string; full_name: string; participant_no: string; camera_excluded: boolean; session_token: string | null };

export async function listParticipants(): Promise<ParticipantRow[]> {
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, participant_no, camera_excluded, session_token').eq('role', 'peserta').order('participant_no');
  if (error) throw new Error(error.message);
  return data as ParticipantRow[];
}

export async function createParticipants(creds: ParticipantCredential[]): Promise<{ created: number; failed: { participantNo: string; reason: string }[] }> {
  const { data, error } = await supabase.functions.invoke('create-participants', { body: { action: 'create', participants: creds } });
  if (error) throw new Error(error.message);
  return data;
}

export async function resetPassword(userId: string, password: string): Promise<void> {
  const { error } = await supabase.functions.invoke('create-participants', { body: { action: 'reset_password', userId, password } });
  if (error) throw new Error(error.message);
}

export async function resetSession(userId: string) {
  const { error } = await supabase.from('profiles').update({ session_token: null }).eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function setCameraExcluded(userId: string, v: boolean) {
  const { error } = await supabase.from('profiles').update({ camera_excluded: v }).eq('id', userId);
  if (error) throw new Error(error.message);
}

/* ------------------------------ ujian ------------------------------ */

export type ExamInput = { title: string; durationMinutes: number; opensAt: string; closesAt: string };

export async function getExam(): Promise<Exam | null> {
  const { data } = await supabase.from('exams').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Exam) ?? null;
}

export async function saveExam(input: ExamInput, existingId?: string) {
  if (Date.parse(input.closesAt) <= Date.parse(input.opensAt)) throw new Error('Jam tutup harus setelah jam buka.');
  const row = { title: input.title, duration_minutes: input.durationMinutes, opens_at: input.opensAt, closes_at: input.closesAt };
  const q = existingId ? supabase.from('exams').update(row).eq('id', existingId) : supabase.from('exams').insert(row);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export const resetTryout = () => rpc<number>('admin_reset_tryout');

/* ------------------------------ pantauan dan hasil ------------------------------ */

export type LiveRow = {
  user_id: string; full_name: string; participant_no: string; camera_excluded: boolean;
  attempt_id: string | null; status: 'belum_mulai' | 'in_progress' | 'submitted' | 'expired';
  sisa_detik: number | null; terjawab: number; kejadian: number; foto: number;
};
export async function liveStatus(): Promise<LiveRow[]> {
  const { data, error } = await supabase.from('live_status').select('*').order('participant_no');
  if (error) throw new Error(error.message);
  return data as LiveRow[];
}
export const extendAttempt = (id: string, minutes: number) => rpc('admin_extend_attempt', { p_attempt_id: id, p_minutes: minutes });
export const reopenAttempt = (id: string, minutes: number) => rpc('admin_reopen_attempt', { p_attempt_id: id, p_minutes: minutes });
export const stopExam = (examId: string) => rpc<number>('admin_stop_exam', { p_exam_id: examId });
export const finalizeExpired =(examId: string) => rpc<number>('finalize_expired', { p_exam_id: examId });

export type SectionScore = { section: string; total: number; correct: number; score: number };

export type ResultDbRow = {
  attempt_id: string; full_name: string; participant_no: string; score: number; correct_count: number;
  status: string; terjawab: number; total_soal: number; section_scores: SectionScore[] | null; passed: boolean | null; kejadian: number; rank: number;
};
export async function results(): Promise<ResultDbRow[]> {
  const { data, error } = await supabase.from('results').select('*').order('score', { ascending: false }).order('full_name');
  if (error) throw new Error(error.message);
  return data as ResultDbRow[];
}

export async function setPassed(attemptId: string, passed: boolean | null) {
  const q = passed === null
    ? supabase.from('pass_marks').delete().eq('attempt_id', attemptId)
    : supabase.from('pass_marks').upsert({ attempt_id: attemptId, passed });
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export type AttemptDetail = {
  attempt: { id: string; full_name: string; participant_no: string; status: string; score: number | null; correct_count: number | null; section_scores: SectionScore[] | null; started_at: string; ends_at: string; submitted_at: string | null };
  rows: { question_id: string; position: number; section: string; type: 'pg' | 'isian'; manual_correct: boolean | null; question: string; chosen: string | null; correct: string | null; is_correct: boolean; flagged: boolean }[];
  events: { type: string; created_at: string }[];
};
export const attemptDetail = (id: string) => rpc<AttemptDetail>('admin_attempt_detail', { p_attempt_id: id });
export const setManualCorrect = (attemptId: string, questionId: string, value: boolean | null) =>
  rpc<void>('admin_set_manual_correct', { p_attempt_id: attemptId, p_question_id: questionId, p_value: value });

/* ------------------------------ foto ------------------------------ */

export async function signedSnapshotUrls(attemptId: string): Promise<{ takenAt: string; slot: number; url: string }[]> {
  const { data: rows, error } = await supabase.from('snapshots').select('slot, path, taken_at').eq('attempt_id', attemptId).order('slot');
  if (error) throw new Error(error.message);
  if (!rows?.length) return [];
  const { data: signed } = await supabase.storage.from('snapshots').createSignedUrls(rows.map((r) => r.path as string), 60);
  return rows.map((r, i) => ({ takenAt: r.taken_at as string, slot: r.slot as number, url: signed?.[i]?.signedUrl ?? '' }));
}

/** Hapus foto (file di storage lalu barisnya). olderThanDays kosong = hapus semua. */
export async function purgeSnapshots(olderThanDays?: number): Promise<number> {
  let total = 0;
  for (;;) {
    let q = supabase.from('snapshots').select('id, path').limit(100);
    if (olderThanDays) q = q.lt('taken_at', new Date(Date.now() - olderThanDays * 86_400_000).toISOString());
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) return total;
    const { error: e1 } = await supabase.storage.from('snapshots').remove(data.map((r) => r.path as string));
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabase.from('snapshots').delete().in('id', data.map((r) => r.id as string));
    if (e2) throw new Error(e2.message);
    total += data.length;
  }
}
