-- LifeBox · rotina de sexta (§6.4)
-- Ref: LIFEBOX_PROJECT.md §6.4 e §2 ("Sexta, fim do dia: rotina de pagamento")
--
-- "Pedidos sem pagamento entram em Precisa de ação como 'Sem pagamento,
--  cancelar da semana?', com os botões Cancelar e Dar mais prazo. Ao cancelar,
--  o status da semana vira `cancelamento` e o cliente entra em `follow_up` na
--  semana seguinte."
--
-- DUAS COISAS que o §6.4 não previa, porque é anterior a elas:
--
-- 1) O mesmo cliente pode ter MAIS DE UM pedido na semana (22/09/2026). O
--    status de `customer_weeks` é da PESSOA — cancelar por ali mataria também
--    o pedido que ela pagou. Por isso o cancelamento é do PEDIDO
--    (`orders.canceled_at`), e a pessoa só vira `cancelamento` na semana
--    quando não lhe sobrar nenhum pedido ativo.
--
-- 2) Cancelar tem de tirar a comida da produção. `v_production` somava
--    `order_items` sem olhar status nenhum: a equipe cancelaria na sexta e a
--    cozinha faria o prato no sábado do mesmo jeito. Vale para a folha de
--    montagem também — a parada continuaria na rota.

alter table orders add column if not exists canceled_at timestamptz;
alter table orders add column if not exists cancel_reason text;
alter table orders add column if not exists payment_grace_until timestamptz;

comment on column orders.canceled_at is
  'Pedido cancelado na rotina de sexta (§6.4). Sai da produção, da montagem e '
  'do faturamento — mas continua existindo, porque é a história do cliente que '
  'explica o follow-up da semana seguinte.';
comment on column orders.payment_grace_until is
  'Prazo dado pela equipe: até aqui o pedido não volta a cobrar na tela.';

create index if not exists orders_ativos_idx on orders (week_id) where canceled_at is null;

insert into settings (key, value, description)
select 'payment_grace_days', '1'::jsonb,
       'Quantos dias o botão "Dar mais prazo" silencia o pedido na rotina de sexta.'
 where not exists (select 1 from settings where key = 'payment_grace_days');

-- ----------------------------------------------------------------- a fila
/** O que a sexta tem de decidir: pedido da semana sem pagamento.
 *
 *  Fora da lista, de propósito:
 *    · quem já mandou comprovante — isso é "conferir", outra fila, outro botão;
 *    · quem está dentro do prazo que a equipe deu;
 *    · Skip, Cancelamento e Parceria, que nunca foram pedido a pagar.
 *
 *  Não filtra por "hoje é sexta": a equipe pode olhar na quinta para adiantar,
 *  e pode olhar no sábado porque a sexta foi corrida. Quem decide quando é a
 *  pessoa, não o calendário. */
create or replace function fn_pendencias_pagamento(p_week uuid)
returns table (
  order_id uuid, code text, cliente text, telefone text,
  total_cents int, criado_em timestamptz, prazo_ate timestamptz
)
language sql stable security invoker as $fn$
  select o.id, o.code,
         (c.first_name || ' ' || coalesce(c.last_name, ''))::text,
         coalesce(o.phone_e164, c.phone_e164),
         o.total_cents, o.created_at, o.payment_grace_until
    from orders o
    join customers c on c.id = o.customer_id
    join customer_weeks cw
      on cw.customer_id = o.customer_id and cw.week_id = o.week_id
   where o.week_id = p_week
     and o.canceled_at is null
     and o.payment_status = 'aguardando_pagamento'
     and cw.order_status in ('novo_pedido', 'renovacao')
     and (o.payment_grace_until is null or o.payment_grace_until < now())
   order by o.created_at
$fn$;

/** Cancela o pedido por falta de pagamento (§6.4).
 *
 *  Numa transação só: o pedido sai, a pessoa é reclassificada se não lhe
 *  sobrar nada, e ela entra em follow_up na semana seguinte. Meio caminho
 *  deixaria pedido cancelado ainda contando como Renovação — ou pior, saindo
 *  na folha da cozinha. */
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
    'follow_up_em', (select iso_code from weeks where id = v_prox));
end $fn$;

/** Dá mais prazo: o pedido para de cobrar até o fim do prazo.
 *
 *  Precisa ficar GRAVADO. Silenciar só na tela faria o aviso voltar no próximo
 *  F5, e a equipe decidiria a mesma coisa cinco vezes. */
create or replace function fn_dar_prazo_pagamento(p_order uuid, p_dias int default null)
returns jsonb
language plpgsql security invoker as $fn$
declare v_dias int; v_ate timestamptz;
begin
  if not is_staff() then
    raise exception 'Só a equipe dá prazo.' using errcode = 'LB403';
  end if;

  v_dias := coalesce(p_dias, setting_num('payment_grace_days')::int, 1);
  if v_dias < 1 or v_dias > 30 then
    raise exception 'Prazo tem de ser entre 1 e 30 dias.' using errcode = 'LB400';
  end if;

  -- fim do dia no fuso da operação, não 24h corridas: "mais um dia" para quem
  -- está na cozinha é até o fim de amanhã, não até esta hora de amanhã
  v_ate := ((fn_hoje_operacional() + v_dias)::timestamp + time '23:59:59')
             at time zone fn_fuso_operacional();

  update orders set payment_grace_until = v_ate, updated_at = now()
   where id = p_order and canceled_at is null;
  if not found then
    raise exception 'Pedido não encontrado ou já cancelado.' using errcode = 'LB409';
  end if;

  insert into audit_log (entity, entity_id, action, after)
  values ('order', p_order, 'prazo_pagamento',
          jsonb_build_object('ate', v_ate, 'dias', v_dias));

  return jsonb_build_object('prazo_ate', v_ate);
