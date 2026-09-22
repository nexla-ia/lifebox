-- LifeBox · o cliente escolhe entrega ou retirada no link
-- Ref: §6.6, §9.7 · telas 6e e 11f. Reunião com a LifeBox (22/09/2026):
-- "na parte do pedido do cliente colocar se vai receber ou retirar, aí ocupa
--  a taxa e delivery".
--
-- O preço já sabia disso: `fn_price_order` não cobra delivery em pick-up
-- (§6.6, `pickup_charges_delivery` = false). O que faltava era o link deixar
-- escolher — e, junto, parar de exigir ZIP atendido de quem vai retirar.
--
-- É a parte que muda de regra: quem retira na cozinha não precisa morar na
-- área de entrega. Exigir o ZIP ali recusava pedido que a LifeBox consegue
-- atender — e recusava justamente quem se dispôs a buscar.

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

grant execute on function fn_link_criar_pedido(jsonb) to anon, authenticated;

-- O catálogo do link passa a levar a janela de retirada: a tela precisa dizer
-- QUANDO buscar, senão "retirar na cozinha" é só uma palavra.
create or replace function fn_link_catalogo() returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_menu uuid; v_id uuid; v_base jsonb;
begin
  v_id := fn_semana_atual();
  select menu_id into v_menu from weeks where id = v_id;

  v_base := jsonb_build_object(
    'tax_rate',           coalesce(setting_num('tax_rate'), 0),
    'delivery_fee_cents', coalesce(setting_num('delivery_fee_cents'), 0)::int,
    'pickup_window',      (select value from settings where key = 'pickup_window'),
    'delivery_window',    (select value from settings where key = 'delivery_window'),

    'sizes', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name)
                       order by position)
        from sizes where active), '[]'::jsonb),

    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name_pt', p.name_pt, 'name_en', p.name_en,
               'meals_qty', p.meals_qty, 'breakfasts_qty', p.breakfasts_qty,
               'prices', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'size_id', pp.size_id, 'base_price_cents', pp.base_price_cents))
                   from plan_prices pp where pp.plan_id = p.id), '[]'::jsonb),
               'extras', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'size_id', ep.size_id, 'item_kind', ep.item_kind,
                          'unit_price_cents', ep.unit_price_cents))
                   from extra_prices ep where ep.plan_id = p.id), '[]'::jsonb))
             order by p.position)
        from plans p where p.active), '[]'::jsonb),

    'custom_prices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'size_id', size_id, 'unit_price_cents', unit_price_cents))
        from custom_unit_prices), '[]'::jsonb),

    'dishes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'name_pt', d.name_pt, 'name_en', d.name_en,
               'desc_pt', d.desc_pt, 'desc_en', d.desc_en,
               'category', d.category, 'photo', d.photos[1],
               'calories', d.calories, 'protein_g', d.protein_g,
               'carbs_g', d.carbs_g, 'fat_g', d.fat_g,
               'sizes', coalesce((
                 select jsonb_agg(ds.size_id) from dish_sizes ds where ds.dish_id = d.id),
                 '[]'::jsonb),
               'tags', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'code', t.code, 'label_pt', t.label_pt,
                          'label_en', t.label_en, 'icon', t.icon) order by t.position)
                   from dish_tag_links l join dish_tags t on t.id = l.tag_id
                  where l.dish_id = d.id and t.active), '[]'::jsonb),
               'allergens', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'code', a.code, 'label_pt', a.label_pt,
                          'label_en', a.label_en, 'icon', a.icon))
                   from dish_allergens da join allergens a on a.id = da.allergen_id
                  where da.dish_id = d.id and a.active), '[]'::jsonb))
             order by md.position, d.name_en)
        from menu_dishes md join dishes d on d.id = md.dish_id
       where md.menu_id = v_menu and md.active and d.active), '[]'::jsonb),

    'addons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name_pt', a.name_pt, 'name_en', a.name_en,
               'desc_pt', a.desc_pt, 'desc_en', a.desc_en, 'photo', a.photo,
               'price_cents', a.price_cents, 'category', a.category,
               'requires_plan', a.requires_plan,
               'charges_tax', a.charges_tax, 'charges_delivery', a.charges_delivery,
               'variants', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', v.id, 'name_pt', v.name_pt, 'name_en', v.name_en)
                        order by v.position)
                   from addon_variants v where v.addon_id = a.id and v.active), '[]'::jsonb))
             order by a.position)
        from addons a where a.active), '[]'::jsonb),

    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'name_pt', name_pt, 'name_en', name_en) order by position)
        from payment_methods where active), '[]'::jsonb)
  );

  return v_base;
end $fn$;

grant execute on function fn_link_catalogo() to anon, authenticated;

/** Prévia da revisão (tela 6i), agora ciente da retirada.
 *
 *  Sem isto, a revisão mostraria a taxa de entrega para quem escolheu retirar
 *  e o total só se corrigiria depois de confirmar — a pior hora para o número
 *  mudar. */
create or replace function fn_link_precificar(p jsonb) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select fn_price_order(
    (p->>'kind')::order_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    coalesce(nullif(p->>'fulfillment',''), 'delivery')::fulfillment_type,
    coalesce(p->'items', '[]'::jsonb)
  )
$fn$;

grant execute on function fn_link_precificar(jsonb) to anon, authenticated;

/** Libera as tentativas de um número no link (§9.7).
 *
 *  O limite existe para o link não virar consulta de cadastro por tentativa e
 *  erro. Mas ele também pega cliente de verdade: quem erra o formulário seis
 *  vezes fica dez minutos sem conseguir pedir, e liga para a LifeBox. Sem esta
 *  função a resposta seria "espera".
 *
 *  Admin-only e por chave exata — não zera o controle inteiro. */
create or replace function fn_link_liberar_tentativas(p_chave text) returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not is_admin() then
    raise exception 'Só o Administrador libera tentativas.' using errcode = 'LB403';
  end if;
  delete from public_requests where chave = trim(p_chave);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function fn_link_liberar_tentativas(text) from public;
grant execute on function fn_link_liberar_tentativas(text) to authenticated;

/** Zera o controle de tentativas inteiro (§9.7).
 *
 *  Caso real: depois de um disparo de campanha, muita gente abre o link da
 *  mesma rede — escritório, escola, prédio — e o limite por IP começa a barrar
 *  cliente de verdade. Aqui a equipe solta o controle, que se reconstrói
 *  sozinho na janela seguinte.
 *
 *  É a versão sem alvo de `fn_link_liberar_tentativas`, e por isso admin-only
 *  e separada: apagar o controle inteiro sem querer, ao tentar liberar um
 *  número, seria fácil demais se fosse o mesmo botão. */
create or replace function fn_link_limpar_tentativas() returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not is_admin() then
    raise exception 'Só o Administrador limpa o controle de tentativas.'
      using errcode = 'LB403';
  end if;
  delete from public_requests;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function fn_link_limpar_tentativas() from public;
grant execute on function fn_link_limpar_tentativas() to authenticated;
