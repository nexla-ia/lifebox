-- LifeBox · a hora como a LifeBox lê
-- Ref: LIFEBOX_PROJECT.md §2 · fuso operacional em settings
--
-- `created_at` é `timestamptz` e sai em UTC na API: o pedido das 16:48 aparece
-- como 20:48. Está certo — e é ilegível para quem confere comprovante olhando
-- o relógio da cozinha.
--
-- O QUE NÃO SE FAZ: gravar uma segunda coluna com a hora local. Viraria uma
-- segunda verdade, e ela erra sozinha — America/New_York é -4 agora e **-5 a
-- partir de 01/11/2026**, quando acaba o horário de verão. Um valor gravado
-- com o deslocamento de hoje fica uma hora errado no inverno, e a checagem de
-- "pagamento anterior ao pedido" (§9.3) passaria a recusar comprovante bom.
--
-- Manaus é -4 o ano inteiro, Boston não. A conversão tem que ser DERIVADA, com
-- o nome do fuso, que é o que o Postgres sabe resolver data a data.

/** O fuso da operação, de settings. Nunca literal no código. */
create or replace function fn_fuso_operacional() returns text
language sql stable as $fn$
  select coalesce((select value #>> '{}' from settings where key = 'timezone'),
                  'America/New_York')
$fn$;

/** timestamptz → a hora que o relógio da cozinha mostra. */
create or replace function fn_hora_local(p_ts timestamptz) returns timestamp
language sql stable as $fn$
  select p_ts at time zone fn_fuso_operacional()
$fn$;

comment on function fn_hora_local(timestamptz) is
  'Hora no fuso operacional. Derivada de propósito: o deslocamento muda com o '
  'horário de verão, então guardar o número seria guardar um erro futuro.';

revoke execute on function fn_fuso_operacional()            from public, anon;
revoke execute on function fn_hora_local(timestamptz)       from public, anon;
grant  execute on function fn_fuso_operacional()            to authenticated, service_role;
grant  execute on function fn_hora_local(timestamptz)       to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A visão que a automação consulta direto, sem join e já na hora de lá.
--
-- `security_invoker` é o que faz a RLS continuar valendo: view comum roda com
-- os direitos de QUEM A CRIOU, então sem isso a Cozinha leria pedido, telefone
-- e dinheiro por aqui — exatamente o que o §3 fecha em `orders`.
create or replace view v_pedido_automacao
with (security_invoker = true) as
  select o.id                as order_id,
         o.code,
         o.phone_e164,
         w.iso_code          as semana,
         o.payment_status,
         o.total_cents,
         o.paid_amount_cents,
         o.total_cents - o.paid_amount_cents as em_aberto_cents,
         o.created_at,
         fn_hora_local(o.created_at) as created_at_local,
         fn_fuso_operacional()       as fuso
    from orders o
    join weeks  w on w.id = o.week_id;

comment on view v_pedido_automacao is
  'Pedido + telefone + hora local, para o fluxo de comprovante do n8n (§9.3). '
  'Sem nome, endereço nem nota: o que cruza comprovante é número e valor.';

revoke all on v_pedido_automacao from public, anon;
grant select on v_pedido_automacao to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A automação passa a receber a hora local junto, e a checagem de "pagamento
-- anterior ao pedido" passa a cortar no fuso certo.

create or replace function fn_pedidos_do_telefone(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_c customers%rowtype; v_w uuid; v_tel text; v_chave text;
begin
  -- aceita como a Evolution entrega (`17744148199`, sem o `+`)
  v_tel := fn_telefone_normalizar(p_phone);
  if v_tel is null then
    raise exception 'Telefone não reconhecido: esperado EUA (10 dígitos) ou Brasil (+55 com DDD).'
      using errcode = 'LB400';
  end if;
  v_chave := fn_telefone_chave(v_tel);

  select id into v_w from weeks
   where fn_hoje_operacional() between starts_on and ends_on limit 1;

  -- o cliente sai do proprio pedido; sem pedido nenhum, tenta o cadastro so
  -- para a equipe saber se o numero e conhecido
  select c.* into v_c
    from orders o join customers c on c.id = o.customer_id
   where fn_telefone_chave(o.phone_e164) = v_chave and o.week_id = v_w
   order by o.code limit 1;
  if v_c.id is null then
    select * into v_c from customers
     where fn_telefone_chave(phone_e164) = v_chave limit 1;
  end if;

  return jsonb_build_object(
    'fuso', fn_fuso_operacional(),
    'encontrado', v_c.id is not null,
    'customer_id', v_c.id,
    'nome', v_c.first_name,
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id,
               'code', o.code,
               'semana', w.iso_code,
               'total_cents', o.total_cents,
               'pago_cents', o.paid_amount_cents,
               'em_aberto_cents', o.total_cents - o.paid_amount_cents,
               'payment_status', o.payment_status,
               'aberto', o.payment_status <> 'confirmado',
               'criado_em', o.created_at,
               -- a hora do relógio da cozinha, para conferir contra o
               -- comprovante sem ninguém ter de somar ou subtrair nada
               'criado_em_local',
                 to_char(fn_hora_local(o.created_at), 'YYYY-MM-DD HH24:MI:SS'))
             order by o.code)
        from orders o join weeks w on w.id = o.week_id
       where fn_telefone_chave(o.phone_e164) = v_chave
         and o.week_id = v_w), '[]'::jsonb));
