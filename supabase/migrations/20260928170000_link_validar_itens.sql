-- LifeBox · o que o link aceitava e não devia
-- Ref: LIFEBOX_PROJECT.md §9.7 · auditoria de 28/09/2026
--
-- Medido contra o cluster local, pelo endpoint público, sem autenticação:
--
--   qty = 99999          → pedido de $1.198.433,97 criado, e a folha da cozinha
--                          mandando fazer 99.999 porções
--   qty = -5             → a linha SOME, sem erro: o cliente recebe a menos e
--                          ninguém vê
--   prato fora do menu   → aceito e mandado para a produção da semana
--   prato/plano inativo  → aceito, mesmo depois de a LifeBox desligar
--
-- Nenhum deles reduz dinheiro — isso eu testei e está fechado. O estrago é
-- outro: a semana inteira fica ilegível e a cozinha recebe uma folha que não
-- dá para executar. E o §9.7 já dizia a regra que faltou cumprir: "tudo que a
-- tela checa, o servidor checa de novo, porque a tela é do cliente".

insert into settings (key, value, description)
select 'max_item_qty', '60'::jsonb,
       'Teto de quantidade por item num pedido. Existe para o link público não '
       'aceitar pedido absurdo; a LifeBox levanta se precisar.'
 where not exists (select 1 from settings where key = 'max_item_qty');

/** Recusa item que a tela nunca ofereceria (§9.7).
 *
 *  Separada das duas funções do link para a regra não existir em dois lugares:
 *  regra duplicada sai de um lado só e a outra cópia vira buraco. */
create or replace function fn_link_validar_itens(
  p_week uuid, p_plan uuid, p_items jsonb
) returns void
language plpgsql stable security definer set search_path = public as $fn$
declare it jsonb; v_id uuid;
begin
  if p_plan is not null
     and not exists (select 1 from plans where id = p_plan and active) then
    raise exception 'Esse plano não está mais disponível.' using errcode = 'LB422';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if (it->>'type') = 'dish' then
      v_id := nullif(it->>'dish_id','')::uuid;
      -- do MENU DA SEMANA, não do catálogo: prato que não está no menu é prato
      -- que a cozinha não comprou ingrediente para fazer
      if not exists (
        select 1 from menu_dishes md
          join weeks w  on w.menu_id = md.menu_id
          join dishes d on d.id = md.dish_id
         where w.id = p_week and md.dish_id = v_id and d.active
      ) then
        raise exception 'Esse prato não está no menu desta semana.'
          using errcode = 'LB422';
      end if;
    elsif (it->>'type') = 'addon' then
      v_id := nullif(it->>'addon_id','')::uuid;
      if not exists (select 1 from addons where id = v_id and active) then
        raise exception 'Esse adicional não está mais disponível.'
          using errcode = 'LB422';
      end if;
    end if;
  end loop;
end $fn$;

revoke execute on function fn_link_validar_itens(uuid, uuid, jsonb) from public, anon;
grant  execute on function fn_link_validar_itens(uuid, uuid, jsonb) to authenticated, service_role;

/** Prévia do link, agora com as mesmas checagens do fechamento.
 *
 *  Virou plpgsql para poder recusar: a prévia tem de recusar o que o
 *  fechamento recusaria, senão a pessoa monta o pedido inteiro e só descobre
 *  no botão final. */
