-- LifeBox · bags para todos, e a folha segue a ordem do menu
-- Decidido na reunião com a LifeBox (22/09/2026).
--
-- 1) BAGS PARA TODOS. `customers.uses_thermal_bag` existia para o cliente que
--    recebia em sacola de papel. A LifeBox não trabalha mais assim: todo mundo
--    recebe bag térmica. A coluna sai, e com ela a exceção que atravessava o
--    saldo, a folha de montagem e a view de bags — uma regra a menos para
--    alguém esquecer.
--
--    Pick-up continua fora do controle: quem retira na cozinha leva na hora,
--    a bag não vai para a rua.
--
-- 2) ORDEM DO MENU. "a mesma sequência da montagem será do mesmo jeito que o
--    menu estiver organizado". A cozinha monta na ordem em que o menu está
--    escrito; a folha em ordem alfabética obrigava a procurar item por item.
--    `menu_dishes.position` passa a mandar em quem lê o menu — link público,
--    produção e montagem.

-- ------------------------------------------------------------- 1) bags
-- A ORDEM importa: a view referencia a coluna, então o DROP COLUMN só passa
-- depois de ela sair da view. Ao contrário, o Postgres manda usar CASCADE —
-- que levaria v_bag_collect e v_bag_estoque junto, sem avisar direito.

/** Saldo de bags por cliente (§6.7).
 *
 *  Sem o filtro de `uses_thermal_bag`: todo cliente entra no controle. */
create or replace view v_bag_balance
with (security_invoker = true) as
select c.id as customer_id,
       c.first_name, c.last_name, c.route_id,
       coalesce(sum(case bm.type when 'returned' then -bm.qty else bm.qty end), 0)::int as balance,
       min(bm.created_at) filter (where bm.type = 'sent') as first_sent_at,
       max(bm.created_at) as last_movement_at
  from customers c
  left join bag_movements bm on bm.customer_id = c.id
 group by c.id, c.first_name, c.last_name, c.route_id
having coalesce(sum(case bm.type when 'returned' then -bm.qty else bm.qty end), 0) <> 0;

/** Marca o pedido como montado e registra o envio das bags (§6.7).
 *
 *  Idempotente: chamar de novo ajusta a quantidade em vez de duplicar o
 *  movimento. Pick-up continua com 0 — o cliente retira na cozinha. */
create or replace function fn_marcar_montado(
  p_order uuid,
  p_bags  int default null,
  p_montado boolean default true
) returns jsonb
language plpgsql security invoker as $fn$
declare
  v_cliente uuid;
  v_week    uuid;
  v_ful     fulfillment_type;
  v_qtd     int;
begin
  select o.customer_id, o.week_id, o.fulfillment, coalesce(p_bags, o.bag_qty)
    into v_cliente, v_week, v_ful, v_qtd
    from orders o
   where o.id = p_order;

  if v_cliente is null then
    raise exception 'fn_marcar_montado: pedido % nao encontrado', p_order;
  end if;

  -- tela 11f: quem retira na cozinha leva na hora, a bag não vai para a rua
  if v_ful = 'pickup' then
    v_qtd := 0;
  end if;

  update orders
     set assembled_at = case when p_montado then now() else null end,
         bag_qty      = v_qtd
   where id = p_order;

  -- Desmarcar é desfazer um clique errado, não apagar história: se a bag já
  -- foi devolvida, remover o envio deixaria o saldo NEGATIVO.
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

  delete from bag_movements where order_id = p_order and type = 'sent';
  if p_montado and v_qtd > 0 then
    insert into bag_movements (customer_id, week_id, order_id, type, qty, created_by)
    values (v_cliente, v_week, p_order, 'sent', v_qtd, auth.uid());
  end if;

  return jsonb_build_object('order_id', p_order, 'montado', p_montado, 'bags', v_qtd);
end $fn$;

grant execute on function fn_marcar_montado(uuid, int, boolean) to authenticated;

-- agora sim: nada mais referencia a coluna
alter table customers drop column if exists uses_thermal_bag;

-- ---------------------------------------------------- 2) ordem do menu
alter table menu_dishes add column if not exists position int not null default 0;

comment on column menu_dishes.position is
  'Ordem em que o prato aparece no menu. A folha de montagem e a produção '
  'seguem esta ordem — a cozinha monta na sequência em que o menu está escrito.';

-- quem já estava no menu mantém a ordem alfabética que a tela mostrava,
-- para o número não pular de lugar na primeira vez que alguém abrir
do $ordem$
begin
  with numerado as (
    select md.menu_id, md.dish_id,
           (row_number() over (partition by md.menu_id order by d.name_pt))::int as pos
      from menu_dishes md join dishes d on d.id = md.dish_id
  )
  update menu_dishes md set position = n.pos
    from numerado n
   where n.menu_id = md.menu_id and n.dish_id = md.dish_id;
end $ordem$;
