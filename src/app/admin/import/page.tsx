'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { IMPORT_ERRORS, importFile } from '@/lib/import';
import { validateDrafts } from '@/lib/import/validate';
import type { DraftQuestion } from '@/lib/import/types';
import { clearBank, saveQuestions } from '@/lib/adminApi';
import { downloadBlob, exportTemplateXlsx } from '@/lib/export/excel';
import { isMostlyArabic } from '@/lib/text';
import QuestionEditor from '@/components/QuestionEditor';
import RtlText from '@/components/RtlText';
import { Badge, Button, Icon } from '@/components/ui';

export default function ImportPage() {
  const [drafts, setDrafts] = useState<DraftQuestion[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const [onlyBad, setOnlyBad] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [replace, setReplace] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setError(''); setDone(null); setDrafts(null); setFileName(f.name);
    try {
      setDrafts(await importFile(f));
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(IMPORT_ERRORS[code] ?? `Gagal membaca file (${code || 'tidak diketahui'}).`);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  const update = (i: number, d: DraftQuestion) => setDrafts((all) => validateDrafts(all!.map((x, j) => (j === i ? d : x))));
  const remove = (i: number) => setDrafts((all) => validateDrafts(all!.filter((_, j) => j !== i)));
  const removeBad = () => setDrafts((all) => validateDrafts(all!.filter((d) => !d.errors.length)));

  const bad = drafts?.filter((d) => d.errors.length).length ?? 0;
  const total = drafts?.length ?? 0;

  async function save() {
    if (!drafts) return;
    setBusy(true); setError('');
    try {
      if (replace) await clearBank();
      setDone(await saveQuestions(drafts));
      setDrafts(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold leading-8 text-ink">Impor Soal</h1>
          <p className="text-sm leading-5 text-soft">Periksa hasil bacaan sebelum disimpan ke bank soal</p>
        </div>
        <div className="flex-1" />
        <Button variant="secondary" onClick={async () => downloadBlob(await exportTemplateXlsx(), 'template-soal.xlsx')}>Unduh template Excel</Button>
      </div>

      <input ref={input} type="file" accept=".docx,.xlsx,.csv,.pdf" onChange={onFile} disabled={busy} className="hidden" />

      {/* info file */}
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-4 md:flex-row md:items-center md:gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-brand-50">
          <Icon name="file-brand" size={22} />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 font-medium">
          <span className="truncate text-sm leading-5 text-ink">{fileName || 'Belum ada file dipilih'}</span>
          <span className="text-xs leading-4 text-muted">
            {busy && !drafts ? `Membaca ${fileName}…` : 'Dibaca di browser, file tidak diunggah ke server'}
          </span>
        </div>
        <div className="flex-1" />
        {drafts && (
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{total} soal terbaca</Badge>
            <Badge tone="success">{total - bad} siap</Badge>
            {bad > 0 && <Badge tone="danger">{bad} perlu diperiksa</Badge>}
          </div>
        )}
        <Button variant="ghost" className="text-soft" disabled={busy} onClick={() => input.current?.click()}>{drafts ? 'Ganti file' : 'Pilih file'}</Button>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl bg-info-50 px-4 py-3">
        <Icon name="info-blue-18" size={18} />
        <p className="flex-1 text-sm font-medium leading-5 text-info-600">
          Cara membaca file Word: nomor soal dan huruf opsi dari daftar bernomor Word, kunci jawaban dari opsi bertulisan merah, paragraf tanpa nomor sebagai teks pengantar. Rumus matematika Word tidak terbaca otomatis. Format lain: Excel/CSV dan PDF berisi teks (maks 10 MB, 200 soal).
        </p>
      </div>

      {error && <p className="rounded-[10px] bg-danger-50 p-3 text-sm text-danger-600">{error}</p>}
      {done !== null && (
        <p className="rounded-[10px] bg-success-100 p-3 text-sm text-success-600">
          {done} soal tersimpan. <Link href="/admin/bank-soal/" className="font-semibold underline">Lihat bank soal</Link>
        </p>
      )}

      {drafts && bad > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl bg-danger-50 px-4 py-3">
          <Icon name="alert-red" size={18} />
          <p className="flex-1 text-sm font-medium leading-5 text-danger-600">
            Ada {bad} soal yang perlu diperiksa (ditandai merah). Perbaiki atau buang sebelum bisa menyimpan. Tidak ada soal yang masuk bank sebelum Anda mengonfirmasi.
          </p>
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-danger-600">
            <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />hanya tampilkan
          </label>
        </div>
      )}

      {drafts?.map((d, i) => {
        if (onlyBad && !d.errors.length) return null;
        const open = editing === i;
        const hasErr = d.errors.length > 0;
        const arabicOpts = d.options.some((o) => isMostlyArabic(o.body));
        const keyLabel = d.options.find((o) => o.label === d.answer)?.label;
        return (
          <div key={i} className={`flex flex-col gap-3.5 rounded-xl bg-white p-5 ${hasErr ? 'border-2 border-danger-600' : 'border border-line'}`}>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-base font-semibold leading-6 text-ink">Soal {i + 1}</span>
              {hasErr ? d.errors.map((e) => <Badge key={e} tone="danger">{e}</Badge>) : <Badge tone="success">Valid</Badge>}
              {!hasErr && d.stimulus && <Badge tone="brand">Teks pengantar terdeteksi</Badge>}
              {!hasErr && arabicOpts && <Badge tone="brand">{d.options.length} opsi, teks Arab</Badge>}
              <div className="flex-1" />
              <button className="text-sm font-medium leading-5 text-brand-600" onClick={() => setEditing(open ? null : i)}>{open ? 'Tutup' : 'Edit'}</button>
              <button className="text-sm font-medium leading-5 text-danger-600" onClick={() => remove(i)}>Buang</button>
            </div>
            {open ? (
              <QuestionEditor draft={d} onChange={(nd) => update(i, nd)} />
            ) : (
              <>
                {d.stimulus && (
                  <div className="flex flex-col gap-0.5 rounded-[10px] bg-subtle p-3.5">
                    <span className="text-xs font-medium leading-4 text-muted">TEKS PENGANTAR</span>
                    <RtlText text={d.stimulus} className="text-sm leading-5 text-ink" />
                  </div>
                )}
                <RtlText text={d.body || '(kosong)'} className="text-base leading-6 text-ink" />
                {d.options.map((o) => {
                  const isKey = d.answer === o.label;
                  const rtl = isMostlyArabic(o.body);
                  return (
                    <div key={o.label} dir={rtl ? 'rtl' : 'ltr'} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ${isKey ? 'bg-success-100' : 'bg-subtle'}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium leading-4 ${isKey ? 'border-success-600 bg-success-600 text-white' : 'border-line-strong bg-white text-soft'}`}>{o.label}</span>
                      <span lang={rtl ? 'ar' : 'id'} className={`flex-1 text-ink ${rtl ? 'text-right font-arab text-xl leading-9' : 'text-sm leading-5'}`}>{o.body || '(kosong)'}</span>
                      {isKey && <Icon name="check-green-16" size={16} />}
                    </div>
                  );
                })}
                {keyLabel && <p className="text-xs font-medium leading-4 text-muted">Kunci terbaca dari teks merah: opsi {keyLabel}</p>}
                {d.notes.map((n) => <p key={n} className="text-xs font-medium leading-4 text-warning-600">ⓘ {n}</p>)}
                {hasErr && (
                  <div className="flex flex-wrap gap-2.5">
                    <Button variant="secondary" onClick={() => setEditing(i)}>Ketik rumus manual</Button>
                    <Button variant="secondary" onClick={() => setEditing(i)}>Tempel gambar rumus</Button>
                    <Button variant="danger" onClick={() => remove(i)}>Buang soal</Button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {drafts && (
        <div className="sticky bottom-3 flex flex-col gap-3 rounded-xl border border-line bg-white p-4 md:flex-row md:items-center">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-5 text-soft">
              {total - bad} dari {total} soal siap.{bad > 0 ? ` Simpan aktif setelah ${bad} soal bermasalah diperbaiki atau dibuang.` : ''}
            </p>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />kosongkan bank soal lama dulu
            </label>
          </div>
          <div className="flex-1" />
          {bad > 0 && <Button variant="secondary" onClick={removeBad}>Buang yang bermasalah</Button>}
          <Button disabled={busy || bad > 0 || total === 0} className="disabled:opacity-45" onClick={save}>{busy ? 'Menyimpan…' : `Simpan ${total} soal`}</Button>
        </div>
      )}
    </>
  );
}
