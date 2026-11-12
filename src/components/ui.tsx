'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50',
  secondary: 'bg-white text-brand-600 border border-line-strong hover:bg-brand-50 disabled:opacity-50',
  danger: 'bg-danger-600 text-white hover:opacity-90 disabled:opacity-50',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:opacity-50',
};

export function Button({
  variant = 'primary', className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] px-5 py-3 text-sm font-medium leading-5 transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white p-5 ${className}`}>{children}</div>;
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
const TONES: Record<Tone, string> = {
  success: 'bg-success-100 text-success-600',
  warning: 'bg-warning-100 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
  info: 'bg-info-50 text-info-600',
  neutral: 'bg-subtle text-soft',
  brand: 'bg-brand-100 text-brand-700',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium leading-4 ${TONES[tone]}`}>{children}</span>;
}

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose?: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,18,13,0.55)] p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_16px_40px_rgba(0,0,0,0.2)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-5 text-ink">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-[10px] border border-line bg-white px-3.5 py-3 text-sm leading-5 text-ink outline-none placeholder:text-muted focus:border-brand-600 focus:ring-2 focus:ring-brand-100';

export function Spinner() {
  return <div className="p-10 text-center text-soft">Memuat…</div>;
}

/** Ikon statis hasil unduhan dari Figma (public/icons). Ukuran dipaksa lewat atribut, bukan CSS 100%. */
export function Icon({ name, size, className = '' }: { name: string; size: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/${name}.svg`} alt="" width={size} height={size} className={`shrink-0 ${className}`} />;
}

/** Logo Taman Qur'an Indonesia (public/logo-tqi.png, 2691x513). Teks hitam: pakai di latar terang. */
export function Logo({ className = 'h-8' }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-tqi.png" alt="Taman Qur'an Indonesia" width={2691} height={513} className={`w-auto shrink-0 ${className}`} />;
}

/** Header peserta: logo + judul, slot kanan di layar lebar, avatar inisial di HP. */
export function PesertaHeader({ name, no, right }: { name?: string; no?: string | null; right?: ReactNode }) {
  const initials = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:px-12 md:py-3.5">
      <Logo className="h-7 md:h-9" />
      <span className="hidden border-l border-line pl-3 text-base font-semibold leading-6 text-brand-700 md:inline">Tes Kemampuan Dasar</span>
      <div className="flex-1" />
      {right}
      {name && (
        <>
          <div className="hidden items-center gap-2 rounded-full bg-subtle px-3.5 py-2 md:flex">
            <Icon name="user-muted" size={16} />
            <span className="whitespace-pre text-sm font-medium leading-5 text-soft">{name}{no ? `  ·  ${no}` : ''}</span>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-soft md:hidden">{initials}</div>
        </>
      )}
    </header>
  );
}

/** Sakelar dari Figma: abu-abu = mati, oranye = hidup. */
export function Toggle({ on, onClick, label }: { on: boolean; onClick?: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={!onClick} className="block">
      <Icon name={on ? 'toggle-on' : 'toggle-off'} size={40} className="h-[22px] w-10" />
    </button>
  );
}
