-- 0005_storage.sql : bucket foto kamera (privat) dan gambar soal (publik baca)
insert into storage.buckets (id, name, public) values ('snapshots', 'snapshots', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('question-images', 'question-images', true)
  on conflict (id) do nothing;

-- peserta hanya boleh mengunggah ke folder attempt miliknya yang sedang berjalan
create policy snapshots_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snapshots'
    and exists (
      select 1 from public.attempts a
       where a.id::text = (storage.foldername(name))[1]
         and a.user_id = auth.uid() and a.status = 'in_progress')
  );
-- hanya admin yang boleh melihat dan menghapus foto
create policy snapshots_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'snapshots' and public.is_admin());
create policy snapshots_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'snapshots' and public.is_admin());

-- gambar soal: admin yang menulis, siapa pun bisa membaca lewat URL publik
create policy qimg_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_admin());
create policy qimg_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'question-images' and public.is_admin());
create policy qimg_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'question-images' and public.is_admin());
