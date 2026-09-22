-- LifeBox · o mesmo cliente pode ter mais de um pedido na semana
-- Decidido na reunião com a LifeBox (22/09/2026).
--
-- Até aqui valia "um pedido por cliente por semana" (§6.1), e o link recusava
-- o segundo. A LifeBox pediu o contrário: quem volta ao link querendo pedir de
-- novo faz um pedido SEPARADO — o caso real é pedir para si e depois para
-- alguém da casa, ou lembrar de um adicional depois de fechar.
--
-- O que isso obriga a mudar, e por quê:
--
-- `customer_weeks` continua com UMA linha por pessoa por semana, porque é o
-- STATUS DELA na semana (Novo, Renovação, Skip) — status é da pessoa, não do
-- pedido. Mas `v_week_summary` somava dinheiro atravessando `cw.order_id`, que
-- aponta para um pedido só: o segundo sumiria do faturamento sem dar erro.
-- Agora o dinheiro vem de `orders` direto.
--
-- Consequência que precisa ficar dita: **Total Pedidos passa a contar PEDIDOS,
-- e Novo/Renovação contam PESSOAS.** Quando alguém pede duas vezes, os dois
-- números deixam de bater — 8 pedidos de 7 clientes. É informação verdadeira,
-- não erro de conta, e a tela mostra os dois quando diferem.
-- Desvio consciente do §6.4; ver DECISOES-ABERTAS.

-- A trava de verdade era esta, no banco: `unique (customer_id, week_id)` em
-- `orders`. Sem tirá-la, o segundo pedido morre no constraint, não na função —
-- e o erro que chega ao cliente é de banco, não uma frase que ele entenda.
alter table orders drop constraint if exists orders_customer_id_week_id_key;

-- o índice continua valendo a pena: quase toda consulta da semana filtra por
-- cliente e semana. Só deixa de ser único.
create index if not exists orders_customer_week_idx on orders (customer_id, week_id);

-- ------------------------------------------------------- resumo da semana
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

-- ------------------------------------------------------------ criar pedido
/** Cria o pedido inteiro. Devolve o id e o código.
 *
 *  Sem a trava de "um por semana": o mesmo cliente pode ter vários. A linha de
 *  `customer_weeks` continua uma só e é atualizada — o status é da pessoa, e
 *  quem pede duas vezes não fica "duas vezes Novo". */
create or replace function fn_create_order(p jsonb)
returns jsonb
language plpgsql security invoker as $fn$
declare
  v_week      uuid := coalesce(nullif(p->>'week_id','')::uuid, fn_semana_atual());
  v_cliente   uuid := (p->>'customer_id')::uuid;
  v_kind      order_kind := (p->>'kind')::order_kind;
  v_ful       fulfillment_type := coalesce(nullif(p->>'fulfillment',''), 'delivery')::fulfillment_type;
  v_parceria  boolean := coalesce((p->>'is_partnership')::boolean, false);
  v_preco     jsonb;
  v_id        uuid;
  v_codigo    text;
  v_status    order_status;
  v_pos_cut   boolean;
  v_linha     jsonb;
