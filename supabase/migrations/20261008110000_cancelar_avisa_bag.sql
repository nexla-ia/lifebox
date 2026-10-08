-- LifeBox · cancelar pedido montado deixa a bag com o cliente, e isso tem de
-- aparecer
-- Ref: caça de bugs de 08/10/2026
--
-- Medido: pedido marcado como montado (2 bags enviadas), depois cancelado na
-- rotina de sexta. A produção zerou, a parada saiu da folha de montagem e o
-- pedido saiu da fila de pagamento — tudo certo. Mas o saldo de bag do cliente
-- continuou em 2, e nenhuma tela disse isso.
--
-- O saldo está CERTO: a bag saiu fisicamente, e cancelar pagamento não a traz
-- de volta. O problema é o silêncio. A parada some da folha no mesmo instante,
-- então a bag vira uma que sumiu do controle sem ninguém notar — e isso só
-- aparece semanas depois, faltando bag na cozinha, que é exatamente o modo de
-- falha que o §6.7 existe para evitar.

create or replace function fn_cancelar_sem_pagamento(p_order uuid, p_motivo text default null)
returns jsonb
language plpgsql security invoker as $fn$
declare
  o orders%rowtype;
  v_restantes int;
  v_prox uuid;
  v_fim date;
begin
  if not is_staff() then
    raise exception 'Só a equipe cancela pedido.' using errcode = 'LB403';
  end if;

  select * into o from orders where id = p_order;
  if o.id is null then
    raise exception 'Pedido não encontrado.' using errcode = 'LB409';
  end if;
  if o.canceled_at is not null then
    raise exception 'Esse pedido já foi cancelado.' using errcode = 'LB409';
  end if;
  -- cancelar pedido PAGO não é rotina de sexta, é estorno: outra conversa,
  -- com dinheiro de volta. A função recusa em vez de fingir que resolve.
  if o.payment_status = 'confirmado' then
    raise exception 'Esse pedido está pago. Cancelar pagamento é outra operação.'
      using errcode = 'LB409';
  end if;

  update orders
     set canceled_at = now(),
         cancel_reason = coalesce(nullif(trim(p_motivo), ''), 'sem pagamento até sexta'),
         updated_at = now()
   where id = p_order;

  -- a pessoa só vira Cancelamento se não lhe sobrar pedido ativo na semana
  select count(*) into v_restantes
    from orders
   where customer_id = o.customer_id and week_id = o.week_id and canceled_at is null;

  if v_restantes = 0 then
    update customer_weeks set order_status = 'cancelamento'
     where customer_id = o.customer_id and week_id = o.week_id;

    -- §6.4: e entra em follow_up na semana SEGUINTE, que é o que faz a equipe
    -- lembrar de chamar. Sem isso o cliente cancelado simplesmente some.
    select ends_on into v_fim from weeks where id = o.week_id;
    v_prox := fn_ensure_week(v_fim + 1);
    insert into customer_weeks (customer_id, week_id, order_status)
    values (o.customer_id, v_prox, 'follow_up')
        on conflict (customer_id, week_id) do nothing;
  end if;

  insert into audit_log (entity, entity_id, action, after)
  values ('order', p_order, 'cancelado_sem_pagamento',
          jsonb_build_object('motivo', p_motivo, 'restantes', v_restantes));

  return jsonb_build_object(
    'order_id', p_order,
    'cliente_cancelado', v_restantes = 0,
    'follow_up_em', (select iso_code from weeks where id = v_prox),
    -- Se a sacola JÁ tinha sido montada, a bag saiu de verdade e continua com
    -- o cliente: cancelar pagamento não traz bag de volta. O saldo fica como
    -- está, de propósito — o que não pode é a equipe não saber. A parada some
    -- da folha de montagem no mesmo instante, então sem este aviso a bag vira
    -- uma que some do controle sem ninguém notar.
    'ja_montado', o.assembled_at is not null,
    'bags_com_o_cliente', case when o.assembled_at is not null then o.bag_qty else 0 end);
end $fn$;
