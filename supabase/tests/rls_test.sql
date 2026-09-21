-- LifeBox · testes de RLS por perfil
-- Ref: LIFEBOX_PROJECT.md §3
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
--
-- O que se prova: a Cozinha não alcança valor, contato nem endereço, e a
-- Operação não edita preço. Não basta esconder no menu — URL direta tem que
-- voltar vazio.
--
-- Monta a própria massa e desfaz no fim: roda no cluster local e no Supabase
-- sem deixar resíduo. Só precisa do seed BASE (sizes, menus).

\set ON_ERROR_STOP on

begin;

create or replace function assert_eq(p_got anyelement, p_want anyelement, p_what text)
returns void language plpgsql as $fn$
begin
  if p_got is distinct from p_want then
    raise exception 'FALHOU %: esperado %, veio %', p_what, p_want, p_got;
  end if;
  raise notice '  ok  % = %', p_what, p_got;
end $fn$;

-- o teste depende de auth.uid() ler a variável de sessão; se o projeto usar
-- outro mecanismo, melhor falhar aqui do que dar falso verde mais na frente
do $chk$
begin
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  if auth.uid() is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'auth.uid() nao le request.jwt.claim.sub — teste de RLS invalido aqui';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
end $chk$;

-- ============================================================ fixture
-- os perfis NÃO são inseridos à mão: quem cria é o gatilho
-- on_auth_user_created, lendo full_name e role do metadata. Assim este teste
-- também prova o provisionamento (migration 0700).
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','admin@lifebox.test',    now(),
   '{"full_name":"Admin Teste","role":"admin"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222','operacao@lifebox.test', now(),
   '{"full_name":"Op Teste","role":"operacao"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333','cozinha@lifebox.test',  now(),
   '{"full_name":"Cozinha Teste","role":"cozinha"}'::jsonb);

do $t$
begin
  raise notice 'provisionamento pelo gatilho';
  perform assert_eq((select count(*)::int from profiles
                      where email like '%@lifebox.test'), 3, 'tres perfis criados');
  perform assert_eq((select role from profiles
                      where email = 'admin@lifebox.test'), 'admin'::user_role,
                    'papel veio do metadata');
  perform assert_eq((select status from profiles
                      where email = 'cozinha@lifebox.test'), 'ativo'::user_status,
                    'ja confirmado entra ativo');
end $t$;

do $fx$
declare v_c uuid; v_w uuid; v_p uuid; v_s uuid; v_d uuid;
begin
  select id into v_s from sizes where code = 'S';

  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('TESTE RLS','TEST RLS',10,5) returning id into v_p;
  insert into plan_prices (plan_id, size_id, base_price_cents)
    values (v_p, v_s, 12860);
  insert into dishes (name_pt, name_en, category)
    values ('Prato RLS','RLS Dish','classico') returning id into v_d;

  insert into customers (first_name, last_name, phone_e164, street_address, city, kitchen_notes)
    values ('Cliente','Teste','+15550009999','Rua Teste 1','Boston','Sem cebola')
    returning id into v_c;
  insert into weeks (iso_code, starts_on, ends_on, menu_id, cutoff_at)
    values ('RLS-W01','2026-02-02','2026-02-08',
            (select id from menus where cycle_position=1),'2026-02-05 18:00-05')
    returning id into v_w;

  insert into orders (code, customer_id, week_id, kind, plan_id, size_id, total_cents)
    values ('RLS-0001', v_c, v_w, 'plan', v_p, v_s, 18900);
  insert into order_items (order_id, item_type, dish_id, size_id, qty,
                           name_snapshot, category_snapshot)
    values ((select id from orders where code='RLS-0001'), 'dish', v_d, v_s, 11,
            'Prato RLS', 'classico');
end $fx$;

-- ====================================================== COZINHA (§3)
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $t$
begin
  raise notice 'perfil Cozinha';
  perform assert_eq((select count(*) from orders)::int,      0, 'nao ve pedidos');
  perform assert_eq((select count(*) from customers)::int,   0, 'nao ve clientes');
  perform assert_eq((select count(*) from plan_prices)::int, 0, 'nao ve precos');
  perform assert_eq((select count(*) from v_week_summary
                      where total_pedidos > 0)::int,         0, 'nao ve faturamento');
  -- a única porta aberta: a folha da bancada
  perform assert_eq((select sum(qty)::int from v_production
                      where dish_name_pt = 'Prato RLS'),    11, 've a producao');
  perform assert_eq((select count(*)::int from v_kitchen_notes
                      where kitchen_notes = 'Sem cebola'),   1, 've as kitchen notes');
end $t$;

-- ===================================================== OPERACAO (§3)
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $t$
declare v_rows int;
begin
  raise notice 'perfil Operacao';
  perform assert_eq((select count(*)::int from orders    where code = 'RLS-0001'), 1, 've pedidos');
  perform assert_eq((select count(*)::int from customers where phone_e164 = '+15550009999'), 1, 've clientes');
  perform assert_eq((select count(*)::int from plan_prices
                      where plan_id = (select id from plans where name_en='TEST RLS')), 1, 'LE precos');

  -- §3 "Catálogo (somente leitura de preços)". RLS não levanta erro num UPDATE
  -- sem policy: simplesmente não acha linha. Então o que se testa é a contagem.
  update plan_prices set base_price_cents = 1;
  get diagnostics v_rows = row_count;
  perform assert_eq(v_rows, 0, 'nenhum preco alterado pela Operacao');

  perform assert_eq((select base_price_cents from plan_prices
                      where plan_id = (select id from plans where name_en='TEST RLS')),
                    12860, 'preco intacto');

  -- mas edita prato e menu do ciclo (tela 5c roda no perfil Operação)
  update dishes set desc_pt = 'editado pela operacao' where name_en = 'RLS Dish';
  get diagnostics v_rows = row_count;
  perform assert_eq(v_rows, 1, 'edita prato');
end $t$;

-- ======================================================== ADMIN (§3)
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $t$
declare v_rows int;
begin
  raise notice 'perfil Administrador';
  perform assert_eq((select count(*)::int from orders where code = 'RLS-0001'), 1, 've pedidos');

  update plan_prices set base_price_cents = 99999
   where plan_id = (select id from plans where name_en = 'TEST RLS');
  get diagnostics v_rows = row_count;
  perform assert_eq(v_rows, 1, 'edita preco');

  perform assert_eq((select count(*)::int from v_week_summary where iso_code = 'RLS-W01'),
                    1, 've o resumo da semana');
end $t$;

reset role;

do $t$ begin raise notice 'RLS OK'; end $t$;

rollback;