end $fn$;

create or replace function fn_registrar_comprovante(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel     text := fn_telefone_normalizar(p->>'phone');
  v_valor   int  := coalesce((p->>'valor_cents')::int, 0);
  v_txid    text := nullif(trim(coalesce(p->>'transaction_id','')), '');
  v_dest    text := nullif(trim(coalesce(p->>'destinatario','')), '');
  v_pago_em timestamptz := nullif(p->>'pago_em','')::timestamptz;
  v_conf    numeric := nullif(p->>'confianca','')::numeric;
  v_sha     text := nullif(trim(coalesce(p->>'sha256','')), '');
  v_auto    boolean := coalesce(setting_bool('receipt_auto_confirm'), false);
  v_conf_min numeric := coalesce(setting_num('receipt_confidence_min'), 0.9);
  v_c       customers%rowtype;
  v_w       uuid;
  o         orders%rowtype;
  v_abertos int;
  v_check   receipt_check_result := 'ok';
  v_detalhe text := '';
  v_passou  boolean;
  v_receipt uuid;
begin
  if coalesce(p->>'storage_path','') = '' then
    raise exception 'storage_path é obrigatório: o comprovante tem de ficar guardado.'
      using errcode = 'LB400';
  end if;

  select id into v_w from weeks
   where fn_hoje_operacional() between starts_on and ends_on limit 1;

  -- 1) achar o pedido
  if coalesce(p->>'order_id','') <> '' then
    select * into o from orders where id = (p->>'order_id')::uuid;
  else
    if v_tel is null then
      raise exception 'Informe order_id ou um telefone reconhecível (EUA ou +55).'
        using errcode = 'LB400';
    end if;
    -- pelo número DO PEDIDO: é para ele que a mensagem foi e por ele que o
    -- comprovante volta. Cliente que trocou de número no meio do caminho
    -- continua batendo com o pedido certo.
    select count(*) into v_abertos
      from orders
     where fn_telefone_chave(phone_e164) = fn_telefone_chave(v_tel)
       and week_id = v_w and payment_status <> 'confirmado';

    -- só para o registro do comprovante ficar ligado a alguém quando não há
    -- pedido: aqui o número pode ser de quem nunca pediu
    select * into v_c from customers
     where fn_telefone_chave(phone_e164) = fn_telefone_chave(v_tel) limit 1;

    -- §9.3: automático só com UM pedido aberto. Zero ou vários, a equipe olha.
    if v_abertos <> 1 then
      insert into payment_receipts (
        customer_id, storage_path, sha256, extracted, transaction_id,
        check_result, check_detail, status, shadow_decision
      ) values (
        v_c.id, p->>'storage_path', v_sha, p->'extracted', v_txid,
        'sem_pedido'::receipt_check_result,
        case when v_abertos = 0 and v_c.id is null then 'número não está no cadastro'
             when v_abertos = 0  then 'nenhum pedido aberto nesta semana neste número'
             else v_abertos || ' pedidos abertos — a equipe escolhe em qual creditar' end,
        'pendente'::receipt_status, false
      ) returning id into v_receipt;

      return jsonb_build_object(
        'decisao', 'conferir',
        'motivo', 'sem_pedido',
        'receipt_id', v_receipt,
        'pedidos_abertos', coalesce(v_abertos, 0),
        'detalhe', case when v_abertos = 0 and v_c.id is null then 'número não está no cadastro'
                        when v_abertos = 0 then 'nenhum pedido aberto nesta semana neste número'
                        else 'mais de um pedido aberto' end);
    end if;

    select * into o
      from orders
     where fn_telefone_chave(phone_e164) = fn_telefone_chave(v_tel)
       and week_id = v_w and payment_status <> 'confirmado';
  end if;

  if o.id is null then
    raise exception 'Pedido não encontrado.' using errcode = 'LB409';
  end if;

  -- 2) as checagens do §9.3, na ordem em que importam
  --    (hash e transaction_id inéditos vêm primeiro: comprovante repetido é
  --     o único caso em que o dinheiro NÃO entrou de novo)
  if v_txid is not null and exists (
       select 1 from payment_receipts where transaction_id = v_txid) then
    v_check := 'duplicado'; v_detalhe := 'transaction_id já usado em outro comprovante';
  elsif v_sha is not null and exists (
       select 1 from payment_receipts where sha256 = v_sha) then
    v_check := 'duplicado'; v_detalhe := 'imagem idêntica já recebida';
  elsif v_valor <> (o.total_cents - o.paid_amount_cents) then
    v_check := 'valor_divergente';
    v_detalhe := 'em aberto ' || (o.total_cents - o.paid_amount_cents)
                 || ', comprovante ' || v_valor;
  elsif v_dest is not null and not exists (
       select 1 from payment_methods pm
        where pm.active and v_dest = any(pm.recipient_keys)) then
    v_check := 'destinatario_nao_reconhecido';
    v_detalhe := 'destinatário "' || v_dest || '" não está cadastrado em Formas de pagamento';
  elsif v_pago_em is not null
        and v_pago_em < date_trunc('day', fn_hora_local(o.created_at))
                        at time zone fn_fuso_operacional() then
    -- O corte é a meia-noite do dia do pedido NO FUSO DA OPERAÇÃO. Com
    -- `created_at::date` o corte saía no fuso do servidor, que é UTC: pedido
    -- feito às 21h de Boston já conta como do dia seguinte lá, e o pagamento
    -- da mesma noite viraria "anterior ao pedido". Recusaria comprovante bom.
    v_check := 'valor_divergente';
    v_detalhe := 'pagamento ' || to_char(fn_hora_local(v_pago_em), 'DD/MM HH24:MI')
                 || ' é anterior ao pedido, de '
                 || to_char(fn_hora_local(o.created_at), 'DD/MM HH24:MI');
  elsif v_conf is not null and v_conf < v_conf_min then
    v_check := 'baixa_confianca';
    v_detalhe := 'confiança ' || v_conf || ' abaixo de ' || v_conf_min;
  end if;

  v_passou := v_check = 'ok';

  -- O comprovante repetido PRECISA ficar registrado — é o rastro de que alguém
  -- mandou duas vezes — mas `transaction_id` e `sha256` são únicos, que é
  -- justamente o que detectou a repetição. Gravar de novo esbarraria na
  -- própria proteção, então a linha entra sem eles; o valor tentado fica em
  -- `check_detail` e em `extracted`.
  if v_check = 'duplicado' then
    v_detalhe := v_detalhe || coalesce(' (' || v_txid || ')', '');
    v_txid := null;
    v_sha := null;
  end if;

  -- 3) §9.3.9 MODO SOMBRA: passando tudo, o sistema diz que confirmaria — mas
  --    só confirma se `receipt_auto_confirm` estiver ligado. A primeira fase
  --    roda desligada de propósito, para a LifeBox comparar antes de confiar.
  insert into payment_receipts (
    order_id, customer_id, storage_path, sha256, phash, extracted,
    transaction_id, check_result, check_detail, status, shadow_decision
  ) values (
    o.id, o.customer_id, p->>'storage_path', v_sha, nullif(p->>'phash',''),
    p->'extracted', v_txid, v_check, nullif(v_detalhe, ''),
    (case when v_passou and v_auto then 'aprovado' else 'pendente' end)::receipt_status,
    v_passou
  ) returning id into v_receipt;

  if v_passou and v_auto then
    update orders
       set payment_status = 'confirmado',
           paid_amount_cents = total_cents,
           confirmed_by_kind = 'auto',
           confirmed_at = now(),
           updated_at = now()
     where id = o.id;
  else
    -- §9.3.4: o que não confirma vira "comprovante recebido" e entra na fila
    update orders
       set payment_status = case when payment_status = 'aguardando_pagamento'
                                 then 'comprovante_recebido' else payment_status end,
           updated_at = now()
     where id = o.id;
  end if;

  insert into audit_log (entity, entity_id, action, after)
  values ('order', o.id, 'comprovante',
          jsonb_build_object('receipt_id', v_receipt, 'check', v_check,
                             'auto', v_passou and v_auto));

  return jsonb_build_object(
    'decisao', case when v_passou and v_auto then 'confirmado' else 'conferir' end,
    'motivo', v_check,
    'detalhe', nullif(v_detalhe, ''),
    'receipt_id', v_receipt,
    'order_id', o.id,
    'code', o.code,
    'payment_status', (select payment_status from orders where id = o.id),
    -- em modo sombra isto é o que o sistema TERIA feito: é o número que a
    -- LifeBox compara antes de ligar o automático
    'teria_confirmado', v_passou,
    'modo_sombra', not v_auto);
end $fn$;

revoke execute on function fn_pedidos_do_telefone(text)    from public, anon;
revoke execute on function fn_registrar_comprovante(jsonb) from public, anon, authenticated;
grant  execute on function fn_pedidos_do_telefone(text)    to authenticated, service_role;
grant  execute on function fn_registrar_comprovante(jsonb) to service_role;
