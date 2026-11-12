'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, currentProfile } from '@/lib/auth';
import { Button, Field, Icon, inputCls } from '@/components/ui';

const POINTS = [
  { icon: 'save-light', text: 'Jawaban tersimpan otomatis' },
  { icon: 'camera-light', text: 'Siapkan kamera depan perangkat' },
  { icon: 'wifi-light', text: 'Gunakan koneksi internet yang stabil' },
];

export default function LoginPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // sudah login? langsung ke tujuan
  useEffect(() => {
    currentProfile().then((p) => {
      if (p) router.replace(p.role === 'admin' ? '/admin/pantau/' : '/exam/');
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { profile } = await login(identity, password);
      router.replace(profile.role === 'admin' ? '/admin/pantau/' : '/exam/');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'LOGIN_FAILED' ? 'Nomor peserta atau kata sandi salah.' : 'Tidak dapat masuk. Periksa koneksi lalu coba lagi.');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-page lg:flex-row">
      <section className="flex flex-col gap-4 bg-brand-700 px-6 pb-8 pt-10 lg:w-[640px] lg:shrink-0 lg:justify-center lg:gap-7 lg:p-[72px]">
        <div className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-brand-600 lg:h-14 lg:w-14">
          <Icon name="shield-white-32" size={32} className="h-7 w-7 lg:h-8 lg:w-8" />
        </div>
        <h1 className="text-2xl font-bold leading-8 text-white lg:text-[32px] lg:leading-10">Tes Kemampuan Dasar Akademik</h1>
        <p className="text-sm leading-5 text-brand-100 lg:text-base lg:leading-6">
          Penerimaan Santri Baru TA 2026/2027, Taman Qur&apos;an Indonesia.
          <span className="hidden lg:inline"> Kerjakan dari rumah dengan tenang, jawaban tersimpan otomatis.</span>
        </p>
        <ul className="hidden flex-col gap-3.5 lg:flex">
          {POINTS.map((p) => (
            <li key={p.icon} className="flex items-center gap-3 text-base leading-6 text-brand-100">
              <Icon name={p.icon} size={20} />
              {p.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-1 items-start justify-center p-6 lg:items-center lg:p-0">
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-5 lg:w-[440px] lg:rounded-2xl lg:border lg:border-line lg:bg-white lg:p-10">
          <div className="hidden flex-col gap-5 lg:flex">
            <h2 className="text-2xl font-bold leading-8 text-ink">Masuk</h2>
            <p className="text-sm leading-5 text-soft">Gunakan nomor peserta dan password dari panitia.</p>
          </div>
          <Field label="Nomor peserta">
            <input className={inputCls} placeholder="Contoh: 2026-0147" value={identity} onChange={(e) => setIdentity(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" placeholder="Masukkan password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <p className="rounded-[10px] bg-danger-50 p-3 text-sm text-danger-600">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Memproses…' : 'Masuk'}</Button>
          <p className="text-center text-xs font-medium leading-4 text-muted">Lupa password? Hubungi panitia.</p>
        </form>
      </section>
    </main>
  );
}
