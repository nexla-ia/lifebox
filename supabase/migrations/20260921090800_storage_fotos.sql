-- LifeBox · Storage para fotos de prato
-- Ref: LIFEBOX_PROJECT.md §11.2 "pratos (fotos no Storage)" · tela 5e
--
-- Bucket público de LEITURA: a foto do prato aparece no link público, que é
-- aberto e sem sessão (§9.7). Escrita continua restrita à equipe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dish-photos', 'dish-photos', true,
  5 * 1024 * 1024,                                   -- 5 MB por foto
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- leitura aberta: o cliente precisa ver a foto sem estar logado
drop policy if exists dish_photos_leitura_publica on storage.objects;
create policy dish_photos_leitura_publica on storage.objects
  for select using (bucket_id = 'dish-photos');

-- escrita só para a equipe. A Cozinha não cadastra prato (§3), mas também não
-- chega aqui: ela só abre a Produção.
drop policy if exists dish_photos_equipe_envia on storage.objects;
create policy dish_photos_equipe_envia on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dish-photos' and is_staff());

drop policy if exists dish_photos_equipe_atualiza on storage.objects;
create policy dish_photos_equipe_atualiza on storage.objects
  for update to authenticated
  using (bucket_id = 'dish-photos' and is_staff());

drop policy if exists dish_photos_equipe_remove on storage.objects;
create policy dish_photos_equipe_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'dish-photos' and is_staff());