end $fn$;

revoke execute on function fn_pendencias_pagamento(uuid)         from public, anon;
revoke execute on function fn_cancelar_sem_pagamento(uuid, text) from public, anon;
revoke execute on function fn_dar_prazo_pagamento(uuid, int)     from public, anon;
grant  execute on function fn_pendencias_pagamento(uuid)         to authenticated;
grant  execute on function fn_cancelar_sem_pagamento(uuid, text) to authenticated;
grant  execute on function fn_dar_prazo_pagamento(uuid, int)     to authenticated;


-- ---------------------------------------------------------------------------
-- E o pedido cancelado tem de SUMIR de onde vira trabalho e dinheiro.
--
-- Era o buraco que a rotina destapava: `v_production` somava `order_items` sem
-- olhar status nenhum. A equipe cancelaria na sexta, e no sabado a cozinha
-- faria o prato — o cancelamento so aparecia na conta, nunca na bancada.

create or replace view v_production
with (security_invoker = false) as
select o.week_id,
       oi.dish_id,
       oi.name_snapshot    as dish_name_pt,
       oi.category_snapshot as category,
       s.code              as size_code,
       sum(oi.qty)::int    as qty,
       bool_or(o.post_cutoff) as has_post_cutoff,
       sum(oi.qty) filter (where o.post_cutoff)::int as qty_post_cutoff,
       -- 999999 = fora do menu desta semana; ordena depois de todo o resto
       coalesce(min(md.position), 999999) as menu_position
  from order_items oi
  join orders o  on o.id = oi.order_id
  left join sizes s on s.id = oi.size_id
  left join weeks w on w.id = o.week_id
  left join menu_dishes md
         on md.menu_id = w.menu_id and md.dish_id = oi.dish_id
 where oi.item_type = 'dish'
   -- Pedido cancelado na sexta NAO vira comida. Sem isto a equipe cancelava e
   -- a cozinha fazia o prato no sabado do mesmo jeito — o cancelamento so
   -- aparecia no dinheiro, nunca na bancada.
   and o.canceled_at is null
 group by o.week_id, oi.dish_id, oi.name_snapshot, oi.category_snapshot, s.code;;

-- ---------------------------------------------------------------------------
-- O mesmo no resumo da semana: cancelado nao conta como pedido nem como
-- dinheiro a receber.

create or replace view v_week_summary
with (security_invoker = true) as
with pessoas as (
  -- status é por PESSOA na semana
  select cw.week_id,
         count(*) filter (where cw.order_status = 'novo_pedido')        as novo_pedido,
         count(*) filter (where cw.order_status = 'renovacao')          as renovacao,
         count(*) filter (where cw.order_status = 'skip')               as skip,
         count(*) filter (where cw.order_status = 'cancelamento')       as cancelamento,
         count(*) filter (where cw.order_status = 'parceria')           as parceria,
         count(*) filter (where cw.order_status = 'follow_up')          as follow_up,
         count(*) filter (where cw.order_status = 'aguardando_selecao') as aguardando_selecao,
         count(*) filter (where cw.order_status in ('novo_pedido','renovacao'))
           as clientes_com_pedido
    from customer_weeks cw
   group by cw.week_id
),
dinheiro as (
  -- valor é por PEDIDO, direto de orders: o mesmo cliente pode ter mais de um
  select o.week_id,
         -- sem ::int: `create or replace view` recusa trocar o tipo de uma
         -- coluna, e a versão anterior devolvia o bigint do count()
         count(*) filter (where cw.order_status in ('novo_pedido','renovacao'))
           as total_pedidos,
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
    from orders o
    join customer_weeks cw
      on cw.customer_id = o.customer_id and cw.week_id = o.week_id
   -- pedido cancelado na sexta sai do dinheiro E da contagem: se ficasse, a
   -- semana continuaria devendo um valor que ninguem vai receber
   where o.canceled_at is null
   group by o.week_id
)
select w.id as week_id,
       w.iso_code,
       coalesce(p.novo_pedido, 0)        as novo_pedido,
       coalesce(p.renovacao, 0)          as renovacao,
       coalesce(p.skip, 0)               as skip,
       coalesce(p.cancelamento, 0)       as cancelamento,
       coalesce(p.parceria, 0)           as parceria,
       coalesce(p.follow_up, 0)          as follow_up,
       coalesce(p.aguardando_selecao, 0) as aguardando_selecao,
       coalesce(d.total_pedidos, 0)      as total_pedidos,
       coalesce(d.pedidos_cents, 0)      as pedidos_cents,
       coalesce(d.faturado_cents, 0)     as faturado_cents,
       coalesce(d.a_receber_cents, 0)    as a_receber_cents,
       coalesce(d.parceria_valor_comercial_cents, 0) as parceria_valor_comercial_cents,
       -- coluna NOVA vai no fim: `create or replace view` não aceita inserir
       -- no meio nem renomear, só acrescentar depois da última
       coalesce(p.clientes_com_pedido, 0) as clientes_com_pedido
  from weeks w
  left join pessoas p  on p.week_id = w.id
  left join dinheiro d on d.week_id = w.id;
