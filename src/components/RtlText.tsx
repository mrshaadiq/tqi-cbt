import { isMostlyArabic } from '@/lib/text';

/** Satu blok teks. Arah tulisan (RTL untuk Arab) ditentukan per blok, bukan per soal. */
export default function RtlText({ text, className = '' }: { text: string; className?: string }) {
  const rtl = isMostlyArabic(text);
  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      lang={rtl ? 'ar' : 'id'}
      className={`whitespace-pre-line ${rtl ? 'font-arab text-2xl leading-loose' : ''} ${className}`}
    >
      {text}
    </div>
  );
}
