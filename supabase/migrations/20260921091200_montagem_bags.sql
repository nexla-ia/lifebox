-- LifeBox · montagem de domingo e controle de bags térmicas
-- Ref: LIFEBOX_PROJECT.md §6.7, §9.9, §9.10 · telas 11a, 11b, 11c, 11f
--
-- "Marcar Montado registra o envio das bags daquele pedido" (§6.7). As duas
-- coisas numa função só: marcar sem baixar o estoque faria o saldo mentir, e
-- baixar sem marcar faria a folha de domingo mentir.

/** Marca o pedido como montado e registra o envio das bags.
 *
 *  Idempotente: chamar de novo ajusta a quantidade em vez de duplicar o
 *  movimento — na prática a equipe clica duas vezes, ou corrige o número
 *  depois de fechar a sacola. */
create or replace function fn_marcar_montado(
  p_order uuid,
  p_bags  int default null,
  p_montado boolean default true
) returns jsonb
language plpgsql security invoker as $fn$
declare
  v_cliente uuid;
  v_week    uuid;
  v_usa_bag boolean;
  v_ful     fulfillment_type;
  v_qtd     int;
begin
  select o.customer_id, o.week_id, c.uses_thermal_bag, o.fulfillment,
         coalesce(p_bags, o.bag_qty)
    into v_cliente, v_week, v_usa_bag, v_ful, v_qtd
    from orders o join customers c on c.id = o.customer_id
   where o.id = p_order;

  if v_cliente is null then
    raise exception 'fn_marcar_montado: pedido % nao encontrado', p_order;
  end if;

  -- §6.7: quem não usa bag térmica fica fora do controle. Pick-up também:
  -- o cliente retira na cozinha e leva em sacola de papel (tela 11f).
  if not v_usa_bag or v_ful = 'pickup' then
    v_qtd := 0;
  end if;

  update orders
     set assembled_at = case when p_montado then now() else null end,
         bag_qty      = v_qtd
   where id = p_order;

  -- Desmarcar é desfazer um clique errado, não apagar história: se a bag já
  -- foi devolvida, remover o envio deixaria o saldo NEGATIVO — a pessoa teria
  -- devolvido algo que o sistema diz que nunca saiu.
  if not p_montado and exists (
    select 1 from bag_movements
     where customer_id = v_cliente and type = 'returned'
       and created_at >= coalesce(
             (select min(created_at) from bag_movements
               where order_id = p_order and type = 'sent'), now())
  ) then
    raise exception
      'Não dá para desmarcar: já existe devolução registrada para este cliente. '
      'Ajuste a devolução primeiro.';
  end if;

  -- um movimento de envio por pedido: refaz em vez de empilhar
  delete from bag_movements where order_id = p_order and type = 'sent';
  if p_montado and v_qtd > 0 then
    insert into bag_movements (customer_id, week_id, order_id, type, qty, created_by)
    values (v_cliente, v_week, p_order, 'sent', v_qtd, auth.uid());
  end if;

  return jsonb_build_object('order_id', p_order, 'montado', p_montado, 'bags', v_qtd);
end $fn$;

/** Registra devolução de bags na ficha do cliente (§6.7). */
create or replace function fn_registrar_devolucao(
  p_customer uuid, p_qtd int, p_week uuid default null
) returns void
language plpgsql security invoker as $fn$
begin
  if p_qtd <= 0 then
    raise exception 'fn_registrar_devolucao: quantidade tem de ser positiva';
  end if;
  insert into bag_movements (customer_id, week_id, type, qty, created_by)
  values (p_customer, coalesce(p_week, fn_semana_atual()), 'returned', p_qtd, auth.uid());
end $fn$;

-- ---------------------------------------------------------------- coleta
/** Lista priorizada de coleta (§6.7).
 *
 *  A ordem não é por saldo nem por antiguidade pura: é pelo risco de a bag
 *  não voltar. Quem saiu da semana (Skip ou Cancelamento) some do radar, então
 *  vem primeiro; depois quem está há muito tempo com ela.
 *
 *    1. Skip ou Cancelamento na semana corrente, com bag em posse
 *    2. mais de N semanas em posse (bag_collect_after_weeks em settings)
 *    3. demais saldos
 */
create or replace view v_bag_collect
with (security_invoker = true) as
with semana as (
  select id from weeks
   where fn_hoje_operacional() between starts_on and ends_on
   limit 1
),
saldo as (
  select b.customer_id, b.first_name, b.last_name, b.route_id, b.balance,
         b.first_sent_at,
         floor(extract(epoch from (now() - b.first_sent_at)) / (7 * 86400))::int as semanas
    from v_bag_balance b
   where b.balance > 0
)
select s.customer_id, s.first_name, s.last_name, s.route_id, s.balance,
       s.semanas,
       cw.order_status,
       case
         when cw.order_status in ('skip', 'cancelamento') then 1
         when s.semanas > coalesce(
                (select (value #>> '{}')::int from settings
                  where key = 'bag_collect_after_weeks'), 3) then 2
         else 3
       end as prioridade,
       case
         when cw.order_status in ('skip', 'cancelamento')
           then 'Saiu da semana com bag em posse'
         when s.semanas > coalesce(
                (select (value #>> '{}')::int from settings
                  where key = 'bag_collect_after_weeks'), 3)
           then 'Mais de ' || coalesce(
                (select (value #>> '{}') from settings
                  where key = 'bag_collect_after_weeks'), '3') || ' semanas em posse'
         else 'Saldo normal'
       end as motivo
  from saldo s
  left join customer_weeks cw
    on cw.customer_id = s.customer_id
   and cw.week_id = (select id from semana);

/** Resumo do estoque (tela 11b). */
create or replace view v_bag_estoque
with (security_invoker = true) as
select
  coalesce((select (value #>> '{}')::int from settings where key = 'bag_stock_total'), 0) as total,
  coalesce((select sum(balance)::int from v_bag_balance where balance > 0), 0) as na_rua,
  coalesce((select count(*)::int from v_bag_balance where balance > 0), 0) as clientes_com_bag,
  coalesce((select sum(balance)::int from v_bag_collect where prioridade <= 2), 0) as a_coletar;

grant select on v_bag_collect, v_bag_estoque to authenticated;
grant execute on function fn_marcar_montado(uuid, int, boolean) to authenticated;
grant execute on function fn_registrar_devolucao(uuid, int, uuid) to authenticated;
