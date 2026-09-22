-- LifeBox · link público de pedido
-- Ref: LIFEBOX_PROJECT.md §9.7, §4, §5.6, §6.1 · telas 6e, 6g, 6f, 6a, 6c, 6b,
--      6d, 6h, 6i, 6j, 6k, 6m
--
-- O link não tem sessão: quem chega é o role `anon`, que NÃO tem grant em
-- tabela nenhuma (migration 0600 só abriu para `authenticated`). Tudo passa
-- por estas funções `security definer` — uma porta só, e é aqui que se audita
-- o que sai. Mesmo princípio já usado em v_production/v_kitchen_notes para a
-- Cozinha (§3): a view roda como dona porque é a única janela daquele perfil.
--
-- Duas regras que não dependem da tela, porque tela o cliente controla:
--   · quem fecha o link é o cutoff no servidor (§4), não o botão sumir
--   · quem decide se entregamos no ZIP é `zip_codes` (§6.1), nunca uma API
--
-- O link é só ENTREGA. O protótipo valida endereço em todos os caminhos
-- (6f bloqueia fora de área) e não oferece retirada; pick-up continua sendo
-- combinado com a equipe. Ver DECISOES-ABERTAS item 12.

-- --------------------------------------------------------------- rate limit
/** Tentativas recentes, por IP e por telefone (§9.7 "rate limit por IP e por
 *  telefone"). Guarda IP, então é dado pessoal de visitante: vive 1 dia e some.
 *  Não tem RLS aberta para ninguém — só as funções desta migration tocam. */
create table public_requests (
  id         bigserial primary key,
  bucket     text not null,
  chave      text not null,
  created_at timestamptz not null default now()
);
create index on public_requests (bucket, chave, created_at desc);

alter table public_requests enable row level security;
alter table public_requests force row level security;

/** IP de quem chamou. Fora do PostgREST não existe cabeçalho, e aí o limite
 *  passa a ser só por telefone — é o caso do psql nos testes. */
create or replace function fn_link_ip() returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    nullif(split_part(
      nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for',
      ',', 1), ''),
    'sem-ip')
$fn$;

/** Recusa e registra a tentativa. Chamar ANTES de fazer o trabalho.
 *
 *  A limpeza é amostrada (1 em 50) de propósito: varrer a tabela a cada
 *  chamada custaria mais que o problema, e a janela é curta. */
create or replace function fn_link_guard(
  p_bucket text, p_chave text, p_max int, p_janela interval
) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if random() < 0.02 then
    delete from public_requests where created_at < now() - interval '1 day';
  end if;

  if (select count(*) from public_requests
       where bucket = p_bucket and chave = p_chave
         and created_at > now() - p_janela) >= p_max then
    raise exception 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
      using errcode = 'LB429';
  end if;

  insert into public_requests (bucket, chave) values (p_bucket, p_chave);
end $fn$;

-- ------------------------------------------------------------------- semana
/** Estado do link (telas 6e e 6k).
 *
 *  Quem fecha é o cutoff, calculado no fuso operacional (§4). A semana abre
 *  sozinha na segunda: se ainda não existe linha, fn_ensure_week cria pelo
 *  ciclo de menus — é o comportamento desenhado, não efeito colateral. */
create or replace function fn_link_semana() returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_w weeks%rowtype; v_prox date;
begin
  -- Chamar fn_semana_atual() DENTRO do where não funciona: ela é volátil e o
  -- planner só a executa por linha varrida. Na primeira visita da semana a
  -- tabela está vazia, não há linha nenhuma, e a função que criaria a semana
  -- nunca roda — o link abriria em branco justamente na segunda de manhã.
  v_id := fn_semana_atual();
  select * into v_w from weeks where id = v_id;
  v_prox := v_w.starts_on + 7;

  return jsonb_build_object(
    'week_id',   v_w.id,
    'iso_code',  v_w.iso_code,
    'starts_on', v_w.starts_on,
    'ends_on',   v_w.ends_on,
    'cutoff_at', v_w.cutoff_at,
    'aberto',    not fn_passou_cutoff(v_w.id),
    'entrega',   v_w.ends_on,                      -- domingo (§4)
    'proxima_abertura', v_prox,
    'proxima_iso',      fn_codigo_semana(v_prox)
  );
end $fn$;

