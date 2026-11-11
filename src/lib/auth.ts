import { supabase } from './supabase';
import { toEmail } from './config';

export type Profile = {
  id: string;
  role: 'admin' | 'peserta';
  full_name: string;
  participant_no: string | null;
  camera_excluded: boolean;
};

const TOKEN_KEY = 'psb_session_token';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function setToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* mode privat tertentu: abaikan */
  }
}

export async function currentProfile(): Promise<Profile | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, role, full_name, participant_no, camera_excluded')
    .eq('id', u.user.id)
    .maybeSingle();
  return (data as Profile) ?? null;
}

/** Mengambil alih sesi: token lama (di perangkat/tab lain) langsung tidak berlaku. */
export async function claimSession(): Promise<string> {
  const { data, error } = await supabase.rpc('claim_session');
  if (error) throw new Error(error.message);
  setToken(data as string);
  return data as string;
}

/** Peserta login dengan nomor peserta; admin login dengan email (mengandung '@'). */
export async function login(identity: string, password: string): Promise<{ profile: Profile; token: string | null }> {
  const email = identity.includes('@') ? identity.trim() : toEmail(identity);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('LOGIN_FAILED');
  const profile = await currentProfile();
  if (!profile) throw new Error('NO_PROFILE');
  const token = profile.role === 'peserta' ? await claimSession() : null;
  return { profile, token };
}

export async function logout() {
  setToken(null);
  await supabase.auth.signOut();
}
