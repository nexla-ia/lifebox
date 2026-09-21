-- LifeBox · testes de fn_price_order e fn_classify_order
-- Ref: LIFEBOX_PROJECT.md §11 "Testes obrigatórios"
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pricing_test.sql
--
-- O teste monta a PRÓPRIA massa dentro de uma transação e desfaz tudo no fim.
-- Não depende do seed de exemplo, não deixa resíduo, e roda igual no cluster
-- local e no Supabase. Só precisa do seed BASE (settings e sizes).
--
-- Os valores abaixo são fixture, não o preço da LifeBox: quando ela editar o
-- catálogo, estes testes continuam válidos porque o que se prova é a FÓRMULA.
-- Os números vêm do §5.6 e da tela 6i só para o caso obrigatório bater.

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

-- ============================================================ fixture
do $fx$
declare v_plan uuid; v_s uuid; v_l uuid; v_addon uuid;
begin
  select id into v_s from sizes where code = 'S';
  select id into v_l from sizes where code = 'L';
  if v_s is null or v_l is null then
    raise exception 'rode supabase/seed.sql antes: faltam os tamanhos S e L';
  end if;

  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('TESTE 10+5', 'TEST 10+5', 10, 5) returning id into v_plan;

  insert into plan_prices (plan_id, size_id, base_price_cents) values
    (v_plan, v_s, 12860), (v_plan, v_l, 15715);

  insert into extra_prices (plan_id, size_id, item_kind, unit_price_cents) values
    (v_plan, v_s, 'meal',      1075), (v_plan, v_l, 'meal',      1259),
    (v_plan, v_s, 'breakfast',  423), (v_plan, v_l, 'breakfast',  626);

  insert into custom_unit_prices (size_id, unit_price_cents) values
    (v_s, 930), (v_l, 1150)
    on conflict (size_id) do update set unit_price_cents = excluded.unit_price_cents;

  insert into dishes (name_pt, name_en, category) values
    ('Prato de teste',     'Test Dish',      'classico'),
    ('Breakfast de teste', 'Test Breakfast', 'breakfast');

  insert into addons (name_pt, name_en, category, price_cents,
                      charges_tax, charges_delivery, requires_plan, includes_meals_qty) values
    ('5 Sucos teste',   'TEST 5 Juices',   'juice',  2990, false, false, true,  0),
    ('Detox teste',     'TEST Detox',      'detox', 12624, false, false, false, 0),
    ('Super teste',     'TEST Super',      'detox', 20174, false, false, false, 5);

  select id into v_addon from addons where name_en = 'TEST Super';
  insert into addon_variants (addon_id, name_pt, name_en) values (v_addon, 'Verde', 'Green');
end $fx$;

-- ============================================================ preço
do $test$
declare
  v_plan uuid; v_s uuid; v_l uuid;
  v_meal uuid; v_bkf uuid;
  v_juices uuid; v_detox uuid; v_super uuid; v_green uuid;
  r jsonb;
