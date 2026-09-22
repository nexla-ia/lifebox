-- LifeBox · aviso de pedido novo para a automação
-- Ref: LIFEBOX_PROJECT.md §9.2 · telas 6j e 6p
--
-- §9.2: "ao criar o pedido, o sistema envia o template (EN/PT) com as
-- variáveis". Quem entrega a mensagem é o n8n, pela Evolution API; o que sai
-- daqui é o aviso de que existe pedido novo, já com o texto montado.
--
-- O DISPARO É DO BANCO, não do navegador. Do lado do cliente, fechar a aba
-- logo depois de confirmar perderia a mensagem, e um bloqueador ou uma rede
-- ruim também — e qualquer um poderia mandar payload inventado para o webhook.
-- Aqui ele sai na mesma operação que gravou o pedido.
--
-- `pg_net` é assíncrono de propósito: a chamada entra numa fila e o pedido é
-- devolvido para o cliente sem esperar o n8n. Se o webhook cair, o pedido
-- existe do mesmo jeito — é o que a tela 6j promete, e é a ordem certa das
-- prioridades.

do $ext$
begin
  -- o cluster local é Postgres puro e não tem pg_net; lá o dublê de
  -- net.http_post vem do 00_local_stub.sql, que grava a chamada em vez de sair
  -- na rede — é assim que o teste confere o payload sem depender do n8n
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net';
  end if;
end $ext$;

insert into settings (key, value, description) values
  ('webhook_order_confirmation',
   '"https://n8n.nexladesenvolvimento.com.br/webhook/confirma-pedido"',
   'URL que recebe o pedido novo do link público (§9.2). Vazio desliga o aviso.')
on conflict (key) do nothing;

-- ------------------------------------------------------- texto da mensagem
/** Monta a mensagem do pedido a partir do template de Configurações.
 *
 *  Devolve o texto pronto E as variáveis soltas: o texto é o que a LifeBox
 *  escreveu na tela 6p e deve sair exatamente assim; as variáveis vão junto
 *  para o n8n poder montar outra coisa sem precisar de um segundo endpoint.
 *
 *  Nome de prato em inglês sai de `dishes`, não do snapshot — `name_snapshot`
 *  é sempre português, porque é o que a cozinha lê (§5.5). Se o prato for
 *  renomeado depois, o snapshot continua mandando: é ele que descreve o que
 *  foi pedido. */
create or replace function fn_mensagem_pedido(p_order uuid, p_lang lang default 'pt')
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  o        orders%rowtype;
  c        customers%rowtype;
  w        weeks%rowtype;
  v_plano  text;
  v_tam    text;
  v_forma  text;
  v_instr  text;
  v_link   text;
  v_pratos text;
  v_addons text;
  v_data   text;
  v_corpo  text;
  v_vars   jsonb;
  v_num    text;
  k        text;
  dias_pt  text[] := array['segunda','terça','quarta','quinta','sexta','sábado','domingo'];
  dias_en  text[] := array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
begin
  select * into o from orders where id = p_order;
  if o.id is null then
    raise exception 'fn_mensagem_pedido: pedido % nao encontrado', p_order;
  end if;
  select * into c from customers where id = o.customer_id;
  select * into w from weeks where id = o.week_id;

  v_num := '#' || o.code;

  select case p_lang when 'en' then p.name_en else p.name_pt end into v_plano
    from plans p where p.id = o.plan_id;
  v_plano := coalesce(v_plano, case o.kind
    when 'custom' then case p_lang when 'en' then 'Custom' else 'Personalizado' end
    else case p_lang when 'en' then 'Add-ons only' else 'Só adicionais' end end);

  select s.name into v_tam from sizes s where s.id = o.size_id;

  select case p_lang when 'en' then pm.name_en else pm.name_pt end,
         case p_lang when 'en' then pm.instructions_en else pm.instructions_pt end,
         pm.pay_link
    into v_forma, v_instr, v_link
    from payment_methods pm where pm.id = o.payment_method_id;

  -- o link de pagamento do catálogo pode trazer {numero_pedido} dentro
  v_link := replace(coalesce(v_link, ''), '{numero_pedido}', o.code);

  select string_agg(
           case when p_lang = 'en' then coalesce(d.name_en, i.name_snapshot)
                else i.name_snapshot end || ' ×' || i.qty, ', ' order by i.position)
    into v_pratos
    from order_items i left join dishes d on d.id = i.dish_id
   where i.order_id = p_order and i.item_type = 'dish';

  select string_agg(
           case when p_lang = 'en' then coalesce(a.name_en, i.name_snapshot)
                else i.name_snapshot end || ' ×' || i.qty, ', ' order by i.position)
    into v_addons
    from order_items i left join addons a on a.id = i.addon_id
   where i.order_id = p_order and i.item_type = 'addon' and i.unit_price_cents > 0;

  -- dia da semana escrito à mão: `to_char(..., 'TMDay')` depende do lc_time do
  -- servidor, que não é o da operação e pode nem ter português instalado
  v_data := case p_lang
    when 'en' then dias_en[extract(isodow from w.ends_on)::int]
                   || ' ' || to_char(w.ends_on, 'MM/DD')
    else dias_pt[extract(isodow from w.ends_on)::int]
         || ' ' || to_char(w.ends_on, 'DD/MM') end;

  v_vars := jsonb_build_object(
    'nome',           c.first_name,
    'numero_pedido',  v_num,
    'semana',         regexp_replace(w.iso_code, '^\d+-', ''),
    'plano',          v_plano,
    'tamanho',        coalesce(v_tam, ''),
    'lista_pratos',   coalesce(v_pratos, ''),
    'adicionais',     coalesce(v_addons, ''),
    'total',          '$' || to_char(o.total_cents / 100.0, 'FM999,999,990.00'),
    'forma_pagamento', coalesce(v_forma, ''),
    'status_pagamento', case p_lang when 'en' then 'awaiting payment'
                                    else 'aguardando pagamento' end,
    'instrucoes_pagamento', coalesce(v_instr, ''),
    'link_pagamento', v_link,
    'data_entrega',   v_data);

  select body into v_corpo from message_templates
   where key = 'order_confirmation' and language = p_lang;

  if v_corpo is not null then
    for k in select jsonb_object_keys(v_vars) loop
      v_corpo := replace(v_corpo, '{' || k || '}', v_vars->>k);
    end loop;
  end if;

  return jsonb_build_object(
    'texto', v_corpo, 'idioma', p_lang::text, 'variaveis', v_vars);
