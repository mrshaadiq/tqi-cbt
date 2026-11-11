import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Amiri } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });
const amiri = Amiri({ subsets: ['arabic', 'latin'], weight: ['400', '700'], variable: '--font-amiri' });

export const metadata: Metadata = {
  title: 'Tes Kemampuan Dasar Akademik · TQI',
  description: 'Penerimaan Santri Baru TA 2026/2027',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${jakarta.variable} ${amiri.variable}`}>
      <body>{children}</body>
    </html>
  );
}
