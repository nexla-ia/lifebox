-- LifeBox · views
-- Ref: LIFEBOX_PROJECT.md §7 "Views e funções" · telas 3a, 9.1, 11b

-- ------------------------------------------------------------ produção §9.3
-- Agregado por prato e tamanho, SEM adicionais: sucos e Detox saem do estoque,
-- não da cozinha (§5.4). Conta só item_type='dish' — a linha 'extra' é preço,
-- o prato dela já está contado numa linha 'dish'.
-- É a view que o perfil Cozinha lê: sem valor, sem contato, sem endereço (§3).
create view v_production
with (security_invoker = false) as
select o.week_id,
       oi.dish_id,
       oi.name_snapshot    as dish_name_pt,
       oi.category_snapshot as category,
       s.code              as size_code,
       sum(oi.qty)::int    as qty,
       bool_or(o.post_cutoff) as has_post_cutoff,
       sum(oi.qty) filter (where o.post_cutoff)::int as qty_post_cutoff
  from order_items oi
  join orders o  on o.id = oi.order_id
  left join sizes s on s.id = oi.size_id
 where oi.item_type = 'dish'
 group by o.week_id, oi.dish_id, oi.name_snapshot, oi.category_snapshot, s.code;

-- §6.8 restrições e alergias no topo da folha. Primeiro nome + inicial:
-- a cozinha precisa saber de quem é a nota, mas não recebe contato nem endereço.
create view v_kitchen_notes
with (security_invoker = false) as
select o.week_id,
       o.id as order_id,
       c.first_name || ' ' || coalesce(left(c.last_name, 1) || '.', '') as customer_label,
       c.kitchen_notes
  from orders o
  join customers c on c.id = o.customer_id
 where coalesce(c.kitchen_notes, '') <> '';

-- ---------------------------------------------------------- semana §6.4, 9.1
-- Total Pedidos = Novo Pedido + Renovação. Skip, Cancelamento e Parceria ficam
-- fora. Conversão conta na semana do pedido; faturamento só o que está pago.
-- security_invoker = true: a RLS das tabelas de baixo vale. A Cozinha não lê
-- orders nem customers, então esta view devolve vazio para ela.
create view v_week_summary
with (security_invoker = true) as
select w.id as week_id,
       w.iso_code,
       count(*) filter (where cw.order_status = 'novo_pedido')       as novo_pedido,
       count(*) filter (where cw.order_status = 'renovacao')         as renovacao,
       count(*) filter (where cw.order_status = 'skip')              as skip,
       count(*) filter (where cw.order_status = 'cancelamento')      as cancelamento,
       count(*) filter (where cw.order_status = 'parceria')          as parceria,
       count(*) filter (where cw.order_status = 'follow_up')         as follow_up,
       count(*) filter (where cw.order_status = 'aguardando_selecao') as aguardando_selecao,
       count(*) filter (where cw.order_status in ('novo_pedido','renovacao')) as total_pedidos,
       coalesce(sum(o.total_cents) filter (
         where cw.order_status in ('novo_pedido','renovacao')), 0)::int as pedidos_cents,
       coalesce(sum(o.total_cents) filter (
         where cw.order_status in ('novo_pedido','renovacao')
           and o.payment_status = 'confirmado'), 0)::int as faturado_cents,
       coalesce(sum(o.total_cents) filter (
         where cw.order_status in ('novo_pedido','renovacao')
           and o.payment_status <> 'confirmado'), 0)::int as a_receber_cents,
       coalesce(sum(o.commercial_value_cents) filter (
         where cw.order_status = 'parceria'), 0)::int as parceria_valor_comercial_cents
  from weeks w
  left join customer_weeks cw on cw.week_id = w.id
  left join orders o          on o.id = cw.order_id
 group by w.id, w.iso_code;

-- ---------------------------------------------------------------- bags §6.7
-- Saldo por cliente a partir das movimentações. Clientes com
-- uses_thermal_bag = false ficam fora do controle.
create view v_bag_balance
with (security_invoker = true) as
select c.id as customer_id,
       c.first_name, c.last_name, c.route_id,
       coalesce(sum(case bm.type when 'returned' then -bm.qty else bm.qty end), 0)::int as balance,
       min(bm.created_at) filter (where bm.type = 'sent') as first_sent_at,
       max(bm.created_at) as last_movement_at
  from customers c
  left join bag_movements bm on bm.customer_id = c.id
 where c.uses_thermal_bag
 group by c.id, c.first_name, c.last_name, c.route_id
having coalesce(sum(case bm.type when 'returned' then -bm.qty else bm.qty end), 0) <> 0;
