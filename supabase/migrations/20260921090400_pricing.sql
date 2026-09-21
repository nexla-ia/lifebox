-- LifeBox · calculo de preco e classificacao do pedido
-- Ref: LIFEBOX_PROJECT.md §5.6, §6.3, §6.4
--
-- REGRA: nenhum valor monetario mora aqui. Tudo vem de plan_prices,
-- extra_prices, custom_unit_prices, addons e settings. A LifeBox edita
-- os precos pela tela de Catalogo; esta funcao so le.

create or replace function setting_num(p_key text) returns numeric
language sql stable as $fn$
  select (value #>> '{}')::numeric from settings where key = p_key
$fn$;

create or replace function setting_bool(p_key text) returns boolean
language sql stable as $fn$
  select (value #>> '{}')::boolean from settings where key = p_key
$fn$;

-- ---------------------------------------------------------------------------
-- fn_price_order
--
-- p_items: [{"type":"dish","dish_id":uuid,"size_id":uuid?,"qty":int},
--           {"type":"addon","addon_id":uuid,"variant_id":uuid?,"qty":int}]
--
-- Retorna as linhas ja com snapshot de nome e preco (§2) mais os totais.
-- O front manda so itens e recebe o total (§2): nunca envia valor.
-- ---------------------------------------------------------------------------
create or replace function fn_price_order(
  p_kind              order_kind,
  p_plan_id           uuid,
  p_size_id           uuid,
  p_breakfast_size_id uuid,
  p_fulfillment       fulfillment_type,
  p_items             jsonb
) returns jsonb
language plpgsql stable as $fn$
declare
  v_tax_rate     numeric := coalesce(setting_num('tax_rate'), 0);
  v_delivery_fee int     := coalesce(setting_num('delivery_fee_cents'), 0)::int;
  v_pickup_dlv   boolean := coalesce(setting_bool('pickup_charges_delivery'), false);
  v_custom_tax   boolean := coalesce(setting_bool('custom_charges_tax'), true);
  v_custom_dlv   boolean := coalesce(setting_bool('custom_charges_delivery'), true);

  v_plan         plans%rowtype;
  v_base         int := 0;
  v_meals        int := 0;
  v_breakfasts   int := 0;
  v_meals_extra  int := 0;
  v_bkf_extra    int := 0;
  v_kit_meals    int := 0;

  v_lines        jsonb := '[]'::jsonb;
  v_taxable      int := 0;
  v_non_taxable  int := 0;
  v_tax          int := 0;
  v_delivery     int := 0;
  v_any_dlv      boolean := false;
  v_pos          int := 0;
  v_unit         int;
  v_bkf_size     uuid := coalesce(p_breakfast_size_id, p_size_id);
  r              record;
begin
  if p_items is null then p_items := '[]'::jsonb; end if;

  -- ------------------------------------------------- base do plano (§5.1)
  if p_kind = 'plan' then
    select * into v_plan from plans where id = p_plan_id;
    if not found then
      raise exception 'fn_price_order: plano % nao encontrado', p_plan_id;
    end if;

    select base_price_cents into v_base
      from plan_prices where plan_id = p_plan_id and size_id = p_size_id;
    if v_base is null then
      raise exception 'fn_price_order: sem preco para plano % no tamanho %',
        p_plan_id, p_size_id;
    end if;

    v_taxable := v_taxable + v_base;
    v_any_dlv := true;

    v_lines := v_lines || jsonb_build_object(
      'item_type','plan_base', 'qty',1, 'unit_price_cents',v_base,
      'name_snapshot', v_plan.name_pt, 'taxable',true,
      'charges_delivery',true, 'position',v_pos);
    v_pos := v_pos + 1;
  end if;

  -- --------------------------------------------- pratos escolhidos (§5.5)
  for r in
    select d.id            as dish_id,
           d.name_pt       as name_pt,
           d.category      as category,
           coalesce((i->>'size_id')::uuid,
                    case when d.category = 'breakfast' then v_bkf_size
                         else p_size_id end) as size_id,
           greatest(coalesce((i->>'qty')::int, 0), 0) as qty
      from jsonb_array_elements(p_items) i
      join dishes d on d.id = (i->>'dish_id')::uuid
     where coalesce(i->>'type', 'dish') = 'dish'
  loop
    continue when r.qty = 0;

    if r.category = 'breakfast' then
      v_breakfasts := v_breakfasts + r.qty;
    else
      v_meals := v_meals + r.qty;
    end if;

    -- plan: o prato ja esta pago na base. custom: cobrado por unidade (§5.3).
    -- addons_only: o prato vem dentro do kit (ex. Super Detox), preco zero.
    if p_kind = 'custom' then
      select unit_price_cents into v_unit
        from custom_unit_prices where size_id = r.size_id;
      if v_unit is null then
        raise exception 'fn_price_order: sem unitario de Personalizado para o tamanho %',
          r.size_id;
      end if;
      v_taxable     := v_taxable + case when v_custom_tax then v_unit * r.qty else 0 end;
      v_non_taxable := v_non_taxable + case when v_custom_tax then 0 else v_unit * r.qty end;
      if v_custom_dlv then v_any_dlv := true; end if;
    else
      v_unit := 0;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'item_type','dish', 'dish_id',r.dish_id, 'size_id',r.size_id, 'qty',r.qty,
      'unit_price_cents',v_unit, 'name_snapshot',r.name_pt,
      'category_snapshot',r.category,
      'taxable', case when p_kind = 'custom' then v_custom_tax else true end,
      'charges_delivery', case when p_kind = 'custom' then v_custom_dlv else p_kind = 'plan' end,
      'position',v_pos);
    v_pos := v_pos + 1;
  end loop;

  -- ------------------------------------------------------ adicionais (§5.4)
  for r in
    select a.id as addon_id, a.name_pt, a.price_cents, a.charges_tax,
           a.charges_delivery, a.requires_plan, a.includes_meals_qty,
           v.id as variant_id, v.name_pt as variant_name,
           greatest(coalesce((i->>'qty')::int, 0), 0) as qty
      from jsonb_array_elements(p_items) i
      join addons a on a.id = (i->>'addon_id')::uuid
      left join addon_variants v on v.id = (i->>'variant_id')::uuid
     where i->>'type' = 'addon'
  loop
    continue when r.qty = 0;

    -- §5.4: o pacote 5 Juices so e vendido junto com um Fresh Plan
    if r.requires_plan and p_kind <> 'plan' then
      raise exception 'fn_price_order: "%" so pode ser vendido com um plano', r.name_pt;
    end if;

    -- Linha COM variante e a composicao do kit (ex. "20 sucos: Green #1 x8,
    -- Red x6, Orange x6"), nao um item a parte: quem carrega o preco e a
    -- linha do adicional. Sem essa regra, cada sabor cobraria o kit inteiro.
    if r.variant_id is not null then
      v_lines := v_lines || jsonb_build_object(
        'item_type','addon', 'addon_id',r.addon_id, 'variant_id',r.variant_id,
        'qty',r.qty, 'unit_price_cents',0,
        'name_snapshot', r.name_pt || ' - ' || r.variant_name,
        'taxable',false, 'charges_delivery',false, 'position',v_pos);
      v_pos := v_pos + 1;
      continue;
    end if;

    v_kit_meals := v_kit_meals + r.includes_meals_qty * r.qty;

    if r.charges_tax then
      v_taxable := v_taxable + r.price_cents * r.qty;
    else
      v_non_taxable := v_non_taxable + r.price_cents * r.qty;
    end if;
    if r.charges_delivery then v_any_dlv := true; end if;

    v_lines := v_lines || jsonb_build_object(
      'item_type','addon', 'addon_id',r.addon_id, 'variant_id',null,
      'qty',r.qty, 'unit_price_cents',r.price_cents,
      'name_snapshot', r.name_pt,
      'taxable',r.charges_tax, 'charges_delivery',r.charges_delivery,
      'position',v_pos);
    v_pos := v_pos + 1;
  end loop;

  -- --------------------------------------------------------- extras (§5.2)
  -- So existem em pedido de plano: e o que passa do limite contratado.
  -- Em addons_only, o kit ja traz uma cota de refeicoes (Super Detox).
  if p_kind = 'plan' then
    v_meals_extra := greatest(v_meals - v_plan.meals_qty, 0);
    v_bkf_extra   := greatest(v_breakfasts - v_plan.breakfasts_qty, 0);

    if v_meals_extra > 0 then
      select unit_price_cents into v_unit
        from extra_prices
       where plan_id = p_plan_id and size_id = p_size_id and item_kind = 'meal';
      if v_unit is null then
        raise exception 'fn_price_order: sem preco de refeicao extra para plano %/tamanho %',
          p_plan_id, p_size_id;
      end if;
      v_taxable := v_taxable + v_unit * v_meals_extra;
      v_lines := v_lines || jsonb_build_object(
        'item_type','extra', 'qty',v_meals_extra, 'unit_price_cents',v_unit,
        'name_snapshot', 'Refeicao extra', 'size_id', p_size_id,
        'taxable',true, 'charges_delivery',false, 'position',v_pos);
      v_pos := v_pos + 1;
    end if;

    if v_bkf_extra > 0 then
      select unit_price_cents into v_unit
        from extra_prices
       where plan_id = p_plan_id and size_id = v_bkf_size and item_kind = 'breakfast';
      if v_unit is null then
        raise exception 'fn_price_order: sem preco de breakfast extra para plano %/tamanho %',
          p_plan_id, v_bkf_size;
      end if;
      v_taxable := v_taxable + v_unit * v_bkf_extra;
      v_lines := v_lines || jsonb_build_object(
        'item_type','extra', 'qty',v_bkf_extra, 'unit_price_cents',v_unit,
        'name_snapshot', 'Breakfast extra', 'size_id', v_bkf_size,
        'taxable',true, 'charges_delivery',false, 'position',v_pos);
      v_pos := v_pos + 1;
    end if;
  end if;

  -- ---------------------------------------------------- tax e delivery (§5.6)
  -- round() do Postgres arredonda meio para longe do zero = half-up em valor
  -- positivo. 13935 * 0.07 = 975.45 -> 975 = $9.75.
  v_tax := round(v_taxable * v_tax_rate)::int;

  if v_any_dlv then
    if p_fulfillment = 'delivery' then
      v_delivery := v_delivery_fee;
    elsif v_pickup_dlv then           -- §6.6, padrao false
      v_delivery := v_delivery_fee;
    end if;
  end if;

  return jsonb_build_object(
    'lines',             v_lines,
    'taxable_cents',     v_taxable,
    'tax_cents',         v_tax,
    'delivery_cents',    v_delivery,
    'non_taxable_cents', v_non_taxable,
    'total_cents',       v_taxable + v_tax + v_delivery + v_non_taxable,
    'meals_qty',         v_meals,
    'breakfasts_qty',    v_breakfasts,
    'meals_extra',       v_meals_extra,
    'breakfasts_extra',  v_bkf_extra,
    'kit_meals_allowance', v_kit_meals,
    'tax_rate',          v_tax_rate
  );
end $fn$;

-- ---------------------------------------------------------------------------
-- fn_classify_order (§6.3)
--
-- novo_pedido : primeira compra OU retorno depois de um Cancelamento
-- renovacao   : teve pedido na semana anterior OU estava em Skip
-- O sistema nunca renova pedido automaticamente; isto so classifica.
-- ---------------------------------------------------------------------------
create or replace function fn_classify_order(p_customer uuid, p_week uuid)
returns order_status
language plpgsql stable as $fn$
declare
  v_starts date;
  v_prev   order_status;
begin
  select starts_on into v_starts from weeks where id = p_week;
  if v_starts is null then
    raise exception 'fn_classify_order: semana % nao encontrada', p_week;
  end if;

  -- a semana imediatamente anterior, nao "a ultima que tiver registro"
  select cw.order_status into v_prev
    from customer_weeks cw
    join weeks w on w.id = cw.week_id
   where cw.customer_id = p_customer
     and w.starts_on = v_starts - 7;

  -- parceria conta como pedido feito na semana anterior
  if v_prev in ('novo_pedido','renovacao','parceria','skip') then
    return 'renovacao';
  end if;

  -- null, cancelamento, follow_up e aguardando_selecao caem aqui
  return 'novo_pedido';
end $fn$;