end $fn$;

-- ------------------------------------------------------------------ disparo
/** Avisa a automação que entrou pedido.
 *
 *  Nunca derruba a criação do pedido: URL vazia sai calada, e qualquer erro
 *  daqui é engolido de propósito. Perder a mensagem é ruim; perder o pedido
 *  do cliente porque o n8n estava fora do ar seria pior. */
create or replace function fn_notificar_pedido(p_order uuid, p_lang lang default 'pt')
returns bigint
language plpgsql security definer set search_path = public as $fn$
declare
  v_url  text;
  v_msg  jsonb;
  o      orders%rowtype;
  c      customers%rowtype;
  v_req  bigint;
begin
  v_url := (select value #>> '{}' from settings where key = 'webhook_order_confirmation');
  if coalesce(trim(v_url), '') = '' then return null; end if;

  select * into o from orders where id = p_order;
  select * into c from customers where id = o.customer_id;
  v_msg := fn_mensagem_pedido(p_order, p_lang);

  select net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'evento',      'pedido_confirmado',
      'order_id',    o.id,
      'code',        o.code,
      'week',        (select iso_code from weeks where id = o.week_id),
      'telefone',    c.phone_e164,          -- E.164: é a chave do WhatsApp (§2)
      'nome',        c.first_name,
      'idioma',      p_lang::text,
      'total_cents', o.total_cents,
      'entrega',     (select ends_on from weeks where id = o.week_id),
      'origem',      o.source::text,
      -- texto já montado com o template de Configurações: a automação entrega,
      -- não reescreve. As variáveis vão junto para quem quiser outro formato.
      'mensagem',    v_msg->>'texto',
      'variaveis',   v_msg->'variaveis'),
    timeout_milliseconds := 5000
  ) into v_req;

  -- rastro de que saiu, e com qual id de requisição: a resposta do n8n fica em
  -- net._http_response, que é onde se confere quando a mensagem não chegou
  insert into audit_log (entity, entity_id, action, after)
  values ('order', o.id, 'webhook_confirmacao',
          jsonb_build_object('url', v_url, 'request_id', v_req));

  return v_req;
exception when others then
  insert into audit_log (entity, entity_id, action, after)
  values ('order', p_order, 'webhook_confirmacao_falhou',
          jsonb_build_object('erro', sqlerrm));
  return null;
end $fn$;

revoke execute on function fn_notificar_pedido(uuid, lang) from public;
revoke execute on function fn_mensagem_pedido(uuid, lang)  from public;
grant execute on function fn_mensagem_pedido(uuid, lang)   to authenticated;

-- ------------------------------------------------ o pedido avisa a automação
/** `fn_link_criar_pedido` de novo, agora disparando o webhook (§9.2).
 *
 *  Reescrita inteira em vez de um gatilho em `orders`: gatilho dispararia
 *  também nos pedidos que a EQUIPE lança pela tela da Semana, e a mensagem de
 *  confirmação do link é outra conversa. Quando a LifeBox quiser o mesmo aviso
 *  no lançamento manual, é uma linha em fn_create_order — decisão dela, não
 *  efeito colateral.
 *
 *  `lang` entra no payload porque a mensagem sai no idioma em que o cliente
 *  fechou o pedido, não no da equipe. */
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

  -- §9.2: avisa a automação que entrou pedido, com o texto já montado pelo
  -- template de Configurações. Vai DEPOIS do pedido gravado e nunca derruba a
  -- criação: fn_notificar_pedido engole o próprio erro.
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

grant execute on function fn_link_criar_pedido(jsonb) to anon, authenticated;
