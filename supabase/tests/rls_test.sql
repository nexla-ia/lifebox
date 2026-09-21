-- LifeBox · testes de RLS por perfil
-- Ref: LIFEBOX_PROJECT.md §3
--
-- O que se prova aqui: a Cozinha não alcança valor, contato nem endereço, e a
-- Operação não edita preço. Não basta esconder no menu — URL direta tem que
-- voltar vazio.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql

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

-- três usuários, um por perfil
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@lifebox.test'),
  ('22222222-2222-2222-2222-222222222222','operacao@lifebox.test'),
  ('33333333-3333-3333-3333-333333333333','cozinha@lifebox.test');

insert into profiles (id, full_name, email, role, status) values
  ('11111111-1111-1111-1111-111111111111','Admin Teste','admin@lifebox.test','admin','ativo'),
  ('22222222-2222-2222-2222-222222222222','Op Teste','operacao@lifebox.test','operacao','ativo'),
  ('33333333-3333-3333-3333-333333333333','Cozinha Teste','cozinha@lifebox.test','cozinha','ativo');

-- um pedido real para a Cozinha tentar enxergar
do $seed$
declare v_c uuid; v_w uuid; v_p uuid; v_s uuid; v_d uuid;
begin
  insert into customers (first_name, last_name, phone_e164, street_address, city, kitchen_notes)
    values ('Felipe','Cardoso','+15085550164','7 Lakeside Dr','Westborough','Sem cebola')
    returning id into v_c;
  insert into weeks (iso_code, starts_on, ends_on, menu_id, cutoff_at)
    values ('RLS-W01','2026-02-02','2026-02-08',
            (select id from menus where cycle_position=1),'2026-02-05 18:00-05')
    returning id into v_w;
  select id into v_p from plans where name_en = '10 Meals + 5 Breakfasts';
  select id into v_s from sizes where code = 'S';
  select id into v_d from dishes where category = 'classico' order by name_pt limit 1;

  insert into orders (code, customer_id, week_id, kind, plan_id, size_id, total_cents)
    values ('RLS-0001', v_c, v_w, 'plan', v_p, v_s, 18900);
  insert into order_items (order_id, item_type, dish_id, size_id, qty, name_snapshot, category_snapshot)
    values ((select id from orders where code='RLS-0001'), 'dish', v_d, v_s, 11,
            (select name_pt from dishes where id = v_d), 'classico');
end $seed$;

-- ====================================================== COZINHA (§3)
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $t$
begin
  raise notice 'perfil Cozinha';
  perform assert_eq((select count(*) from orders)::int,    0, 'nao ve pedidos');
  perform assert_eq((select count(*) from customers)::int, 0, 'nao ve clientes');
  perform assert_eq((select count(*) from plan_prices)::int, 0, 'nao ve precos');
  perform assert_eq((select count(*) from v_week_summary
                      where total_pedidos > 0)::int, 0, 'nao ve faturamento');
  -- a única porta aberta: a folha da bancada
  perform assert_eq((select sum(qty)::int from v_production), 11, 've a producao');
  perform assert_eq((select count(*)::int from v_kitchen_notes), 1, 've as kitchen notes');
end $t$;

-- ===================================================== OPERACAO (§3)
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $t$
declare v_rows int;
begin
  raise notice 'perfil Operacao';
  perform assert_eq((select count(*) from orders)::int,    1, 've pedidos');
  perform assert_eq((select count(*) from customers)::int, 1, 've clientes');
  perform assert_eq((select count(*) from plan_prices)::int, 8, 'LE precos');

  -- mas nao edita preco: §3 "Catalogo (somente leitura de precos)".
  -- RLS nao levanta erro num UPDATE sem policy: simplesmente nao acha linha.
  -- Entao o que se testa e a contagem de linhas afetadas, nao uma excecao.
  update plan_prices set base_price_cents = 1;
  get diagnostics v_rows = row_count;
  perform assert_eq(v_rows, 0, 'nenhum preco alterado pela Operacao');

  perform assert_eq((select base_price_cents from plan_prices pp
                      join plans p on p.id = pp.plan_id
                      join sizes s on s.id = pp.size_id
                     where p.name_en = '10 Meals + 5 Breakfasts' and s.code = 'S'),
                    12860, 'preco intacto');

  -- pode editar prato e menu do ciclo (tela 5c roda no perfil Operacao)
  update dishes set desc_pt = 'editado pela operacao'
   where id = (select id from dishes order by name_pt limit 1);
  perform assert_eq((select count(*)::int from dishes where desc_pt = 'editado pela operacao'),
                    1, 'edita prato');
end $t$;

-- ======================================================== ADMIN (§3)
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $t$
begin
  raise notice 'perfil Administrador';
  perform assert_eq((select count(*) from orders)::int, 1, 've pedidos');
  update plan_prices set base_price_cents = 99999
   where plan_id = (select id from plans where name_en = '5 Meals')
     and size_id = (select id from sizes where code = 'S');
  perform assert_eq((select base_price_cents from plan_prices pp
                      join plans p on p.id = pp.plan_id
                      join sizes s on s.id = pp.size_id
                     where p.name_en = '5 Meals' and s.code = 'S'),
                    99999, 'edita preco');
  perform assert_eq((select count(*)::int from v_week_summary where iso_code = 'RLS-W01'),
                    1, 've o resumo da semana');
end $t$;

reset role;

do $t$ begin raise notice 'RLS OK'; end $t$;

rollback;
