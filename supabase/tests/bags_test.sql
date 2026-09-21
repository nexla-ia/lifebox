-- LifeBox · testes de montagem e bags (§6.7)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bags_test.sql
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

do $fx$
declare v_plan uuid; v_s uuid;
begin
  select id into v_s from sizes where code = 'S';
  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('TESTE BAG', 'TEST BAG', 10, 0) returning id into v_plan;
  insert into plan_prices (plan_id, size_id, base_price_cents) values (v_plan, v_s, 10000);
  insert into dishes (name_pt, name_en, category) values ('Prato bag', 'Dish bag', 'classico');
  insert into customers (first_name, phone_e164, uses_thermal_bag) values
    ('Com Bag',  '+15550011111', true),
    ('So Papel', '+15550022222', false),
    ('Retira',   '+15550033333', true);
end $fx$;

do $t$
declare
  v_w uuid; v_plan uuid; v_s uuid; v_d uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  o1 uuid; o2 uuid; o3 uuid; r jsonb;
begin
  select id into v_plan from plans  where name_en = 'TEST BAG';
  select id into v_s    from sizes  where code = 'S';
  select id into v_d    from dishes where name_en = 'Dish bag';
  select id into v_c1 from customers where phone_e164 = '+15550011111';
  select id into v_c2 from customers where phone_e164 = '+15550022222';
  select id into v_c3 from customers where phone_e164 = '+15550033333';
  v_w := fn_ensure_week(fn_hoje_operacional());

  o1 := (fn_create_order(jsonb_build_object(
          'customer_id', v_c1, 'week_id', v_w, 'kind', 'plan',
          'plan_id', v_plan, 'size_id', v_s, 'bag_qty', 2,
          'items', jsonb_build_array(
            jsonb_build_object('type','dish','dish_id',v_d,'qty',10))))->>'order_id')::uuid;
  o2 := (fn_create_order(jsonb_build_object(
          'customer_id', v_c2, 'week_id', v_w, 'kind', 'plan',
          'plan_id', v_plan, 'size_id', v_s,
          'items', jsonb_build_array(
            jsonb_build_object('type','dish','dish_id',v_d,'qty',10))))->>'order_id')::uuid;
  o3 := (fn_create_order(jsonb_build_object(
          'customer_id', v_c3, 'week_id', v_w, 'kind', 'plan',
          'plan_id', v_plan, 'size_id', v_s, 'fulfillment', 'pickup',
          'items', jsonb_build_array(
            jsonb_build_object('type','dish','dish_id',v_d,'qty',10))))->>'order_id')::uuid;

  raise notice 'marcar montado registra o envio';
  r := fn_marcar_montado(o1);
  perform assert_eq((r->>'bags')::int, 2, 'usa o bag_qty do pedido');
  perform assert_eq((select assembled_at is not null from orders where id = o1), true, 'montado');
  perform assert_eq((select qty from bag_movements where order_id = o1 and type = 'sent'),
                    2, 'movimento de envio criado');
  perform assert_eq((select balance from v_bag_balance where customer_id = v_c1),
                    2, 'saldo do cliente');

  raise notice 'clicar de novo nao duplica o movimento';
  perform fn_marcar_montado(o1);
  perform assert_eq((select count(*)::int from bag_movements
                      where order_id = o1 and type = 'sent'), 1, 'um movimento so');

  raise notice 'corrigir a quantidade ajusta em vez de somar';
  perform fn_marcar_montado(o1, 1);
  perform assert_eq((select balance from v_bag_balance where customer_id = v_c1),
                    1, 'saldo corrigido');

  raise notice 'desmarcar remove o envio';
  perform fn_marcar_montado(o1, null, false);
  perform assert_eq((select assembled_at from orders where id = o1), null, 'desmontado');
  perform assert_eq((select count(*)::int from v_bag_balance where customer_id = v_c1),
                    0, 'saldo zerado sai da view');
  perform fn_marcar_montado(o1, 2);   -- volta para os testes seguintes

  raise notice 'quem nao usa bag termica fica fora do controle';
  r := fn_marcar_montado(o2);
  perform assert_eq((r->>'bags')::int, 0, 'nenhuma bag enviada');
  perform assert_eq((select count(*)::int from bag_movements where order_id = o2),
                    0, 'sem movimento');

  raise notice 'pick-up nao leva bag — o cliente retira na cozinha';
  r := fn_marcar_montado(o3);
  perform assert_eq((r->>'bags')::int, 0, 'nenhuma bag no pick-up');

  raise notice 'desmarcar com devolucao registrada e recusado';
  perform fn_registrar_devolucao(v_c1, 1, v_w);
  begin
    perform fn_marcar_montado(o1, null, false);
    raise exception 'FALHOU: desmarcou com devolucao registrada, saldo ficaria negativo';
  exception when others then
    if position('devolucao registrada' in sqlerrm) = 0
       and position('devolução registrada' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  recusado: saldo nao fica negativo';
  end;

  raise notice 'devolucao abate o saldo';
  perform assert_eq((select balance from v_bag_balance where customer_id = v_c1),
                    1, 'saldo apos devolver 1 de 2');
  begin
    perform fn_registrar_devolucao(v_c1, 0, v_w);
    raise exception 'FALHOU: aceitou devolucao de zero';
  exception when others then
    if position('positiva' in sqlerrm) = 0 then raise; end if;
    raise notice '  ok  recusa devolucao invalida';
  end;

  raise notice 'lista de coleta priorizada';
  -- cliente com bag e em Skip: vai para o topo
  perform fn_set_week_status(v_c1, v_w, 'skip');
  perform assert_eq((select prioridade from v_bag_collect where customer_id = v_c1),
                    1, 'Skip com bag e prioridade 1');
  perform assert_eq((select motivo from v_bag_collect where customer_id = v_c1),
                    'Saiu da semana com bag em posse', 'motivo');

  -- de volta a renovacao: cai para prioridade 3 (poucas semanas em posse)
  perform fn_set_week_status(v_c1, v_w, 'renovacao');
  perform assert_eq((select prioridade from v_bag_collect where customer_id = v_c1),
                    3, 'sem risco, prioridade 3');

  raise notice 'estoque';
  perform assert_eq((select na_rua from v_bag_estoque), 1, 'bags na rua');
  perform assert_eq((select clientes_com_bag from v_bag_estoque), 1, 'clientes com bag');

  raise notice 'BAGS OK';
end $t$;

rollback;
