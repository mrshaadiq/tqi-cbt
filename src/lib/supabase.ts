import { createClient } from '@supabase/supabase-js';

// Nilai pengganti dipakai hanya agar `next build` tidak gagal bila .env.local belum ada.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export function questionImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('question-images').getPublicUrl(path).data.publicUrl;
}
