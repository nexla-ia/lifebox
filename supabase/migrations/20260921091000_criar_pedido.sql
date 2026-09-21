-- LifeBox · criação de pedido
-- Ref: LIFEBOX_PROJECT.md §2, §4, §5.6, §6.3, §6.4
--
-- Tudo numa função só porque as quatro coisas precisam acontecer juntas ou
-- nenhuma: preço calculado no servidor, código da semana, itens com snapshot,
-- e a linha de customer_weeks classificada. Meio caminho deixaria pedido sem
-- valor ou semana sem status.

/** Próximo código do pedido na semana: 'W39-0142' (§7).
 *  Numeração por semana, não global — é o que a equipe lê na folha.
 *
 *  Dois pedidos simultâneos na mesma semana podem calcular o mesmo número; o
 *  UNIQUE em orders.code rejeita o segundo e quem chamou tenta de novo. Com o
 *  volume real (dezenas por semana) isso praticamente não acontece, e uma
 *  sequence por semana seria mais peça para manter do que o problema merece.
 *  ponytail: contagem simples, vira sequence se houver colisão de verdade. */
create or replace function fn_proximo_codigo(p_week uuid) returns text
language sql stable as $fn$
  select substring(w.iso_code from 6)          -- '2026-W39' -> 'W39'
         || '-' || lpad(((select count(*) from orders o where o.week_id = p_week) + 1)::text, 4, '0')
    from weeks w where w.id = p_week
$fn$;

/** Espelho de fn_price_order para o front (§2).
 *
 *  O front manda ITENS e recebe o total. Nunca o contrário: preço que chega do
 *  navegador é preço que o cliente pode editar. */
create or replace function rpc_precificar(p jsonb)
returns jsonb
language sql stable security invoker as $fn$
  select fn_price_order(
    (p->>'kind')::order_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    coalesce(nullif(p->>'fulfillment',''), 'delivery')::fulfillment_type,
    coalesce(p->'items', '[]'::jsonb)
  )
$fn$;

/** Cria o pedido inteiro. Devolve o id e o código.
 *
 *  p: { customer_id, week_id?, kind, plan_id?, size_id?, breakfast_size_id?,
 *       fulfillment, items[], payment_method_id?, is_partnership?, bag_qty?,
 *       notes?, source? }
 */
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
  if exists (select 1 from orders where customer_id = v_cliente and week_id = v_week) then
    raise exception 'Este cliente ja tem pedido nesta semana';
  end if;

  -- §5.6 o preço é calculado aqui, a partir dos itens
  v_preco := fn_price_order(
    v_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    v_ful,
    coalesce(p->'items', '[]'::jsonb)
  );

  -- §4 pedido lançado depois de quinta 18h entra marcado e dispara recontagem
  v_pos_cut := fn_passou_cutoff(v_week);

  -- §6.3 Novo Pedido x Renovação, automático
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
    -- §6.4 parceria: valor pago 0, valor comercial = preço normal
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

  -- §2 snapshot: o pedido guarda nome e preço de agora
  for v_linha in select * from jsonb_array_elements(v_preco->'lines')
  loop
    continue when (v_linha->>'item_type') = 'plan_base';   -- é o plano, não item
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

  -- §6.3 uma linha por cliente por semana
  insert into customer_weeks (customer_id, week_id, order_status, order_id)
  values (v_cliente, v_week, v_status, v_id)
  on conflict (customer_id, week_id)
    do update set order_status = excluded.order_status, order_id = excluded.order_id;

  -- §6.2 quem pediu deixa de ser primeiro contato
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

/** Muda o status da semana sem apagar o pedido: Skip, Cancelamento,
 *  Follow-up e Parceria pertencem à semana, não ao cliente (§6.3). */
create or replace function fn_set_week_status(
  p_customer uuid, p_week uuid, p_status order_status
) returns void
language sql security invoker as $fn$
  insert into customer_weeks (customer_id, week_id, order_status)
  values (p_customer, p_week, p_status)
  on conflict (customer_id, week_id) do update set order_status = excluded.order_status
$fn$;

grant execute on function rpc_precificar(jsonb)  to authenticated;
grant execute on function fn_create_order(jsonb) to authenticated;
grant execute on function fn_set_week_status(uuid, uuid, order_status) to authenticated;
grant execute on function fn_semana_atual()      to authenticated;
grant execute on function fn_ensure_week(date)   to authenticated;