begin
  if v_cliente is null then
    raise exception 'fn_create_order: customer_id e obrigatorio';
  end if;

  v_preco := fn_price_order(
    v_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    v_ful,
    coalesce(p->'items', '[]'::jsonb)
  );

  v_pos_cut := fn_passou_cutoff(v_week);

  -- §6.3 Novo Pedido x Renovação, automático. No segundo pedido da mesma
  -- semana a classificação não muda de novo: ela olha a semana ANTERIOR.
  v_status := case when v_parceria then 'parceria'::order_status
                   else fn_classify_order(v_cliente, v_week) end;

  v_codigo := fn_proximo_codigo(v_week);

  insert into orders (
    code, customer_id, week_id, kind, plan_id, size_id, breakfast_size_id,
    fulfillment, post_cutoff, is_partnership,
    taxable_cents, tax_cents, delivery_cents, non_taxable_cents, total_cents,
    commercial_value_cents, paid_amount_cents,
    payment_method_id, payment_status, bag_qty, source, created_by
  ) values (
    v_codigo, v_cliente, v_week, v_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    v_ful, v_pos_cut, v_parceria,
    (v_preco->>'taxable_cents')::int,
    (v_preco->>'tax_cents')::int,
    (v_preco->>'delivery_cents')::int,
    (v_preco->>'non_taxable_cents')::int,
    case when v_parceria then 0 else (v_preco->>'total_cents')::int end,
    (v_preco->>'total_cents')::int,
    0,
    nullif(p->>'payment_method_id','')::uuid,
    'aguardando_pagamento',
    coalesce((p->>'bag_qty')::int,
             (select (value #>> '{}')::int from settings where key = 'bag_default_qty'), 1),
    coalesce(nullif(p->>'source',''), 'manual')::order_source,
    auth.uid()
  )
  returning id into v_id;

  for v_linha in select * from jsonb_array_elements(v_preco->'lines')
  loop
    continue when (v_linha->>'item_type') = 'plan_base';
    insert into order_items (
      order_id, item_type, dish_id, addon_id, variant_id, size_id,
      qty, unit_price_cents, name_snapshot, category_snapshot,
      taxable, charges_delivery, position
    ) values (
      v_id,
      (v_linha->>'item_type')::item_type,
      nullif(v_linha->>'dish_id','')::uuid,
      nullif(v_linha->>'addon_id','')::uuid,
      nullif(v_linha->>'variant_id','')::uuid,
      nullif(v_linha->>'size_id','')::uuid,
      (v_linha->>'qty')::int,
      (v_linha->>'unit_price_cents')::int,
      v_linha->>'name_snapshot',
      nullif(v_linha->>'category_snapshot','')::dish_category,
      coalesce((v_linha->>'taxable')::boolean, true),
      coalesce((v_linha->>'charges_delivery')::boolean, false),
      coalesce((v_linha->>'position')::int, 0)
    );
  end loop;

  -- uma linha por cliente por semana: o `order_id` aponta para o PRIMEIRO
  -- pedido e fica de atalho. Quem precisa de dinheiro ou contagem vai em
  -- `orders`, que é onde estão todos.
  insert into customer_weeks (customer_id, week_id, order_status, order_id)
  values (v_cliente, v_week, v_status, v_id)
  on conflict (customer_id, week_id)
    do update set order_status = excluded.order_status,
                  order_id = coalesce(customer_weeks.order_id, excluded.order_id);

  update customers set lead_type = 'old', status = 'ativo'
   where id = v_cliente and (lead_type = 'new' or status = 'lead');

  return jsonb_build_object(
    'order_id', v_id,
    'code', v_codigo,
    'order_status', v_status,
    'post_cutoff', v_pos_cut,
    'pricing', v_preco
  );
end $fn$;

grant execute on function fn_create_order(jsonb) to authenticated;

-- --------------------------------------------------- drill-down do Overview
/** A lista por trás de um número (tela 8c).
 *
 *  Passa a sair de `orders`, não de `customer_weeks`: com dois pedidos do
 *  mesmo cliente, a lista precisa mostrar os dois — senão o número diz 8 e a
 *  lista mostra 7, e quem confere não sabe qual está errado.
 *
 *  Skip e Cancelamento não têm pedido, então continuam vindo de
 *  `customer_weeks`. */
create or replace function fn_overview_lista(
  p_tipo text, p_chave text, p_recorte text
) returns jsonb
language plpgsql stable security invoker as $fn$
declare v_sem uuid[];
begin
  if not is_admin() then
    raise exception 'O Overview é exclusivo do Administrador.' using errcode = 'LB403';
  end if;
  v_sem := array(select fn_semanas_do_periodo(p_tipo, p_chave));

  if p_recorte in ('skip', 'cancelamento') then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'customer_id', c.id,
               'cliente', (c.first_name || ' ' || coalesce(c.last_name, ''))::text,
               'code', null, 'plano', null, 'tamanho', null,
               'rota', rt.name, 'total_cents', null, 'pagamento', null,
               'status', cw.order_status)
             order by c.first_name)
        from customer_weeks cw
        join customers c on c.id = cw.customer_id
        left join routes rt on rt.id = c.route_id
       where cw.week_id = any(v_sem)
         and cw.order_status::text = p_recorte), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'customer_id', c.id,
             'cliente', (c.first_name || ' ' || coalesce(c.last_name, ''))::text,
             'code', o.code,
             'plano', p.name_pt,
             'tamanho', s.code,
             'rota', rt.name,
             'total_cents', o.total_cents,
             'pagamento', o.payment_status,
             'status', cw.order_status)
           order by c.first_name, o.code)
      from orders o
      join customer_weeks cw
        on cw.customer_id = o.customer_id and cw.week_id = o.week_id
      join customers c on c.id = o.customer_id
      left join plans p on p.id = o.plan_id
      left join sizes s on s.id = o.size_id
      left join routes rt on rt.id = c.route_id
     where o.week_id = any(v_sem)
       and case p_recorte
             when 'total'     then cw.order_status in ('novo_pedido','renovacao')
             when 'novo'      then cw.order_status = 'novo_pedido'
             when 'renovacao' then cw.order_status = 'renovacao'
             when 'parceria'  then cw.order_status = 'parceria'
             when 'faturado'  then cw.order_status in ('novo_pedido','renovacao')
                                   and o.payment_status = 'confirmado'
             when 'a_receber' then cw.order_status in ('novo_pedido','renovacao')
                                   and o.payment_status <> 'confirmado'
             else false
           end), '[]'::jsonb);
