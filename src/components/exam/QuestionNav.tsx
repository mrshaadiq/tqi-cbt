'use client';
import type { StateQuestion } from '@/lib/examApi';

export type AnswerMap = Record<string, { optionId: string | null; text?: string | null; flagged: boolean }>;

export const isAnswered = (a: AnswerMap[string] | undefined) => !!a && (!!a.optionId || !!a.text?.trim());

/** Kelompok soal per section, mengikuti urutan soal (section sudah berurutan dari server). */
export function groupSections(questions: StateQuestion[]): { name: string; start: number; count: number }[] {
  const out: { name: string; start: number; count: number }[] = [];
  questions.forEach((q, i) => {
    const last = out[out.length - 1];
    if (last && last.name === q.section) last.count++;
    else out.push({ name: q.section || 'Umum', start: i, count: 1 });
  });
  return out;
}

/** Grid nomor soal 8 kolom per section. Putih = belum, oranye = terjawab, biru = ragu-ragu, kotak oranye muda bergaris = sedang dibuka. */
export default function QuestionNav({
  questions, answers, current, onGo, size = 32,
}: { questions: StateQuestion[]; answers: AnswerMap; current: number; onGo: (i: number) => void; size?: 32 | 36 }) {
  const sections = groupSections(questions);
  const showHeaders = sections.length > 1;
  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <div key={s.start} className="flex flex-col gap-2">
          {showHeaders && (
            <span className="text-xs font-semibold leading-4 text-soft">
              {s.name} · {questions.slice(s.start, s.start + s.count).filter((q) => isAnswered(answers[q.id])).length}/{s.count}
            </span>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(8, ${size}px)` }}>
            {questions.slice(s.start, s.start + s.count).map((q, j) => {
              const i = s.start + j;
              const a = answers[q.id];
              const answered = isAnswered(a);
              const flagged = !!a?.flagged;
              let cls = 'border border-line-strong bg-white text-soft';
              if (answered) cls = 'border border-brand-600 bg-brand-600 text-white';
              if (flagged) cls = 'border border-info-600 bg-info-600 text-white';
              if (i === current) cls = 'border-2 border-brand-600 bg-brand-50 text-brand-700';
              return (
                <button
                  key={q.id}
                  onClick={() => onGo(i)}
                  aria-label={`Soal ${i + 1}${answered ? ', terjawab' : ''}${flagged ? ', ragu-ragu' : ''}`}
                  style={{ width: size, height: size }}
                  className={`flex items-center justify-center rounded-lg text-xs font-medium leading-4 ${cls}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
