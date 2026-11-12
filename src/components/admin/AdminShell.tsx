'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { currentProfile, logout, type Profile } from '@/lib/auth';
import { Icon, Logo, Spinner } from '@/components/ui';

const NAV = [
  { href: '/admin/pantau/', label: 'Pantauan Live', icon: 'nav-activity' },
  { href: '/admin/bank-soal/', label: 'Bank Soal', icon: 'nav-file' },
  { href: '/admin/import/', label: 'Impor Soal', icon: 'nav-upload' },
  { href: '/admin/peserta/', label: 'Peserta', icon: 'nav-users' },
  { href: '/admin/ujian/', label: 'Pengaturan Ujian', icon: 'nav-sliders' },
  { href: '/admin/hasil/', label: 'Hasil', icon: 'nav-chart' },
];

/** Ikon satu warna: bentuknya dari berkas SVG Figma, warnanya mengikuti teks (aktif putih, tidak aktif brand/100). */
function MaskIcon({ name, size = 18 }: { name: string; size?: number }) {
  const url = `url(/icons/${name}.svg)`;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-current"
      style={{ width: size, height: size, WebkitMask: `${url} center / contain no-repeat`, mask: `${url} center / contain no-repeat` }}
    />
  );
}

function NavList({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((n) => {
        const active = path.startsWith(n.href.slice(0, -1)) || (n.href === '/admin/hasil/' && path.startsWith('/admin/detail'));
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-[10px] p-3 text-sm font-medium leading-5 md:px-3 md:py-2.5 ${active ? 'bg-brand-600 text-white' : 'text-brand-100 hover:bg-white/10'}`}
          >
            <MaskIcon name={n.icon} />
            {n.label}
          </Link>
        );
      })}
    </>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    currentProfile().then((p) => {
      if (!p || p.role !== 'admin') router.replace('/');
      else setProfile(p);
    });
  }, [router]);

  if (!profile) return <Spinner />;
  const title = NAV.find((n) => path.startsWith(n.href.slice(0, -1)))?.label ?? (path.startsWith('/admin/detail') ? 'Detail Peserta' : 'Panel Panitia');
  const exit = async () => { await logout(); router.replace('/'); };
  const name = profile.full_name || 'Admin';

  const brand = (
    <div className="flex items-center gap-2.5 pb-4">
      <div className="rounded-lg bg-white px-2 py-1.5">
        <Logo className="h-7" />
      </div>
      <span className="text-base font-semibold leading-6 text-white">Panel Panitia</span>
    </div>
  );
  const user = (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white">{name[0]?.toUpperCase()}</div>
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-white">{name}</span>
      <button aria-label="Keluar" onClick={exit} className="text-brand-100"><MaskIcon name="nav-logout" /></button>
    </div>
  );

  return (
    <div className="min-h-screen bg-page md:flex">
      {/* sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1.5 bg-brand-700 p-5 md:flex">
        {brand}
        <NavList path={path} />
        <div className="flex-1" />
        {user}
      </aside>

      {/* app bar HP */}
      <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:hidden">
        <button aria-label="Menu" onClick={() => setOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-700">
          <Icon name="nav-menu" size={20} />
        </button>
        <span className="flex-1 text-base font-semibold leading-6 text-ink">{title}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700">{name[0]?.toUpperCase()}</div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 bg-[rgba(31,18,13,0.55)] md:hidden" onClick={() => setOpen(false)}>
          <div className="flex h-full w-[290px] flex-col gap-1.5 bg-brand-700 p-5" onClick={(e) => e.stopPropagation()}>
            {brand}
            <NavList path={path} onNavigate={() => setOpen(false)} />
            <div className="flex-1" />
            {user}
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:gap-5 md:p-8">{children}</main>
    </div>
  );
}