create or replace function fn_link_precificar(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_w uuid;
begin
  v_w := fn_semana_atual();
  perform fn_link_validar_itens(v_w, nullif(p->>'plan_id','')::uuid,
                                coalesce(p->'items', '[]'::jsonb));
  return fn_price_order(
    (p->>'kind')::order_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    coalesce(nullif(p->>'fulfillment',''), 'delivery')::fulfillment_type,
    coalesce(p->'items', '[]'::jsonb));
end $fn$;

revoke execute on function fn_link_precificar(jsonb) from public;
grant  execute on function fn_link_precificar(jsonb) to anon, authenticated;

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

  -- ------------------------------------------------ sanidade da quantidade
  -- O link é público: o que chega ali é o que alguém digitou OU montou à mão.
  -- Sem teto, um pedido de 99.999 refeições entra, entra no faturamento da
  -- semana e sai impresso na folha da cozinha. Sem piso, quantidade negativa
  -- some em silêncio e o cliente recebe a menos sem ninguém ver.
  --
  -- O teto é cadastro (`max_item_qty` em settings), não número escrito aqui:
  -- se a LifeBox fechar um pedido de festa, ela mesma levanta.
  declare
    v_max int := coalesce(setting_num('max_item_qty'), 60)::int;
    v_q   int;
    it    jsonb;
  begin
    for it in select * from jsonb_array_elements(p_items) loop
      v_q := coalesce((it->>'qty')::int, 0);
      if v_q < 0 then
        raise exception 'Quantidade negativa não faz sentido num pedido.'
          using errcode = 'LB422';
      end if;
      if v_q > v_max then
        raise exception 'Quantidade acima do limite (% por item). Fale com a LifeBox para um pedido maior.', v_max
          using errcode = 'LB422';
      end if;
    end loop;
  end;

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

create or replace function fn_link_criar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel   text := trim(p->>'phone');
  v_zip   text := trim(coalesce(p->>'zip_code',''));
  v_ful   fulfillment_type := coalesce(nullif(p->>'fulfillment',''), 'delivery')::fulfillment_type;
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

  -- §6.1 a tabela decide se entregamos — mas só para quem vai RECEBER.
  -- Quem retira na cozinha não precisa estar na área de entrega.
  if v_ful = 'delivery' then
    select z.route_id, z.city into v_rota, v_city
      from zip_codes z join routes r on r.id = z.route_id
     where z.zip = v_zip and z.active and r.active;
    if v_rota is null then
      raise exception 'Ainda não entregamos nesse ZIP.' using errcode = 'LB422';
    end if;
  end if;

  select * into v_c from customers where phone_e164 = v_tel;

  if v_c.id is null then
    insert into customers (
      first_name, last_name, phone_e164, street_address, city, zip_code,
      route_id, delivery_notes, fulfillment_preference, lead_type, status
    ) values (
      trim(p->>'first_name'), nullif(trim(coalesce(p->>'last_name','')), ''),
      v_tel, nullif(trim(coalesce(p->>'street_address','')), ''),
      v_city, nullif(v_zip, ''),
      v_rota, nullif(trim(coalesce(p->>'delivery_notes','')), ''),
      v_ful, 'new', 'lead'
    ) returning * into v_c;
  else
    -- em pick-up não se mexe no endereço: a pessoa pode retirar esta semana e
    -- receber na próxima, e apagar o endereço dela por isso seria perder dado
    update customers set
      first_name     = coalesce(nullif(trim(p->>'first_name'), ''), first_name),
      street_address = case when v_ful = 'delivery'
        then coalesce(nullif(trim(coalesce(p->>'street_address','')), ''), street_address)
        else street_address end,
      city           = case when v_ful = 'delivery' then v_city else city end,
      zip_code       = case when v_ful = 'delivery' then v_zip else zip_code end,
      route_id       = case when v_ful = 'delivery'
                            then coalesce(route_id, v_rota) else route_id end,
      delivery_notes = coalesce(nullif(trim(coalesce(p->>'delivery_notes','')), ''),
                                delivery_notes),
      fulfillment_preference = v_ful,
      updated_at     = now()
     where id = v_c.id
    returning * into v_c;
  end if;

  -- §9.7: tudo que a tela checa, o servidor checa de novo, porque a tela é do
  -- cliente. A tela só oferece prato do menu da semana e catálogo ativo.
  perform fn_link_validar_itens(v_w, nullif(p->>'plan_id','')::uuid,
                                coalesce(p->'items', '[]'::jsonb));

  v_res := fn_create_order(jsonb_build_object(
    'customer_id', v_c.id,
    'week_id',     v_w,
    'kind',        coalesce(nullif(p->>'kind',''), 'plan'),
    'plan_id',     p->>'plan_id',
    'size_id',     p->>'size_id',
    'breakfast_size_id', p->>'breakfast_size_id',
    'fulfillment', v_ful::text,
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
    'fulfillment', v_ful::text,
    'first_name',  v_c.first_name
  );
end $fn$;