end $fn$;

grant execute on function fn_overview_lista(text, text, text) to authenticated;

-- ------------------------------------------------------- link: identificar
/** Passo 1 do link (telas 6e, 6g, 6m).
 *
 *  `pedidos` vira LISTA: a pessoa pode ter mais de um na semana, e a tela
 *  mostra o que já existe antes de ela decidir fazer outro. */
create or replace function fn_link_identificar(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel text := trim(p_phone);
  v_c   customers%rowtype;
  v_w   uuid;
begin
  if not fn_telefone_valido(v_tel) then
    raise exception 'Telefone precisa ser dos EUA (+1 e 10 dígitos) ou do Brasil (+55 com DDD).'
      using errcode = 'LB400';
  end if;

  perform fn_link_guard('identificar', fn_link_ip(), 30, interval '10 minutes');
  perform fn_link_guard('identificar', v_tel,         6, interval '10 minutes');

  select * into v_c from customers where phone_e164 = v_tel;
  if v_c.id is null then
    return jsonb_build_object('conhecido', false, 'pedidos', '[]'::jsonb);
  end if;

  v_w := fn_semana_atual();

  return jsonb_build_object(
    'conhecido', true,
    'first_name', v_c.first_name,
    'last_name',  v_c.last_name,
    'street_address', v_c.street_address,
    'city', v_c.city, 'state', v_c.state, 'zip_code', v_c.zip_code,
    'delivery_notes', v_c.delivery_notes,
    'default_plan_id', v_c.default_plan_id,
    'default_size_id', v_c.default_size_id,
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', o.code, 'total_cents', o.total_cents,
               'plano', p.name_pt, 'tamanho', s.code) order by o.code)
        from orders o
        left join plans p on p.id = o.plan_id
        left join sizes s on s.id = o.size_id
       where o.customer_id = v_c.id and o.week_id = v_w), '[]'::jsonb)
  );
end $fn$;

-- ------------------------------------------------------ link: criar pedido
/** Cria o pedido pelo link. Sem a recusa do segundo pedido na semana. */
create or replace function fn_link_criar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel   text := trim(p->>'phone');
  v_zip   text := trim(coalesce(p->>'zip_code',''));
  v_w     uuid;
  v_rota  uuid;
  v_city  text;
  v_c     customers%rowtype;
  v_res   jsonb;