begin
  select id into v_plan from plans  where name_en = 'TEST 10+5';
  select id into v_s    from sizes  where code = 'S';
  select id into v_l    from sizes  where code = 'L';
  select id into v_meal from dishes where name_en = 'Test Dish';
  select id into v_bkf  from dishes where name_en = 'Test Breakfast';
  select id into v_juices from addons where name_en = 'TEST 5 Juices';
  select id into v_detox  from addons where name_en = 'TEST Detox';
  select id into v_super  from addons where name_en = 'TEST Super';
  select id into v_green  from addon_variants where addon_id = v_super;

  -- 1 · CASO OBRIGATÓRIO (§5.6): 10+5 Small $128.60 + 1 extra Small 10 $10.75
  --     + pacote de sucos $29.90  =>  $189.00
  raise notice 'teste 1 · caso obrigatorio $189.00';
  r := fn_price_order('plan', v_plan, v_s, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',11),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5),
         jsonb_build_object('type','addon','addon_id',v_juices,'qty',1)));
  perform assert_eq((r->>'taxable_cents')::int,     13935, 'taxable');
  perform assert_eq((r->>'tax_cents')::int,           975, 'tax 7%');
  perform assert_eq((r->>'delivery_cents')::int,     1000, 'delivery');
  perform assert_eq((r->>'non_taxable_cents')::int,  2990, 'non taxable');
  perform assert_eq((r->>'total_cents')::int,       18900, 'TOTAL');
  perform assert_eq((r->>'meals_extra')::int,           1, 'refeicoes extras');
  perform assert_eq((r->>'breakfasts_extra')::int,      0, 'breakfasts extras');

  -- 2 · tela 6i do protótipo: 10+5 Large + 1 extra Large 10 + sucos => $221.52
  raise notice 'teste 2 · prototipo 6i $221.52';
  r := fn_price_order('plan', v_plan, v_l, v_l, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',11),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5),
         jsonb_build_object('type','addon','addon_id',v_juices,'qty',1)));
  perform assert_eq((r->>'taxable_cents')::int,  16974, 'taxable');
  perform assert_eq((r->>'tax_cents')::int,       1188, 'tax 7%');
  perform assert_eq((r->>'total_cents')::int,    22152, 'TOTAL');

  -- 3 · plano exato, sem extra
  raise notice 'teste 3 · plano exato, sem extra';
  r := fn_price_order('plan', v_plan, v_s, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',10),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5)));
  perform assert_eq((r->>'meals_extra')::int,        0, 'sem extra');
  perform assert_eq((r->>'tax_cents')::int,        900, 'tax de 12860');
  perform assert_eq((r->>'total_cents')::int,    14760, 'TOTAL $147.60');

  -- 4 · pick-up não cobra delivery (§6.6, pickup_charges_delivery = false)
  raise notice 'teste 4 · pick-up nao cobra delivery';
  r := fn_price_order('plan', v_plan, v_s, v_s, 'pickup', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',10),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5)));
  perform assert_eq((r->>'delivery_cents')::int,     0, 'delivery zerado');
  perform assert_eq((r->>'total_cents')::int,    13760, 'TOTAL sem delivery');

  -- 5 · Personalizado (tela 6c): 5 Small + 3 Large por unidade
  raise notice 'teste 5 · personalizado $96.67';
  r := fn_price_order('custom', null, v_s, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'size_id',v_s,'qty',5),
         jsonb_build_object('type','dish','dish_id',v_meal,'size_id',v_l,'qty',3)));
  perform assert_eq((r->>'taxable_cents')::int,   8100, 'subtotal 8 unidades');
  perform assert_eq((r->>'tax_cents')::int,        567, 'tax 7%');
  perform assert_eq((r->>'total_cents')::int,     9667, 'TOTAL $96.67');

  -- 6 · só adicionais: Detox sozinho, sem tax e sem delivery (§5.4)
  raise notice 'teste 6 · so detox, sem tax nem delivery';
  r := fn_price_order('addons_only', null, null, null, 'delivery', jsonb_build_array(
         jsonb_build_object('type','addon','addon_id',v_detox,'qty',1)));
  perform assert_eq((r->>'taxable_cents')::int,      0, 'nada tributavel');
  perform assert_eq((r->>'tax_cents')::int,          0, 'sem tax');
  perform assert_eq((r->>'delivery_cents')::int,     0, 'sem delivery');
  perform assert_eq((r->>'total_cents')::int,    12624, 'TOTAL $126.24');

  -- 7 · sabor do kit é composição, não item com preço
  raise notice 'teste 7 · variacao do kit nao cobra';
  r := fn_price_order('addons_only', null, null, null, 'delivery', jsonb_build_array(
         jsonb_build_object('type','addon','addon_id',v_super,'qty',1),
         jsonb_build_object('type','addon','addon_id',v_super,'variant_id',v_green,'qty',8)));
  perform assert_eq((r->>'total_cents')::int, 20174, 'TOTAL = so o kit');
  perform assert_eq((r->>'kit_meals_allowance')::int, 5, 'kit da 5 refeicoes');

  -- 8 · §5.4: pacote de sucos exige plano
  raise notice 'teste 8 · pacote que exige plano e recusado sozinho';
  begin
    r := fn_price_order('addons_only', null, null, null, 'delivery', jsonb_build_array(
           jsonb_build_object('type','addon','addon_id',v_juices,'qty',1)));
    raise exception 'FALHOU: deveria ter sido recusado sem plano';
  exception when others then
    if position('so pode ser vendido com um plano' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  recusado: %', sqlerrm;
  end;

  -- 9 · breakfast em tamanho diferente do plano (caso real na W37)
  raise notice 'teste 9 · breakfast em tamanho diferente do plano';
  r := fn_price_order('plan', v_plan, v_l, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',10),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',6)));
  perform assert_eq((r->>'breakfasts_extra')::int,    1, '1 breakfast extra');
  perform assert_eq((r->>'taxable_cents')::int,   16138, 'base 15715 + 423 do Small');

  raise notice 'PRICING OK';
end $test$;

-- ============================================================ classificação
do $test$
declare v_cust uuid; v_w1 uuid; v_w2 uuid; v_menu uuid;
begin
  select id into v_menu from menus where cycle_position = 1;
  insert into weeks (iso_code, starts_on, ends_on, menu_id, cutoff_at)
    values ('TEST-W01','2026-01-05','2026-01-11', v_menu, '2026-01-08 18:00-05')
    returning id into v_w1;
  insert into weeks (iso_code, starts_on, ends_on, menu_id, cutoff_at)
    values ('TEST-W02','2026-01-12','2026-01-18', v_menu, '2026-01-15 18:00-05')
    returning id into v_w2;
  insert into customers (first_name, phone_e164) values ('Teste','+15550000001')
    returning id into v_cust;

  perform assert_eq(fn_classify_order(v_cust, v_w1), 'novo_pedido'::order_status,
                    'primeira compra');

  insert into customer_weeks (customer_id, week_id, order_status)
    values (v_cust, v_w1, 'novo_pedido');
  perform assert_eq(fn_classify_order(v_cust, v_w2), 'renovacao'::order_status,
                    'pediu na semana anterior');

  update customer_weeks set order_status = 'skip'
    where customer_id = v_cust and week_id = v_w1;
  perform assert_eq(fn_classify_order(v_cust, v_w2), 'renovacao'::order_status,
                    'voltando de Skip');

  update customer_weeks set order_status = 'cancelamento'
    where customer_id = v_cust and week_id = v_w1;
  perform assert_eq(fn_classify_order(v_cust, v_w2), 'novo_pedido'::order_status,
                    'voltando de Cancelamento');

  -- §6.2 Old Lead nunca volta a New Lead
  update customers set lead_type = 'old' where id = v_cust;
  update customers set lead_type = 'new' where id = v_cust;
  perform assert_eq((select lead_type from customers where id = v_cust),
                    'old'::lead_type, 'Old Lead e irreversivel');

  raise notice 'CLASSIFICACAO OK';
end $test$;

-- desfaz tudo: fixture, semanas, cliente e a própria assert_eq
rollback;
