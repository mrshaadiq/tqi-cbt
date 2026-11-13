import { supabase } from './supabase';
import type { AnswerPayload } from './answerQueue';

export type Exam = { id: string; title: string; duration_minutes: number; opens_at: string; closes_at: string };
export type Attempt = {
  id: string; exam_id: string; user_id: string; started_at: string; ends_at: string;
  submitted_at: string | null; status: 'in_progress' | 'submitted' | 'expired';
};
export type StateOption = { id: string; label: string; body: string; image_path: string | null };
export type StateQuestion = {
  id: string; position: number; section: string; type: 'pg' | 'isian'; stimulus: string | null; body: string; image_path: string | null; options: StateOption[];
};
export type AttemptState = {
  attempt_id: string; server_now: string; started_at: string; ends_at: string;
  status: 'in_progress' | 'submitted' | 'expired';
  questions: StateQuestion[];
  answers: { question_id: string; option_id: string | null; answer_text: string | null; flagged: boolean }[];
  snapshot_slots: number[];
};

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const serverNow = () => rpc<string>('server_now');

export async function latestExam(): Promise<Exam | null> {
  const { data } = await supabase.from('exams').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Exam) ?? null;
}

export async function myAttempt(examId: string): Promise<Attempt | null> {
  const { data } = await supabase.from('attempts').select('*').eq('exam_id', examId).maybeSingle();
  return (data as Attempt) ?? null;
}

export const startAttempt = (examId: string, token: string) =>
  rpc<Attempt>('start_attempt', { p_exam_id: examId, p_token: token });

export const fetchState = (attemptId: string, token: string) =>
  rpc<AttemptState>('get_attempt_state', { p_attempt_id: attemptId, p_token: token });

export const sendAnswer = (p: AnswerPayload) =>
  rpc<void>('save_answer', {
    p_attempt_id: p.attemptId, p_question_id: p.questionId, p_option_id: p.optionId,
    p_flagged: p.flagged, p_client_seq: p.clientSeq, p_token: p.token, p_answer_text: p.answerText ?? null,
  });

export const submit = (attemptId: string, token: string) =>
  rpc<void>('submit_attempt', { p_attempt_id: attemptId, p_token: token });

export const logEvent = (attemptId: string, type: string, token: string) =>
  rpc<void>('log_event', { p_attempt_id: attemptId, p_type: type, p_token: token }).catch(() => {});

export async function uploadSnapshot(attemptId: string, slot: number, blob: Blob, token: string): Promise<void> {
  const path = `${attemptId}/slot-${slot}.jpg`;
  const { error } = await supabase.storage.from('snapshots').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  // 409 / "already exists": foto slot ini sudah terunggah sebelumnya, lanjut catat saja
  if (error && !/exists|duplicate|409/i.test(error.message)) throw new Error(error.message);
  await rpc<void>('record_snapshot', { p_attempt_id: attemptId, p_slot: slot, p_path: path, p_token: token });
}
