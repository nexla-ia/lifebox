-- LifeBox · pedido mínimo por ZIP
-- Ref: reunião de 22/09/2026 — "alguns lugares são muito longe"
--
-- A LifeBox atende ZIPs em três rotas, e nem toda parada compensa a viagem.
-- Até aqui o link fechava pedido de qualquer valor em qualquer ZIP atendido.
--
-- É POR ZIP, não por rota: a Danny disse "alguns lugares", e dentro da mesma
-- rota há ponto perto e ponto longe. Rota agruparia demais e obrigaria a criar
-- rota nova só para separar mínimo, que é cadastro mexendo em cadastro.
--
-- NULO É DIFERENTE DE ZERO. Nulo = este ZIP não tem mínimo. Zero seria "mínimo
-- de R$ 0,00", que é a mesma coisa na prática mas se lê como regra configurada
-- — e aí ninguém sabe se o ZIP foi analisado ou se ficou esquecido.

alter table zip_codes add column if not exists min_order_cents int;

comment on column zip_codes.min_order_cents is
  'Valor mínimo do pedido para entregar neste ZIP, em centavos. NULO = sem '
  'mínimo (diferente de zero, que se leria como regra já decidida).';

alter table zip_codes drop constraint if exists zip_codes_min_order_positivo;
alter table zip_codes add constraint zip_codes_min_order_positivo
  check (min_order_cents is null or min_order_cents > 0);

-- ---------------------------------------------------------------------------
/** O ZIP, agora dizendo também quanto é o mínimo dele.
 *
 *  A tela precisa do valor ANTES de a pessoa montar o pedido: descobrir no
 *  botão final que faltam $20 depois de escolher dez pratos é o jeito mais
 *  rápido de perder o pedido. */
create or replace function fn_link_zip(p_zip text) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_z record;
begin
  select z.zip, z.city, z.state, z.min_order_cents, r.name as rota
    into v_z
    from zip_codes z join routes r on r.id = z.route_id
   where z.zip = trim(p_zip) and z.active and r.active;

  if v_z.zip is null then
    return jsonb_build_object('atende', false);
  end if;
  return jsonb_build_object(
    'atende', true, 'city', v_z.city, 'state', v_z.state, 'rota', v_z.rota,
    'min_order_cents', v_z.min_order_cents);
end $fn$;

revoke execute on function fn_link_zip(text) from public;
grant  execute on function fn_link_zip(text) to anon, authenticated;

/** Define o mínimo de uma CIDADE inteira de uma vez (§9.8).
 *
 *  O cadastro de ZIP é por cidade — a equipe sabe as cidades que atende, não
 *  os CEPs, e uma cidade rende cinco ZIPs. Marcar o mínimo ZIP a ZIP seria
 *  cinco cliques para uma decisão só, e bastaria esquecer um para a regra ter
 *  um buraco por onde o pedido passa.
 *
 *  `p_cents` nulo TIRA o mínimo, que é como a equipe desfaz. */
create or replace function fn_zip_minimo_cidade(p_cidade text, p_cents int)
returns int
language plpgsql security invoker as $fn$
declare v_n int;
begin
  if not is_staff() then
    raise exception 'Só a equipe define pedido mínimo.' using errcode = 'LB403';
  end if;
  if p_cents is not null and p_cents <= 0 then
    raise exception 'O mínimo precisa ser maior que zero — deixe em branco para não ter mínimo.'
      using errcode = 'LB400';
  end if;

  update zip_codes set min_order_cents = p_cents
   where lower(city) = lower(trim(p_cidade));
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function fn_zip_minimo_cidade(text, int) from public, anon;
grant  execute on function fn_zip_minimo_cidade(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- E o fechamento recusa quem não chegou ao mínimo — com a mensagem dizendo
-- QUANTO é, senão a pessoa tenta de novo às cegas.

create or replace function fn_link_criar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel   text := trim(p->>'phone');
  v_zip   text := trim(coalesce(p->>'zip_code',''));
  v_min   int;
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
    select z.route_id, z.city, z.min_order_cents into v_rota, v_city, v_min
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

  -- O mínimo é do ZIP e vale sobre o TOTAL do pedido, não sobre o subtotal:
  -- é quanto entra para a LifeBox nessa parada, que é o que decide se a
  -- viagem compensa. Só para entrega — quem retira não gera viagem nenhuma.
  if v_ful = 'delivery' and v_min is not null then
    declare v_prev jsonb; begin
      v_prev := fn_price_order(
        coalesce(nullif(p->>'kind',''), 'plan')::order_kind,
        nullif(p->>'plan_id','')::uuid,
        nullif(p->>'size_id','')::uuid,
        nullif(p->>'breakfast_size_id','')::uuid,
        v_ful,
        coalesce(p->'items', '[]'::jsonb));
      if (v_prev->>'total_cents')::int < v_min then
        raise exception 'Nesse endereço o pedido mínimo é de $%.',
          to_char(v_min / 100.0, 'FM999G999D00')
          using errcode = 'LB422';
      end if;
    end;
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
