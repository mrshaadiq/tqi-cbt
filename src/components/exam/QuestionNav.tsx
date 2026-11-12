'use client';
import type { StateQuestion } from '@/lib/examApi';

export type AnswerMap = Record<string, { optionId: string | null; flagged: boolean }>;

/** Grid nomor soal 8 kolom. Putih = belum, oranye = terjawab, biru = ragu-ragu, kotak oranye muda bergaris = sedang dibuka. */
export default function QuestionNav({
  questions, answers, current, onGo, size = 32,
}: { questions: StateQuestion[]; answers: AnswerMap; current: number; onGo: (i: number) => void; size?: 32 | 36 }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(8, ${size}px)` }}>
      {questions.map((q, i) => {
        const a = answers[q.id];
        const answered = !!a?.optionId;
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
  );
}
