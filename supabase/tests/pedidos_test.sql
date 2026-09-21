-- LifeBox · testes de fn_create_order (§2, §4, §6.3, §6.4)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pedidos_test.sql
--
-- Monta a propria massa e desfaz no fim. So precisa do seed BASE.

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

-- fixture: plano 10+5 com precos, um prato e um breakfast
do $fx$
declare v_plan uuid; v_s uuid;
begin
  select id into v_s from sizes where code = 'S';
  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('TESTE PED', 'TEST ORD', 10, 5) returning id into v_plan;
  insert into plan_prices (plan_id, size_id, base_price_cents) values (v_plan, v_s, 12860);
  insert into extra_prices (plan_id, size_id, item_kind, unit_price_cents) values
    (v_plan, v_s, 'meal', 1075), (v_plan, v_s, 'breakfast', 423);
  insert into dishes (name_pt, name_en, category) values
    ('Prato ped', 'Dish ord', 'classico'), ('Bkf ped', 'Bkf ord', 'breakfast');
  insert into customers (first_name, phone_e164) values ('Pedido Teste', '+15550007777');
end $fx$;

do $t$
declare
  v_c uuid; v_w uuid; v_w2 uuid; v_wv uuid; v_plan uuid; v_s uuid;
  v_meal uuid; v_bkf uuid; v_outro uuid;
  r jsonb; v_o uuid;
begin
  select id into v_c    from customers where phone_e164 = '+15550007777';
  select id into v_plan from plans     where name_en = 'TEST ORD';
  select id into v_s    from sizes     where code = 'S';
  select id into v_meal from dishes    where name_en = 'Dish ord';
  select id into v_bkf  from dishes    where name_en = 'Bkf ord';

  v_w := fn_ensure_week(fn_hoje_operacional());

  raise notice 'pedido com 1 extra';
  r := fn_create_order(jsonb_build_object(
        'customer_id', v_c, 'week_id', v_w, 'kind', 'plan',
        'plan_id', v_plan, 'size_id', v_s, 'fulfillment', 'delivery',
        'items', jsonb_build_array(
          jsonb_build_object('type', 'dish', 'dish_id', v_meal, 'qty', 11),
          jsonb_build_object('type', 'dish', 'dish_id', v_bkf,  'qty', 5))));
  v_o := (r->>'order_id')::uuid;

  perform assert_eq((r->'pricing'->>'taxable_cents')::int, 13935, 'taxable no servidor');
  perform assert_eq((r->'pricing'->>'total_cents')::int,   15910, 'total 12860+1075+975+1000');
  perform assert_eq((select total_cents from orders where id = v_o), 15910, 'gravado no pedido');

  raise notice 'codigo do pedido';
  perform assert_eq(r->>'code',
                    substring((select iso_code from weeks where id = v_w) from 6) || '-0001',
                    'primeiro da semana');

  raise notice 'itens com snapshot';
  perform assert_eq((select sum(qty)::int from order_items
                      where order_id = v_o and item_type = 'dish'), 16,
                    'pratos que a cozinha faz');
  perform assert_eq((select qty from order_items
                      where order_id = v_o and item_type = 'extra'), 1, 'linha de extra');
  perform assert_eq((select name_snapshot from order_items
                      where order_id = v_o and dish_id = v_meal), 'Prato ped', 'nome congelado');

  raise notice 'classificacao';
  perform assert_eq(r->>'order_status', 'novo_pedido', 'primeira compra');
  perform assert_eq((select order_status from customer_weeks
                      where customer_id = v_c and week_id = v_w),
                    'novo_pedido'::order_status, 'linha da semana criada');

  raise notice 'quem pediu deixa de ser New Lead';
  perform assert_eq((select lead_type from customers where id = v_c),
                    'old'::lead_type, 'virou Old Lead');
  perform assert_eq((select status from customers where id = v_c),
                    'ativo'::customer_status, 'virou ativo');

  raise notice 'um pedido por cliente por semana';
  begin
    perform fn_create_order(jsonb_build_object(
      'customer_id', v_c, 'week_id', v_w, 'kind', 'plan',
      'plan_id', v_plan, 'size_id', v_s, 'items', '[]'::jsonb));
    raise exception 'FALHOU: aceitou segundo pedido na mesma semana';
  exception when others then
    if position('ja tem pedido nesta semana' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  recusado: %', sqlerrm;
  end;

  raise notice 'semana seguinte vira Renovacao';
  v_w2 := fn_ensure_week(fn_hoje_operacional() + 7);
  r := fn_create_order(jsonb_build_object(
        'customer_id', v_c, 'week_id', v_w2, 'kind', 'plan',
        'plan_id', v_plan, 'size_id', v_s,
        'items', jsonb_build_array(
          jsonb_build_object('type', 'dish', 'dish_id', v_meal, 'qty', 10),
          jsonb_build_object('type', 'dish', 'dish_id', v_bkf,  'qty', 5))));
  perform assert_eq(r->>'order_status', 'renovacao', 'pediu na semana anterior');
  perform assert_eq((r->'pricing'->>'total_cents')::int, 14760, 'sem extra');

  raise notice 'parceria';
  insert into customers (first_name, phone_e164)
    values ('Parceira', '+15550008888') returning id into v_outro;
  r := fn_create_order(jsonb_build_object(
        'customer_id', v_outro, 'week_id', v_w, 'kind', 'plan',
        'plan_id', v_plan, 'size_id', v_s, 'is_partnership', true,
        'items', jsonb_build_array(
          jsonb_build_object('type', 'dish', 'dish_id', v_meal, 'qty', 10),
          jsonb_build_object('type', 'dish', 'dish_id', v_bkf,  'qty', 5))));
  perform assert_eq(r->>'order_status', 'parceria', 'status parceria');
  perform assert_eq((select total_cents from orders where id = (r->>'order_id')::uuid), 0,
                    'valor pago zero');
  perform assert_eq((select commercial_value_cents from orders where id = (r->>'order_id')::uuid),
                    14760, 'valor comercial = preco normal');

  raise notice 'pos-cutoff';
  v_wv := fn_ensure_week(fn_hoje_operacional() - 30);
  insert into customers (first_name, phone_e164)
    values ('Atrasado', '+15550009999') returning id into v_outro;
  r := fn_create_order(jsonb_build_object(
        'customer_id', v_outro, 'week_id', v_wv, 'kind', 'plan',
        'plan_id', v_plan, 'size_id', v_s,
        'items', jsonb_build_array(
          jsonb_build_object('type', 'dish', 'dish_id', v_meal, 'qty', 10))));
  perform assert_eq((r->>'post_cutoff')::boolean, true, 'marcado como pos-cutoff');

  raise notice 'rpc_precificar nao grava nada';
  perform assert_eq(
    (rpc_precificar(jsonb_build_object(
      'kind', 'plan', 'plan_id', v_plan, 'size_id', v_s, 'fulfillment', 'delivery',
      'items', jsonb_build_array(
        jsonb_build_object('type', 'dish', 'dish_id', v_meal, 'qty', 10))))
     ->>'total_cents')::int,
    14760, 'preco de previa');

  raise notice 'status da semana sem pedido';
  insert into customers (first_name, phone_e164)
    values ('Pausada', '+15550006666') returning id into v_outro;
  perform fn_set_week_status(v_outro, v_w, 'skip');
  perform assert_eq((select order_status from customer_weeks where customer_id = v_outro),
                    'skip'::order_status, 'Skip existe sem pedido');

  raise notice 'PEDIDOS OK';
end $t$;

rollback;
