-- LifeBox · testes do Overview (§10)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/overview_test.sql
--
-- A regra que o §10 cobra explicitamente: "a visão mensal precisa bater com a
-- soma das semanas". Ela só fecha porque a semana entra no mês da ENTREGA (o
-- domingo), e nao por dia corrido — senao a semana virada de mes cairia nos
-- dois e nenhum fecharia. E o primeiro teste daqui.

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

-- ------------------------------------------------------------------- massa
do $fx$
declare
  v_admin uuid := gen_random_uuid(); v_oper uuid := gen_random_uuid();
  v_plan uuid; v_s uuid; v_d uuid; v_add uuid;
  w36 uuid; w37 uuid; w38 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  o uuid;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (v_admin, 'admin.ov@teste.local', now()), (v_oper, 'oper.ov@teste.local', now());
  update profiles set role = 'admin',    status = 'ativo' where id = v_admin;
  update profiles set role = 'operacao', status = 'ativo' where id = v_oper;
  perform set_config('lb.admin', v_admin::text, false);
  perform set_config('lb.oper',  v_oper::text,  false);

  select id into v_s from sizes where code = 'S';
  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('PLANO OV', 'PLAN OV', 5, 0) returning id into v_plan;
  insert into plan_prices (plan_id, size_id, base_price_cents) values (v_plan, v_s, 10000);
  insert into dishes (name_pt, name_en, category)
    values ('Prato OV', 'Dish OV', 'classico') returning id into v_d;
  insert into addons (name_pt, name_en, price_cents, charges_tax, charges_delivery)
    values ('Suco OV', 'Juice OV', 3000, false, false) returning id into v_add;

  -- setembro/2026: W36 entrega 06/09, W37 13/09, W38 20/09. Agosto: W35 (30/08)
  w36 := fn_ensure_week(date '2026-09-01');
  w37 := fn_ensure_week(date '2026-09-08');
  w38 := fn_ensure_week(date '2026-09-15');
  perform fn_ensure_week(date '2026-08-25');   -- W35, entrega 30/08 → agosto
  perform fn_ensure_week(date '2026-09-22');   -- W39, entrega 27/09 → setembro
  perform fn_ensure_week(date '2026-09-29');   -- W40, entrega 04/10 → outubro

  insert into menu_dishes (menu_id, dish_id, active)
    select menu_id, v_d, true from weeks where id in (w36, w37, w38)
    on conflict do nothing;

  insert into customers (first_name, phone_e164, status) values
    ('Ana OV',     '+15551110001', 'ativo'),
    ('Bruno OV',   '+15551110002', 'ativo'),
    ('Carla OV',   '+15551110003', 'ativo'),
    ('Diego OV',   '+15551110004', 'ativo'),
    ('Elisa OV',   '+15551110005', 'ativo');
  select id into c1 from customers where phone_e164 = '+15551110001';
  select id into c2 from customers where phone_e164 = '+15551110002';
  select id into c3 from customers where phone_e164 = '+15551110003';
  select id into c4 from customers where phone_e164 = '+15551110004';
  select id into c5 from customers where phone_e164 = '+15551110005';

  -- W37: Ana e Bruno pedem (ambos Novo). Ana paga.
  o := (fn_create_order(jsonb_build_object('customer_id', c1, 'week_id', w37,
        'kind','plan','plan_id',v_plan,'size_id',v_s,
        'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))))
        ->>'order_id')::uuid;
  update orders set payment_status = 'confirmado' where id = o;
  perform fn_create_order(jsonb_build_object('customer_id', c2, 'week_id', w37,
        'kind','plan','plan_id',v_plan,'size_id',v_s,
        'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));

  -- W38: Ana renova e paga; Carla é nova com adicional; Diego dá Skip;
  -- Elisa entra como Parceria.
  o := (fn_create_order(jsonb_build_object('customer_id', c1, 'week_id', w38,
        'kind','plan','plan_id',v_plan,'size_id',v_s,
        'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))))
        ->>'order_id')::uuid;
  update orders set payment_status = 'confirmado' where id = o;

  perform fn_create_order(jsonb_build_object('customer_id', c3, 'week_id', w38,
        'kind','plan','plan_id',v_plan,'size_id',v_s,
        'items', jsonb_build_array(
          jsonb_build_object('type','dish','dish_id',v_d,'qty',5),
          jsonb_build_object('type','addon','addon_id',v_add,'qty',1))));

  perform fn_set_week_status(c4, w38, 'skip');

  perform fn_create_order(jsonb_build_object('customer_id', c5, 'week_id', w38,
        'kind','plan','plan_id',v_plan,'size_id',v_s,'is_partnership', true,
        'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));

  -- metas: semanal da W38 e mensal de setembro
  insert into goals (period_type, period_key, amount_cents) values
    ('week',  '2026-W38', 50000),
    ('month', '2026-09',  200000);
end $fx$;

-- ------------------------------------------------------------------ testes
do $t$
declare
  ov jsonb; ov37 jsonb; ov38 jsonb; mes jsonb; serie jsonb; lista jsonb;
begin
  perform set_config('request.jwt.claim.sub', current_setting('lb.admin'), true);

  raise notice 'a semana entra no mes da ENTREGA, nao por dia corrido';
  perform assert_eq(
    (select count(*)::int from fn_semanas_do_periodo('month','2026-09') f
      join weeks w on w.id = f), 4, 'setembro tem 4 semanas (W36..W39)');
  perform assert_eq(
    (select count(*)::int from fn_semanas_do_periodo('month','2026-09') f
      join weeks w on w.id = f where w.iso_code = '2026-W36'), 1,
    'W36 entrega 06/09, entao e de setembro');
  perform assert_eq(
    (select count(*)::int from fn_semanas_do_periodo('month','2026-09') f
      join weeks w on w.id = f where w.iso_code = '2026-W40'), 0,
    'W40 entrega 04/10, entao e de outubro');
  perform assert_eq(
    (select count(*)::int from fn_semanas_do_periodo('month','2026-08') f
      join weeks w on w.id = f where w.iso_code = '2026-W35'), 1,
    'W35 entrega 30/08, entao e de agosto');

  ov37 := fn_overview('week', '2026-W37');
  ov38 := fn_overview('week', '2026-W38');
  mes  := fn_overview('month', '2026-09');

  raise notice 'MES = SOMA DAS SEMANAS (§10)';
  perform assert_eq((mes->'faturamento'->>'total_cents')::int,
                    (ov37->'faturamento'->>'total_cents')::int
                    + (ov38->'faturamento'->>'total_cents')::int,
                    'faturamento do mes fecha com as semanas');
  perform assert_eq((mes->'pedidos'->>'total')::int,
                    (ov37->'pedidos'->>'total')::int + (ov38->'pedidos'->>'total')::int,
                    'pedidos do mes fecham com as semanas');
  perform assert_eq((mes->'faturamento'->>'faturado_cents')::int,
                    (ov37->'faturamento'->>'faturado_cents')::int
                    + (ov38->'faturamento'->>'faturado_cents')::int,
                    'faturado do mes fecha com as semanas');

  raise notice 'Skip, Cancelamento e Parceria ficam fora do total (§6.4)';
  perform assert_eq((ov38->'pedidos'->>'total')::int, 2, 'W38: Ana e Carla');
  perform assert_eq((ov38->'pedidos'->>'novo')::int, 1, 'Carla e Novo Pedido');
  perform assert_eq((ov38->'pedidos'->>'renovacao')::int, 1, 'Ana renovou');
  perform assert_eq((ov38->'pedidos'->>'skip')::int, 1, 'Diego deu Skip');
  perform assert_eq((ov38->'pedidos'->>'parceria')::int, 1, 'Elisa e Parceria');
  perform assert_eq((ov38->'parcerias'->>'qtd')::int, 1, 'parceria contada a parte');
  perform assert_eq((ov38->'parcerias'->>'valor_comercial_cents')::int > 0, true,
                    'parceria tem valor comercial, nao receita');

  raise notice 'ticket medio = faturado / pedidos pagos (§10)';
  perform assert_eq((ov38->>'ticket_pagos')::int, 1, 'um pedido pago na W38');
  perform assert_eq((ov38->>'ticket_medio_cents')::int,
                    (ov38->'faturamento'->>'faturado_cents')::int,
                    'um pago: o ticket e o proprio valor');
  -- o do protótipo sai junto, com outro nome (DECISOES-ABERTAS item 9)
  perform assert_eq((ov38->>'ticket_por_pedido_cents')::int,
                    ((ov38->'faturamento'->>'total_cents')::int / 2),
                    'a outra conta tambem sai, separada');

  raise notice 'taxa de renovacao = renovacoes / base da semana anterior';
  perform assert_eq((ov38->'renovacao'->>'base')::int, 2, 'W37 teve 2 pedidos');
  perform assert_eq((ov38->'renovacao'->>'renovou')::int, 1, 'so a Ana voltou');
  perform assert_eq((ov38->'renovacao'->>'taxa')::numeric, 50.0, '1 de 2 = 50%');

  raise notice 'mix de planos NAO conta adicional (§10)';
  perform assert_eq(
    (select sum((x->>'qtd')::int)::int from jsonb_array_elements(ov38->'mix_planos') x),
    2, 'mix conta os 2 pedidos de plano');
  perform assert_eq(
    (select (a->>'valor_cents')::int from jsonb_array_elements(ov38->'adicionais') a
      where a->>'nome' = 'Suco OV'), 3000, 'o suco aparece como adicional');

  raise notice 'metas: semana usa a semanal, mes usa a mensal, ano soma as mensais';
  perform assert_eq((ov38->>'meta_cents')::int, 50000, 'meta da W38');
  perform assert_eq((mes->>'meta_cents')::int, 200000, 'meta de setembro');
  perform assert_eq((fn_overview('year','2026')->>'meta_cents')::int, 200000,
                    'ano soma as metas mensais');

  raise notice 'periodo em andamento e reconhecido (tela 8d)';
  perform assert_eq((fn_overview('week', (select iso_code from weeks
                                           where fn_hoje_operacional()
                                                 between starts_on and ends_on))
                     ->'periodo'->>'em_andamento')::boolean,
                    true, 'a semana de hoje esta em andamento');
  perform assert_eq((ov38->'periodo'->>'em_andamento')::boolean, false,
                    'semana passada nao');

  raise notice 'leads ficam em zero ate a automacao alimentar (§9.1)';
  perform assert_eq((ov38->'leads'->>'novos')::int, 0, 'nenhum lead ainda');
  perform assert_eq(ov38->'leads'->>'conversao', null,
                    'conversao e NULA, nao 0% — nao ha denominador');

  raise notice 'serie traz meta e ano anterior na mesma linha';
  serie := fn_overview_serie('week', '2026-W38', 3);
  perform assert_eq(jsonb_array_length(serie), 3, 'tres periodos');
  perform assert_eq(serie->2->>'chave', '2026-W38', 'a ultima e a pedida');
  perform assert_eq((serie->2->>'meta_cents')::int, 50000, 'meta na serie');
  perform assert_eq((serie->2->>'total_cents')::int,
                    (ov38->'faturamento'->>'total_cents')::int,
                    'serie e overview contam a mesma coisa');

  raise notice 'drill-down explica o numero (tela 8c)';
  lista := fn_overview_lista('week', '2026-W38', 'total');
  perform assert_eq(jsonb_array_length(lista), (ov38->'pedidos'->>'total')::int,
                    'a lista tem o tamanho do numero');
  perform assert_eq(jsonb_array_length(fn_overview_lista('week','2026-W38','skip')), 1,
                    'e a de Skip tambem');
  perform assert_eq(
    jsonb_array_length(fn_overview_lista('week','2026-W38','faturado')),
    (ov38->>'ticket_pagos')::int, 'faturado bate com os pagos');

  raise notice 'periodo sem dado nenhum nao quebra (tela 8e)';
  ov := fn_overview('week', '2030-W01');
  perform assert_eq((ov->'pedidos'->>'total')::int, 0, 'zero pedidos');
  perform assert_eq(ov->'faturamento'->>'pct_meta', null, 'sem meta, sem percentual');

  raise notice 'OVERVIEW OK';
end $t$;

-- ------------------------------------------------- §3: exclusivo do Admin
do $p$
begin
  perform set_config('request.jwt.claim.sub', current_setting('lb.oper'), true);
  begin
    perform fn_overview('week', '2026-W38');
    raise exception 'FALHOU: Operacao abriu o Overview';
  exception when sqlstate 'LB403' then raise notice '  ok  Operacao recusada';
  end;
  begin
    perform fn_overview_lista('week', '2026-W38', 'total');
    raise exception 'FALHOU: Operacao abriu o drill-down';
  exception when sqlstate 'LB403' then raise notice '  ok  drill-down recusado';
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform fn_overview('week', '2026-W38');
    raise exception 'FALHOU: anonimo abriu o Overview';
  exception when sqlstate 'LB403' then raise notice '  ok  anonimo recusado';
  end;
  raise notice 'ACESSO OK';
end $p$;

rollback;