-- ----------------------------------------------------------------- catálogo
/** Tudo que o fluxo desenha, numa chamada só (telas 6a a 6h).
 *
 *  Devolve PT e EN juntos: o seletor de idioma troca na hora, sem ida ao
 *  servidor. Sai preço de plano, extra, personalizado e adicional — são os
 *  mesmos números que o cliente vai ver na revisão; o que NÃO sai daqui é o
 *  total, que é sempre do servidor (§2). */
create or replace function fn_link_catalogo() returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_menu uuid; v_id uuid;
begin
  v_id := fn_semana_atual();     -- fora do where: ver fn_link_semana
  select menu_id into v_menu from weeks where id = v_id;

  return jsonb_build_object(
    'tax_rate',           coalesce(setting_num('tax_rate'), 0),
    'delivery_fee_cents', coalesce(setting_num('delivery_fee_cents'), 0)::int,

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
               -- unitário da faixa, para o aviso de extra da tela 6d
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

    -- pratos do menu DA SEMANA, não o catálogo inteiro (§4)
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
             -- a ordem é a do menu, a mesma que a cozinha monta (reunião 22/09)
             order by md.position, d.name_en)
        from menu_dishes md join dishes d on d.id = md.dish_id
       where md.menu_id = v_menu and md.active and d.active), '[]'::jsonb),

    'addons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name_pt', a.name_pt, 'name_en', a.name_en,
               'desc_pt', a.desc_pt, 'desc_en', a.desc_en, 'photo', a.photo,
               'price_cents', a.price_cents, 'category', a.category,
               -- §5.4: o 5 Juices só é vendido junto com um plano
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
end $fn$;

-- ---------------------------------------------------------------------- ZIP
/** "Vocês entregam aqui?" — telas 6f e 6g.
 *
 *  §6.1: quem responde é a tabela. A consulta a api.zippopotam.us do
 *  src/lib/zip.ts é conveniência de preenchimento e não decide nada. */
