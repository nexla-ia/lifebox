-- LifeBox · o número como a Evolution entrega
-- Ref: LIFEBOX_PROJECT.md §2, §9.3
--
-- O JID do WhatsApp não tem o `+`: `17744148199@s.whatsapp.net`. O n8n extrai
-- `17744148199` e manda para cá — e `fn_telefone_valido` recusava, porque ela
-- cobra E.164 com o `+`. A automação levaria LB400 no lugar do pedido.
--
-- Quem normaliza é o banco, não o fluxo do n8n. A mesma regra está em
-- `src/lib/telefone.ts` para o formulário; espalhá-la por um terceiro lugar,
-- num nó de Function, garante que uma hora discordem — e errar telefone não dá
-- erro visível: cria cliente duplicado e some com o pedido na automação (§2).

/** Qualquer jeito que o número chegue → E.164, ou NULL se for ambíguo.
 *
 *  Espelha `normalizarTelefone` em `src/lib/telefone.ts`, inclusive no que
 *  RECUSA: chutar código de país é pior do que devolver nada. 10 dígitos são
 *  dos EUA mesmo começando em 55 — 551 é código de área de New Jersey. */
create or replace function fn_telefone_normalizar(p_tel text) returns text
language sql immutable as $fn$
  with d as (select regexp_replace(coalesce(p_tel, ''), '[^0-9]', '', 'g') as n)
  select case
           when length(n) = 10                             then '+1' || n
           when length(n) = 11 and left(n, 1) = '1'         then '+' || n
           when length(n) in (12, 13) and left(n, 2) = '55' then '+' || n
           else null
         end
    from d
$fn$;

comment on function fn_telefone_normalizar(text) is
  'Aceita +1 (774) 414-8199, 7744148199 ou 17744148199 (JID da Evolution) e '
  'devolve +17744148199. NULL no que for ambíguo. Espelha src/lib/telefone.ts.';

/** Chave de comparação de telefone — e ela existe por causa do Brasil.
 *
 *  O WhatsApp devolve o JID brasileiro ora com o nono dígito, ora sem:
 *  `5569992695898` e `556992695898` são a MESMA pessoa. Comparar com `=`
 *  acharia o pedido numa semana e não na outra, sem dar erro nenhum.
 *
 *  Para o Brasil a chave é +55 + DDD + os 8 últimos dígitos, que é a parte
 *  que não muda. EUA não tem esse problema: 10 dígitos, sempre. */
create or replace function fn_telefone_chave(p_tel text) returns text
language sql immutable as $fn$
  select case
           when p_tel is null       then null
           when left(p_tel, 3) = '+55'
             then '+55' || substring(p_tel from 4 for 2) || right(p_tel, 8)
           else p_tel
         end
$fn$;

-- a busca da automação passa a ser por esta chave
create index if not exists orders_telefone_chave_idx
  on orders (fn_telefone_chave(phone_e164));

revoke execute on function fn_telefone_normalizar(text) from public, anon;
revoke execute on function fn_telefone_chave(text)      from public, anon;
grant  execute on function fn_telefone_normalizar(text) to authenticated, service_role;
grant  execute on function fn_telefone_chave(text)      to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- As duas funções da automação passam a normalizar a entrada e a comparar pela
-- chave. Nada muda para quem já manda E.164 certinho.

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
               'criado_em', o.created_at)
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
  elsif v_pago_em is not null and v_pago_em < o.created_at::date then
    v_check := 'valor_divergente';
    v_detalhe := 'pagamento anterior à criação do pedido';
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
