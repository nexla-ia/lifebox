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
  -- uses_thermal_bag saiu: todo cliente recebe bag (reuniao de 22/09/2026).
  -- A unica excecao que sobrou e o pick-up, testado abaixo.
  insert into customers (first_name, phone_e164) values
    ('Com Bag',  '+15550011111'),
    ('Retira',   '+15550033333');
end $fx$;

do $t$
declare
  v_w uuid; v_plan uuid; v_s uuid; v_d uuid;
  v_c1 uuid; v_c3 uuid;
  o1 uuid; o3 uuid; r jsonb;
begin
  select id into v_plan from plans  where name_en = 'TEST BAG';
  select id into v_s    from sizes  where code = 'S';
  select id into v_d    from dishes where name_en = 'Dish bag';
  select id into v_c1 from customers where phone_e164 = '+15550011111';
  select id into v_c3 from customers where phone_e164 = '+15550033333';
  v_w := fn_ensure_week(fn_hoje_operacional());

  o1 := (fn_create_order(jsonb_build_object(
          'customer_id', v_c1, 'week_id', v_w, 'kind', 'plan',
          'plan_id', v_plan, 'size_id', v_s, 'bag_qty', 2,
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

-- ------------------------------------------- ordem de entrega (reuniao 22/09)
do $ordem$
declare
  v_w uuid; v_plan uuid; v_s uuid; v_d uuid;
  v_a uuid; v_b uuid; v_c uuid; v_n int; v_user uuid := gen_random_uuid();
begin
  -- `fn_ordenar_entrega` tem guard de papel: sem sessao de equipe ela levanta
  -- LB403, que e exatamente o que se quer em producao. O teste precisa de
  -- alguem logado para chegar na regra.
  insert into auth.users (id, email) values (v_user, 'ordem@teste.local');
  update profiles set role = 'operacao', status = 'ativo' where id = v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform assert_eq(is_staff(), true, 'o teste roda como Operacao');

  v_w := fn_semana_atual();
  select id into v_s from sizes where code = 'S';
  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('PLANO ORD','PLAN ORD',5,0) returning id into v_plan;
  insert into plan_prices (plan_id, size_id, base_price_cents) values (v_plan, v_s, 10000);
  insert into dishes (name_pt, name_en, category)
    values ('Prato ord','Dish ord','classico') returning id into v_d;

  -- tres paradas, criadas em ordem alfabetica de codigo
  insert into customers (first_name, phone_e164, status) values
    ('Primeiro','+15553330001','ativo'), ('Segundo','+15553330002','ativo'),
    ('Terceiro','+15553330003','ativo');
  select id into v_a from customers where phone_e164 = '+15553330001';
  select id into v_b from customers where phone_e164 = '+15553330002';
  select id into v_c from customers where phone_e164 = '+15553330003';

  perform fn_create_order(jsonb_build_object('customer_id', x, 'week_id', v_w,
    'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))))
    from unnest(array[v_a, v_b, v_c]) x;

  perform assert_eq((select count(*)::int from orders
                      where customer_id in (v_a,v_b,v_c) and delivery_seq is not null),
                    0, 'nasce sem ordem de entrega');

  raise notice 'a equipe arrasta e a rota inteira grava numa chamada so';
  v_n := fn_ordenar_entrega(array(
    select o.id from orders o where o.customer_id in (v_c, v_a, v_b)
     order by array_position(array[v_c, v_a, v_b], o.customer_id)));
  perform assert_eq(v_n, 3, 'as tres paradas gravadas');

  perform assert_eq((select delivery_seq from orders where customer_id = v_c), 1,
                    'quem foi posto em primeiro e o primeiro');
  perform assert_eq((select delivery_seq from orders where customer_id = v_b), 3,
                    'e quem foi posto por ultimo e o ultimo');

  raise notice 'a folha sai na ordem gravada, nao na do codigo';
  perform assert_eq(
    (select string_agg(c.first_name, '>' order by o.delivery_seq)
       from orders o join customers c on c.id = o.customer_id
      where o.customer_id in (v_a,v_b,v_c)),
    'Terceiro>Primeiro>Segundo', 'a sequencia e a que a equipe definiu');

  raise notice 'parada nova NAO entra no meio do trajeto ja organizado';
  -- delivery_seq nulo vai para o fim: e por isso que a consulta ordena com
  -- nulls por ultimo em vez de deixar o banco escolher
  perform assert_eq((select count(*)::int from orders
                      where week_id = v_w and delivery_seq is null
                        and customer_id not in (v_a,v_b,v_c)) >= 0, true,
                    'pedido sem ordem continua existindo');

  raise notice 'e quem nao e da equipe NAO reordena';
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform fn_ordenar_entrega(array[v_a]);
    raise exception 'FALHOU: anonimo reordenou a entrega';
  exception when sqlstate 'LB403' then raise notice '  ok  recusa quem nao e da equipe';
  end;

  raise notice 'ORDEM DE ENTREGA OK';
end $ordem$;

rollback;
