'use client';
import { useCallback, useEffect, useState } from 'react';
import { createParticipants, listParticipants, resetPassword, resetSession, setCameraExcluded, type ParticipantRow } from '@/lib/adminApi';
import { generateCredentials, parsePastedRows } from '@/lib/credentials';
import { downloadBlob, exportAccountsXlsx } from '@/lib/export/excel';
import { Badge, Button, Icon, Modal, Spinner, Toggle } from '@/components/ui';

const colsCls = 'md:grid md:grid-cols-[200px_160px_100px_1fr] md:items-center md:gap-3';

export default function PesertaPage() {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [failed, setFailed] = useState<{ participantNo: string; reason: string }[]>([]);
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(() => listParticipants().then(setRows).catch((e) => setMsg(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  // jangan sampai baris tidak valid membuat halaman crash saat render; error ditampilkan lewat create()
  let pending = 0;
  if (text.trim()) {
    try { pending = parsePastedRows(text).length; } catch { pending = 0; }
  }

  async function create() {
    setBusy(true); setMsg(''); setFailed([]);
    try {
      const creds = generateCredentials(parsePastedRows(text));
      const res = await createParticipants(creds);
      const bad = new Set(res.failed.map((f) => f.participantNo));
      const ok = creds.filter((c) => !bad.has(c.participantNo));
      if (ok.length) downloadBlob(await exportAccountsXlsx(ok), 'akun-peserta.xlsx'); // password hanya tampil sekali
      setFailed(res.failed);
      setMsg(`${res.created} akun dibuat. File Excel berisi username dan password sudah diunduh, simpan baik-baik.`);
      setText('');
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Gagal membuat akun';
      setMsg(m.startsWith('BARIS_TIDAK_VALID')
        ? `Format baris salah, harus "Nama;Nomor" (minimal 2 kolom). ${m.slice('BARIS_TIDAK_VALID: '.length)}`
        : m);
    } finally { setBusy(false); }
  }

  async function doReset(p: ParticipantRow) {
    const [c] = generateCredentials([{ fullName: p.full_name, participantNo: p.participant_no }]);
    try { await resetPassword(p.id, c.password); setShown({ username: p.participant_no, password: c.password }); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); }
  }

  async function exportList() {
    if (!rows) return;
    // password tidak tersimpan (hanya hash), jadi kolom password dikosongkan
    const blob = await exportAccountsXlsx(rows.map((p) => ({ fullName: p.full_name, participantNo: p.participant_no, username: p.participant_no, password: '' })));
    downloadBlob(blob, 'daftar-akun-peserta.xlsx');
  }

  if (!rows) return <Spinner />;
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">Akun Peserta</h1>
          <p className="text-sm leading-5 text-soft">{rows.length} akun peserta terdaftar</p>
        </div>
        <div className="flex-1" />
        <Button variant="secondary" disabled={!rows.length} onClick={exportList}>Ekspor daftar akun (Excel)</Button>
      </div>

      {msg && <p className="rounded-[10px] bg-brand-50 p-3 text-sm text-ink">{msg}</p>}
      {failed.length > 0 && <ul className="list-disc pl-5 text-sm text-danger-600">{failed.map((f) => <li key={f.participantNo}>{f.participantNo}: {f.reason}</li>)}</ul>}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-white">
          <div className={`hidden bg-subtle px-4 py-2.5 text-xs font-medium leading-4 text-muted md:grid md:grid-cols-[200px_160px_100px_1fr] md:gap-3`}>
            <span>PESERTA</span><span>KAMERA DIKECUALIKAN</span><span>SESI</span><span>AKSI</span>
          </div>
          {rows.map((p) => (
            <div key={p.id} className={`${colsCls} flex flex-col items-start gap-2 border-b border-line px-4 py-3 last:border-b-0`}>
              <div className="flex flex-col gap-0.5 font-medium">
                <span className="text-sm leading-5 text-ink">{p.full_name}</span>
                <span className="text-xs leading-4 text-muted">{p.participant_no}</span>
              </div>
              <Toggle
                on={p.camera_excluded}
                label={`Kecualikan kamera ${p.full_name}`}
                onClick={async () => { await setCameraExcluded(p.id, !p.camera_excluded); await load(); }}
              />
              <div>{p.session_token ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Belum login</Badge>}</div>
              <div className="flex flex-row gap-4 text-sm font-medium leading-5 text-brand-600 md:flex-col md:gap-1">
                <button className="text-left" onClick={() => doReset(p)}>Reset password</button>
                <button className="text-left" onClick={async () => { await resetSession(p.id); setMsg(`Sesi ${p.participant_no} direset.`); await load(); }}>Reset sesi</button>
              </div>
            </div>
          ))}
          {!rows.length && <p className="p-4 text-sm text-muted">Belum ada peserta.</p>}
        </div>

        <div className="flex flex-col gap-3.5 rounded-xl border border-line bg-white p-5 lg:w-[380px] lg:shrink-0">
          <h2 className="text-base font-semibold leading-6 text-ink">Buat akun massal</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Ahmad Fauzi, 2026-0147\nSiti Aisyah, 2026-0148\nBudi Santoso, 2026-0149'}
            className="h-[150px] w-full resize-none rounded-[10px] border border-line bg-subtle p-3.5 text-sm leading-5 text-ink outline-none placeholder:text-soft focus:border-brand-600"
          />
          <p className="text-xs font-medium leading-4 text-muted">
            Satu peserta per baris: Nama, Nomor peserta. Username dan password acak dibuat otomatis.
          </p>
          <div className="flex items-start gap-2 rounded-[10px] bg-info-50 p-3">
            <Icon name="info-blue" size={16} />
            <p className="flex-1 text-xs font-medium leading-4 text-info-600">Password hanya tampil sekali. Unduh Excel setelah akun dibuat.</p>
          </div>
          <Button disabled={busy || !pending} onClick={create}>{busy ? 'Membuat…' : pending ? `Buat ${pending} akun` : 'Buat akun'}</Button>
        </div>
      </div>

      <Modal open={!!shown} title="Password baru" onClose={() => setShown(null)}>
        <p className="mb-1 text-sm">Username: <b>{shown?.username}</b></p>
        <p className="mb-4 text-sm">Password: <b className="select-all font-mono text-lg">{shown?.password}</b></p>
        <p className="mb-4 text-xs text-soft">Catat sekarang, password tidak ditampilkan lagi.</p>
        <Button onClick={() => setShown(null)}>Tutup</Button>
      </Modal>
    </>
  );
}