begin
  if not fn_telefone_valido(v_tel) then
    raise exception 'Telefone precisa ser dos EUA (+1 e 10 dígitos) ou do Brasil (+55 com DDD).'
      using errcode = 'LB400';
  end if;
  if coalesce(trim(p->>'first_name'), '') = '' then
    raise exception 'Nome é obrigatório.' using errcode = 'LB400';
  end if;

  perform fn_link_guard('pedido', fn_link_ip(), 12, interval '30 minutes');
  perform fn_link_guard('pedido', v_tel,         3, interval '30 minutes');

  v_w := fn_semana_atual();
  if fn_passou_cutoff(v_w) then
    raise exception 'Os pedidos desta semana já fecharam.' using errcode = 'LB423';
  end if;

  select z.route_id, z.city into v_rota, v_city
    from zip_codes z join routes r on r.id = z.route_id
   where z.zip = v_zip and z.active and r.active;
  if v_rota is null then
    raise exception 'Ainda não entregamos nesse ZIP.' using errcode = 'LB422';
  end if;

  select * into v_c from customers where phone_e164 = v_tel;

  if v_c.id is null then
    insert into customers (
      first_name, last_name, phone_e164, street_address, city, zip_code,
      route_id, delivery_notes, lead_type, status
    ) values (
      trim(p->>'first_name'), nullif(trim(coalesce(p->>'last_name','')), ''),
      v_tel, nullif(trim(coalesce(p->>'street_address','')), ''), v_city, v_zip,
      v_rota, nullif(trim(coalesce(p->>'delivery_notes','')), ''),
      'new', 'lead'
    ) returning * into v_c;
  else
    update customers set
      first_name     = coalesce(nullif(trim(p->>'first_name'), ''), first_name),
      street_address = coalesce(nullif(trim(coalesce(p->>'street_address','')), ''),
                                street_address),
      city           = v_city,
      zip_code       = v_zip,
      route_id       = coalesce(route_id, v_rota),
      delivery_notes = coalesce(nullif(trim(coalesce(p->>'delivery_notes','')), ''),
                                delivery_notes),
      updated_at     = now()
     where id = v_c.id
    returning * into v_c;
  end if;

  v_res := fn_create_order(jsonb_build_object(
    'customer_id', v_c.id,
    'week_id',     v_w,
    'kind',        coalesce(nullif(p->>'kind',''), 'plan'),
    'plan_id',     p->>'plan_id',
    'size_id',     p->>'size_id',
    'breakfast_size_id', p->>'breakfast_size_id',
    'fulfillment', coalesce(nullif(p->>'fulfillment',''), 'delivery'),
    'items',       coalesce(p->'items', '[]'::jsonb),
    'payment_method_id', p->>'payment_method_id',
    'source',      'public_link'
  ));

  perform fn_notificar_pedido(
    (v_res->>'order_id')::uuid,
    coalesce(nullif(p->>'lang', ''), 'pt')::lang);

  return jsonb_build_object(
    'code',        v_res->>'code',
    'total_cents', (v_res->'pricing'->>'total_cents')::int,
    'entrega',     (select ends_on from weeks where id = v_w),
    'iso_code',    (select iso_code from weeks where id = v_w),
    'first_name',  v_c.first_name
  );
end $fn$;

grant execute on function fn_link_identificar(text)   to anon, authenticated;
grant execute on function fn_link_criar_pedido(jsonb) to anon, authenticated;

-- ------------------------------------------------------ overview do período
/** `fn_overview` ganha `clientes` ao lado de `pedidos.total`.
 *
 *  Os dois divergem quando alguém pede duas vezes, e o card precisa poder
 *  dizer isso — "8 pedidos de 7 clientes" é informação, "8" sozinho vira
 *  desconfiança de erro de conta. */
create or replace function fn_overview(p_tipo text, p_chave text)
returns jsonb
language plpgsql stable security invoker as $fn$
declare
  v_semanas uuid[];
  v_periodo jsonb;
  v_meta    int;
  v_pago    int;
  v_pagos   int;
  r         record;
