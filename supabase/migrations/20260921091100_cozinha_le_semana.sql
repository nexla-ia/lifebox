-- LifeBox · a Cozinha precisa saber de que semana é a folha
-- Ref: LIFEBOX_PROJECT.md §3, §9.3
--
-- A folha da bancada traz o código da semana e a data de entrega. Sem ler
-- `weeks`, o perfil Cozinha trava em "Abrindo a semana…": as policies de
-- weeks eram só de staff.
--
-- A semana em si não tem nada sensível — código, datas, menu do ciclo e
-- cutoff. O que a Cozinha continua sem alcançar é pedido, cliente e preço.

drop policy if exists weeks_leitura_autenticado on weeks;
create policy weeks_leitura_autenticado on weeks
  for select to authenticated
  using (true);

-- os menus também: a folha mostra "Menu 3 do ciclo"
drop policy if exists menus_leitura_autenticado on menus;
create policy menus_leitura_autenticado on menus
  for select to authenticated
  using (true);

-- e os tamanhos, que são as colunas S/L da contagem
drop policy if exists sizes_leitura_autenticado on sizes;
create policy sizes_leitura_autenticado on sizes
  for select to authenticated
  using (true);

comment on table weeks is
  'Leitura aberta a qualquer usuário autenticado: a Cozinha precisa do código '
  'e da data da semana para a folha da bancada (§9.3). Escrita segue restrita.';
