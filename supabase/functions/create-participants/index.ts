// Edge Function: pembuatan akun massal dan reset password. Hanya admin.
// Memakai service-role key (otomatis tersedia di lingkungan Edge Function, tidak pernah ke browser).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMAIL_DOMAIN = 'psb.local'; // HARUS sama dengan src/lib/config.ts

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Cred = { fullName: string; participantNo: string; username: string; password: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. siapa pemanggil?
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: u } = await caller.auth.getUser();
  if (!u.user) return json({ error: 'unauthorized' }, 401);

  // 2. harus admin
  const admin = createClient(url, service);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  if (prof?.role !== 'admin') return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: 'bad_request' }, 400);

  if (body.action === 'reset_password') {
    const { error } = await admin.auth.admin.updateUserById(String(body.userId), { password: String(body.password) });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (body.action === 'create') {
    const list: Cred[] = Array.isArray(body.participants) ? body.participants : [];
    if (list.length > 500) return json({ error: 'too_many' }, 400);
    const failed: { participantNo: string; reason: string }[] = [];
    let created = 0;

    const one = async (c: Cred) => {
      const no = String(c.participantNo).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(no) || String(c.password).length < 8) {
        failed.push({ participantNo: no, reason: 'data tidak valid' });
        return;
      }
      const { data, error } = await admin.auth.admin.createUser({
        email: `${no}@${EMAIL_DOMAIN}`, password: c.password, email_confirm: true,
      });
      if (error || !data.user) {
        failed.push({ participantNo: no, reason: /already|registered|exists/i.test(error?.message ?? '') ? 'nomor sudah terdaftar' : (error?.message ?? 'gagal') });
        return;
      }
      const { error: pe } = await admin.from('profiles').insert({
        id: data.user.id, role: 'peserta', full_name: String(c.fullName).trim(), participant_no: no,
      });
      if (pe) {
        await admin.auth.admin.deleteUser(data.user.id); // batalkan agar tidak ada akun tanpa profil
        failed.push({ participantNo: no, reason: pe.message });
        return;
      }
      created++;
    };

    for (let i = 0; i < list.length; i += 10) await Promise.all(list.slice(i, i + 10).map(one));
    return json({ created, failed });
  }

  return json({ error: 'unknown_action' }, 400);
});
