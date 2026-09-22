-- LifeBox · o link público passa a aceitar número do Brasil
-- Ref: LIFEBOX_PROJECT.md §2, §9.7 · telas 6e e 6g
--
-- O link só aceitava `+1` e 10 dígitos. Mas a clientela da LifeBox é
-- brasileira em Boston, e quem chegou há pouco costuma manter o número do
-- Brasil no WhatsApp — e é o WhatsApp que cruza cliente, pedido e comprovante
-- (§2). Recusar esse número fechava a porta para exatamente o público do
-- negócio.
--
-- Dois formatos, e só esses dois:
--   EUA    +1  + 10 dígitos                       = 11 depois do +
--   Brasil +55 + DDD(2) + 8 ou 9 dígitos          = 12 ou 13 depois do +
--
-- Não há ambiguidade de tamanho entre eles, e é por isso que dá para aceitar
-- os dois sem chutar código de país. Continuar recusando o resto é de
-- propósito: telefone errado não dá erro visível, cria cliente duplicado e
-- some com ele na automação.

create or replace function fn_telefone_valido(p_tel text) returns boolean
language sql immutable as $fn$
  select p_tel ~ '^\+(1[0-9]{10}|55[0-9]{10,11})$'
$fn$;

comment on function fn_telefone_valido(text) is
  'E.164 dos dois países que a LifeBox atende: EUA (+1) e Brasil (+55). §2';

-- ---------------------------------------------------------------- identificar
create or replace function fn_link_identificar(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel text := trim(p_phone);
  v_c   customers%rowtype;
  v_w   uuid;
  v_o   record;
begin
  if not fn_telefone_valido(v_tel) then
    raise exception 'Telefone precisa ser dos EUA (+1 e 10 dígitos) ou do Brasil (+55 com DDD).'
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
    'pedido', case when v_o.code is null then null else jsonb_build_object(
      'code', v_o.code, 'total_cents', v_o.total_cents,
      'plano', v_o.plano, 'tamanho', v_o.tamanho) end
  );
end $fn$;

-- --------------------------------------------------------------- criar pedido
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

  -- §6.1 a tabela decide, e decide de novo aqui. O telefone pode ser do
  -- Brasil, mas a ENTREGA continua sendo em endereço atendido.
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

grant execute on function fn_telefone_valido(text)    to anon, authenticated;
grant execute on function fn_link_identificar(text)   to anon, authenticated;
grant execute on function fn_link_criar_pedido(jsonb) to anon, authenticated;