create or replace function fn_link_zip(p_zip text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_z record;
begin
  select z.zip, z.city, z.state, r.name as rota
    into v_z
    from zip_codes z join routes r on r.id = z.route_id
   where z.zip = trim(p_zip) and z.active and r.active;

  if v_z.zip is null then
    return jsonb_build_object('atende', false);
  end if;
  return jsonb_build_object(
    'atende', true, 'city', v_z.city, 'state', v_z.state, 'rota', v_z.rota);
end $fn$;

-- ----------------------------------------------------------- identificação
/** Passo 1 (telas 6e, 6g, 6m): o WhatsApp vem primeiro e cruza com o cadastro.
 *
 *  Devolve o MÍNIMO que a tela precisa para dizer "Olá, {nome}" e mostrar o
 *  endereço salvo. Mesmo assim é dado pessoal atrás de um endpoint público:
 *  o limite por IP e por telefone existe para que a rota não vire consulta
 *  de cadastro por tentativa e erro. */
create or replace function fn_link_identificar(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel text := trim(p_phone);
  v_c   customers%rowtype;
  v_w   uuid;
  v_o   record;
begin
  if v_tel !~ '^\+1[0-9]{10}$' then
    raise exception 'Telefone precisa estar em E.164 (+1 e 10 dígitos).'
      using errcode = 'LB400';
  end if;

  -- O limite por IP é folgado e o por TELEFONE é curto, de propósito. Quem
  -- varre cadastro troca de número a cada tentativa, então quem barra isso é o
  -- limite por IP — mas apertá-lo demais derruba cliente de verdade: rede de
  -- celular põe muita gente atrás do mesmo IP (CGNAT), e uma família ou um
  -- escritório inteiro chegam juntos.
  perform fn_link_guard('identificar', fn_link_ip(), 30, interval '10 minutes');
  perform fn_link_guard('identificar', v_tel,         6, interval '10 minutes');

  select * into v_c from customers where phone_e164 = v_tel;
  if v_c.id is null then
    return jsonb_build_object('conhecido', false);
  end if;

  v_w := fn_semana_atual();
  select o.code, o.total_cents, p.name_pt as plano, s.code as tamanho
    into v_o
    from orders o
    left join plans p on p.id = o.plan_id
    left join sizes s on s.id = o.size_id
   where o.customer_id = v_c.id and o.week_id = v_w;

  return jsonb_build_object(
    'conhecido', true,
    'first_name', v_c.first_name,
    'last_name',  v_c.last_name,
    'street_address', v_c.street_address,
    'city', v_c.city, 'state', v_c.state, 'zip_code', v_c.zip_code,
    'delivery_notes', v_c.delivery_notes,
    'default_plan_id', v_c.default_plan_id,
    'default_size_id', v_c.default_size_id,
    -- tela 6m: já tem pedido nesta semana
    'pedido', case when v_o.code is null then null else jsonb_build_object(
      'code', v_o.code, 'total_cents', v_o.total_cents,
      'plano', v_o.plano, 'tamanho', v_o.tamanho) end
  );
end $fn$;

-- ------------------------------------------------------------- precificação
/** Prévia da revisão (tela 6i). Espelha rpc_precificar: o front manda itens e
 *  recebe o total, nunca o contrário (§2). */
create or replace function fn_link_precificar(p jsonb) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select fn_price_order(
    (p->>'kind')::order_kind,
    nullif(p->>'plan_id','')::uuid,
    nullif(p->>'size_id','')::uuid,
    nullif(p->>'breakfast_size_id','')::uuid,
    'delivery'::fulfillment_type,
    coalesce(p->'items', '[]'::jsonb)
  )
$fn$;

-- --------------------------------------------------------------- o pedido
/** Passo 6 (tela 6j). Cria o cliente se for a primeira vez e o pedido.
 *
 *  Tudo que a tela checou é checado de novo aqui, porque a tela é do cliente:
 *  cutoff, ZIP atendido, formato do telefone e pedido duplicado na semana.
 */
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
  v_code  text;
begin
  if v_tel !~ '^\+1[0-9]{10}$' then
    raise exception 'Telefone precisa estar em E.164 (+1 e 10 dígitos).'
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

  -- §6.1 a tabela decide, e decide de novo aqui
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
    -- tela 6e deixa corrigir nome e endereço; só sobrescreve o que veio
    -- preenchido, para um campo em branco não apagar o que a equipe cadastrou
    update customers set
      first_name     = coalesce(nullif(trim(p->>'first_name'), ''), first_name),
      street_address = coalesce(nullif(trim(coalesce(p->>'street_address','')), ''),
                                street_address),
      city           = v_city,
      zip_code       = v_zip,
      route_id       = coalesce(route_id, v_rota),   -- rota é editável (§6.1)
      delivery_notes = coalesce(nullif(trim(coalesce(p->>'delivery_notes','')), ''),
                                delivery_notes),
      updated_at     = now()
     where id = v_c.id
    returning * into v_c;
  end if;

  -- tela 6m: um pedido por cliente por semana. Não é erro do cliente, é
  -- estado — a tela oferece ver ou alterar até o cutoff.
  select code into v_code from orders where customer_id = v_c.id and week_id = v_w;
  if v_code is not null then
    raise exception 'Você já tem um pedido nesta semana (%).', v_code
      using errcode = 'LB409';
  end if;

  v_res := fn_create_order(jsonb_build_object(
    'customer_id', v_c.id,
    'week_id',     v_w,
    'kind',        coalesce(nullif(p->>'kind',''), 'plan'),
    'plan_id',     p->>'plan_id',
    'size_id',     p->>'size_id',
    'breakfast_size_id', p->>'breakfast_size_id',
    'fulfillment', 'delivery',
    'items',       coalesce(p->'items', '[]'::jsonb),
    'payment_method_id', p->>'payment_method_id',
    'source',      'public_link'
  ));

  return jsonb_build_object(
    'code',        v_res->>'code',
    'total_cents', (v_res->'pricing'->>'total_cents')::int,
    'entrega',     (select ends_on from weeks where id = v_w),
    'iso_code',    (select iso_code from weeks where id = v_w),
    'first_name',  v_c.first_name
  );
end $fn$;

-- ------------------------------------------------------------------ grants
-- `anon` recebe EXECUTE e mais nada: nenhuma tabela, nenhuma view. Se um dia
-- alguém precisar de um dado novo no link, ele passa a sair de uma função
-- daqui — e aí a revisão enxerga.
grant execute on function fn_link_semana()            to anon, authenticated;
grant execute on function fn_link_catalogo()          to anon, authenticated;
grant execute on function fn_link_zip(text)           to anon, authenticated;
grant execute on function fn_link_identificar(text)   to anon, authenticated;
grant execute on function fn_link_precificar(jsonb)   to anon, authenticated;
grant execute on function fn_link_criar_pedido(jsonb) to anon, authenticated;

-- auxiliares não são porta de entrada
revoke execute on function fn_link_guard(text, text, int, interval) from public;
revoke execute on function fn_link_ip() from public;
