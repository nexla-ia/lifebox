-- LifeBox · testes de fn_price_order e fn_classify_order
-- Ref: LIFEBOX_PROJECT.md §11 "Testes obrigatórios"
--
-- Roda contra o banco já com seed.sql + seeds/exemplo_catalogo.sql.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pricing_test.sql
-- Qualquer falha aborta com exceção.
--
-- Os VALORES aqui vêm do seed de exemplo. Se a LifeBox trocar os preços, este
-- arquivo troca junto — o que se testa é a FÓRMULA, não o preço.

\set ON_ERROR_STOP on

create or replace function assert_eq(p_got anyelement, p_want anyelement, p_what text)
returns void language plpgsql as $fn$
begin
  if p_got is distinct from p_want then
    raise exception 'FALHOU %: esperado %, veio %', p_what, p_want, p_got;
  end if;
  raise notice '  ok  % = %', p_what, p_got;
end $fn$;

do $test$
declare
  v_plan_s   uuid; v_plan_l   uuid;
  v_s        uuid; v_l        uuid;
  v_meal     uuid; v_bkf      uuid;
  v_juices   uuid; v_detox3   uuid; v_super uuid;
  v_green    uuid;
  r          jsonb;
begin
  select id into v_plan_s from plans where name_en = '10 Meals + 5 Breakfasts';
  v_plan_l := v_plan_s;
  select id into v_s from sizes where code = 'S';
  select id into v_l from sizes where code = 'L';
  select id into v_meal from dishes where category = 'classico'  order by name_pt limit 1;
  select id into v_bkf  from dishes where category = 'breakfast' order by name_pt limit 1;
  select id into v_juices from addons where name_en = '5 Juices';
  select id into v_detox3 from addons where name_en = '3-Day Detox';
  select id into v_super  from addons where name_en = 'Super Detox';
  select id into v_green  from addon_variants where addon_id = v_super and name_en = 'Green #1';

  -- ===================================================================== 1
  -- CASO OBRIGATÓRIO (§5.6): plano 10+5 Small $128.60 + 1 extra Small 10
  -- $10.75 + 5 Juices $29.90  =>  $189.00
  raise notice 'teste 1 · caso obrigatorio $189.00';
  r := fn_price_order('plan', v_plan_s, v_s, v_s, 'delivery', jsonb_build_array(
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

  -- ===================================================================== 2
  -- Protótipo tela 6i: plano 10+5 Large $157.15 + 1 extra Large 10 $12.59
  -- + 5 Juices $29.90  =>  $221.52
  raise notice 'teste 2 · prototipo 6i $221.52';
  r := fn_price_order('plan', v_plan_l, v_l, v_l, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',11),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5),
         jsonb_build_object('type','addon','addon_id',v_juices,'qty',1)));
  perform assert_eq((r->>'taxable_cents')::int,  16974, 'taxable');
  perform assert_eq((r->>'tax_cents')::int,       1188, 'tax 7%');
  perform assert_eq((r->>'total_cents')::int,    22152, 'TOTAL');

  -- ===================================================================== 3
  -- Plano sem extra: 10+5 Small exato = $128.60 + tax + delivery
  raise notice 'teste 3 · plano exato, sem extra';
  r := fn_price_order('plan', v_plan_s, v_s, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',10),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5)));
  perform assert_eq((r->>'meals_extra')::int,        0, 'sem extra');
  perform assert_eq((r->>'tax_cents')::int,        900, 'tax de 12860');
  perform assert_eq((r->>'total_cents')::int,    14760, 'TOTAL $147.60');

  -- ===================================================================== 4
  -- Pick-up não cobra delivery (§6.6, pickup_charges_delivery = false)
  raise notice 'teste 4 · pick-up nao cobra delivery';
  r := fn_price_order('plan', v_plan_s, v_s, v_s, 'pickup', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',10),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',5)));
  perform assert_eq((r->>'delivery_cents')::int,     0, 'delivery zerado');
  perform assert_eq((r->>'total_cents')::int,    13760, 'TOTAL sem delivery');

  -- ===================================================================== 5
  -- Personalizado (tela 6c): 5 Small x $9.30 + 3 Large x $11.50 = $81.00,
  -- tax $5.67, delivery $10  =>  $96.67
  raise notice 'teste 5 · personalizado $96.67';
  r := fn_price_order('custom', null, v_s, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'size_id',v_s,'qty',5),
         jsonb_build_object('type','dish','dish_id',v_meal,'size_id',v_l,'qty',3)));
  perform assert_eq((r->>'taxable_cents')::int,   8100, 'subtotal 8 unidades');
  perform assert_eq((r->>'tax_cents')::int,        567, 'tax 7%');
  perform assert_eq((r->>'total_cents')::int,     9667, 'TOTAL $96.67');

  -- ===================================================================== 6
  -- Só adicionais: Detox sozinho, sem tax e sem delivery (§5.4)
  raise notice 'teste 6 · so detox, sem tax nem delivery';
  r := fn_price_order('addons_only', null, null, null, 'delivery', jsonb_build_array(
         jsonb_build_object('type','addon','addon_id',v_detox3,'qty',1)));
  perform assert_eq((r->>'taxable_cents')::int,       0, 'nada tributavel');
  perform assert_eq((r->>'tax_cents')::int,           0, 'sem tax');
  perform assert_eq((r->>'delivery_cents')::int,      0, 'sem delivery');
  perform assert_eq((r->>'total_cents')::int,     12624, 'TOTAL $126.24');

  -- ===================================================================== 7
  -- Sabor do kit é composição, não item com preço (senão cobraria o kit 3x)
  raise notice 'teste 7 · variacao do kit nao cobra';
  r := fn_price_order('addons_only', null, null, null, 'delivery', jsonb_build_array(
         jsonb_build_object('type','addon','addon_id',v_super,'qty',1),
         jsonb_build_object('type','addon','addon_id',v_super,'variant_id',v_green,'qty',8)));
  perform assert_eq((r->>'total_cents')::int, 20174, 'TOTAL = so o kit');
  perform assert_eq((r->>'kit_meals_allowance')::int, 5, 'Super Detox da 5 refeicoes');

  -- ===================================================================== 8
  -- §5.4: 5 Juices exige plano
  raise notice 'teste 8 · 5 Juices sozinho e recusado';
  begin
    r := fn_price_order('addons_only', null, null, null, 'delivery', jsonb_build_array(
           jsonb_build_object('type','addon','addon_id',v_juices,'qty',1)));
    raise exception 'FALHOU: 5 Juices sem plano deveria ter sido recusado';
  exception when others then
    if position('so pode ser vendido com um plano' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  recusado: %', sqlerrm;
  end;

  -- ===================================================================== 9
  -- Breakfast com tamanho próprio (planilha real W37, Boston pedido 10)
  raise notice 'teste 9 · breakfast em tamanho diferente do plano';
  r := fn_price_order('plan', v_plan_l, v_l, v_s, 'delivery', jsonb_build_array(
         jsonb_build_object('type','dish','dish_id',v_meal,'qty',10),
         jsonb_build_object('type','dish','dish_id',v_bkf, 'qty',6)));
  -- 1 breakfast extra, cobrado no unitário Small do plano 10+5 = $4.23
  perform assert_eq((r->>'breakfasts_extra')::int,    1, '1 breakfast extra');
  perform assert_eq((r->>'taxable_cents')::int,   16138, 'base 15715 + 423');

  raise notice 'PRICING OK';
end $test$;

-- ============================================================ classificação
-- Este bloco grava semanas e um cliente de teste; a transação inteira volta
-- atrás no rollback do fim do arquivo.
begin;

do $test$
declare
  v_cust uuid; v_w1 uuid; v_w2 uuid; v_menu uuid;
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

  -- sem histórico => primeira compra
  perform assert_eq(fn_classify_order(v_cust, v_w1), 'novo_pedido'::order_status,
                    'primeira compra');

  -- pediu na semana anterior => renovação (§6.3)
  insert into customer_weeks (customer_id, week_id, order_status)
    values (v_cust, v_w1, 'novo_pedido');
  perform assert_eq(fn_classify_order(v_cust, v_w2), 'renovacao'::order_status,
                    'pediu na semana anterior');

  -- estava em Skip => renovação (§6.3)
  update customer_weeks set order_status = 'skip'
    where customer_id = v_cust and week_id = v_w1;
  perform assert_eq(fn_classify_order(v_cust, v_w2), 'renovacao'::order_status,
                    'voltando de Skip');

  -- voltando de Cancelamento => novo pedido, mesmo sendo Old Lead (§6.3)
  update customer_weeks set order_status = 'cancelamento'
    where customer_id = v_cust and week_id = v_w1;
  perform assert_eq(fn_classify_order(v_cust, v_w2), 'novo_pedido'::order_status,
                    'voltando de Cancelamento');

  -- Old Lead nunca volta a New Lead (§6.2)
  update customers set lead_type = 'old' where id = v_cust;
  update customers set lead_type = 'new' where id = v_cust;
  perform assert_eq((select lead_type from customers where id = v_cust),
                    'old'::lead_type, 'Old Lead e irreversivel');

  raise notice 'CLASSIFICACAO OK';
end $test$;

rollback;

drop function assert_eq(anyelement, anyelement, text);