begin
  if not is_admin() then
    raise exception 'O Overview é exclusivo do Administrador.' using errcode = 'LB403';
  end if;

  v_semanas := array(select fn_semanas_do_periodo(p_tipo, p_chave));
  v_periodo := fn_periodo(p_tipo, p_chave);

  select coalesce(sum(g.amount_cents), 0)::int into v_meta
    from goals g
   where (p_tipo = 'week'  and g.period_type = 'week'  and g.period_key = p_chave)
      or (p_tipo = 'month' and g.period_type = 'month' and g.period_key = p_chave)
      or (p_tipo = 'year'  and g.period_type = 'month' and g.period_key like p_chave || '-%');

  select
    coalesce(sum(s.total_pedidos), 0)::int              as pedidos,
    coalesce(sum(s.clientes_com_pedido), 0)::int        as clientes,
    coalesce(sum(s.novo_pedido), 0)::int                as novo,
    coalesce(sum(s.renovacao), 0)::int                  as renovacao,
    coalesce(sum(s.skip), 0)::int                       as skip,
    coalesce(sum(s.cancelamento), 0)::int               as cancelamento,
    coalesce(sum(s.parceria), 0)::int                   as parceria,
    coalesce(sum(s.aguardando_selecao), 0)::int         as aguardando,
    coalesce(sum(s.pedidos_cents), 0)::int              as total_cents,
    coalesce(sum(s.faturado_cents), 0)::int             as faturado_cents,
    coalesce(sum(s.a_receber_cents), 0)::int            as a_receber_cents,
    coalesce(sum(s.parceria_valor_comercial_cents), 0)::int as parceria_cents
    into r
    from v_week_summary s
   where s.week_id = any(v_semanas);

  select coalesce(sum(o.total_cents), 0)::int, count(*)::int into v_pago, v_pagos
    from orders o
    join customer_weeks cw
      on cw.customer_id = o.customer_id and cw.week_id = o.week_id
   where o.week_id = any(v_semanas)
     and cw.order_status in ('novo_pedido', 'renovacao')
     and o.payment_status = 'confirmado';

  return jsonb_build_object(
    'periodo', v_periodo,
    'meta_cents', v_meta,

    'faturamento', jsonb_build_object(
      'total_cents',     r.total_cents,
      'faturado_cents',  r.faturado_cents,
      'a_receber_cents', r.a_receber_cents,
      'pct_meta', case when v_meta > 0
                       then round(r.total_cents::numeric * 100 / v_meta, 1) else null end),

    'pedidos', jsonb_build_object(
      'total', r.pedidos, 'clientes', r.clientes,
      'novo', r.novo, 'renovacao', r.renovacao,
      'skip', r.skip, 'cancelamento', r.cancelamento, 'parceria', r.parceria,
      'aguardando_selecao', r.aguardando),

    'ticket_medio_cents', case when v_pagos > 0 then (v_pago / v_pagos)::int end,
    'ticket_pagos', v_pagos,
    'ticket_por_pedido_cents', case when r.pedidos > 0
                                    then (r.total_cents / r.pedidos)::int end,

    'renovacao', fn_overview_renovacao(v_semanas),
    'leads', fn_overview_leads(v_semanas),

    'mix_planos', coalesce((
      select jsonb_agg(x order by x->>'qtd' desc) from (
        select jsonb_build_object('plano', coalesce(p.name_pt, 'Personalizado'),
                                  'qtd', count(*)::int) as x
          from orders o
          join customer_weeks cw
            on cw.customer_id = o.customer_id and cw.week_id = o.week_id
          left join plans p on p.id = o.plan_id
         where o.week_id = any(v_semanas)
           and cw.order_status in ('novo_pedido','renovacao')
           and o.kind in ('plan','custom')
         group by p.name_pt) t), '[]'::jsonb),

    'mix_tamanhos', coalesce((
      select jsonb_agg(jsonb_build_object('size', s.code, 'qtd', q) order by s.position)
        from (select o.size_id, count(*)::int as q
                from orders o
                join customer_weeks cw
                  on cw.customer_id = o.customer_id and cw.week_id = o.week_id
               where o.week_id = any(v_semanas)
                 and cw.order_status in ('novo_pedido','renovacao')
                 and o.size_id is not null
               group by o.size_id) t
        join sizes s on s.id = t.size_id), '[]'::jsonb),

    'adicionais', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd, 'valor_cents', valor)
                       order by valor desc)
        from (select i.name_snapshot as nome, sum(i.qty)::int as qtd,
                     sum(i.qty * i.unit_price_cents)::int as valor
                from order_items i
                join orders o on o.id = i.order_id
               where o.week_id = any(v_semanas)
                 and i.item_type = 'addon' and i.unit_price_cents > 0
               group by i.name_snapshot) t), '[]'::jsonb),

    'parcerias', jsonb_build_object(
      'qtd', r.parceria, 'valor_comercial_cents', r.parceria_cents),

    'top_pratos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd) order by qtd desc)
        from (select i.name_snapshot as nome, sum(i.qty)::int as qtd
                from order_items i
                join orders o on o.id = i.order_id
               where o.week_id = any(v_semanas) and i.item_type = 'dish'
               group by i.name_snapshot
               order by 2 desc limit 8) t), '[]'::jsonb)
  );
end $fn$;

grant execute on function fn_overview(text, text) to authenticated;
