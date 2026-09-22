-- LifeBox · comprovante de pagamento vindo da automação
-- Ref: LIFEBOX_PROJECT.md §9.3 · tela 9c
--
-- O n8n recebe a imagem no WhatsApp, extrai os dados e chama aqui. As REGRAS
-- ficam neste arquivo, não no fluxo do n8n: são seis checagens que decidem se
-- o dinheiro entrou, e espalhá-las entre banco e automação garante que uma
-- hora as duas discordem — e aí ninguém sabe qual está certa.
--
-- §9.3 é explícito sobre a ordem das prioridades:
--   · confirmação automática SÓ se todas as checagens passarem
--   · e só se houver UM pedido aberto para aquele número
--   · na primeira fase roda em MODO SOMBRA: o sistema decide, a equipe
--     confirma. `receipt_auto_confirm` em settings liga o automático.
--
-- Quem falha em qualquer checagem não é recusado: vira `comprovante_recebido`
-- e entra na fila de conferência com o motivo registrado. O cliente recebe
-- "recebemos, estamos conferindo" — o motivo nunca vai para ele (§9.3.5).

-- ---------------------------------------------------------------- consulta
/** Pedidos de um número na semana corrente.
 *
 *  É o que a automação chama para achar o pedido: `orders` não guarda telefone,
 *  ele mora em `customers.phone_e164`, que é a chave do WhatsApp (§2).
 *
 *  Devolve LISTA. Desde 22/09/2026 o mesmo cliente pode ter mais de um pedido
 *  na semana, e §9.3 só confirma sozinho quando há um aberto. */
create or replace function fn_pedidos_do_telefone(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_c customers%rowtype; v_w uuid;
begin
  if not fn_telefone_valido(trim(p_phone)) then
    raise exception 'Telefone precisa estar em E.164 (+1 ou +55).' using errcode = 'LB400';
  end if;

  select * into v_c from customers where phone_e164 = trim(p_phone);
  if v_c.id is null then
    return jsonb_build_object('encontrado', false, 'pedidos', '[]'::jsonb);
  end if;

  select id into v_w from weeks
   where fn_hoje_operacional() between starts_on and ends_on limit 1;

  return jsonb_build_object(
    'encontrado', true,
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
       where o.customer_id = v_c.id and o.week_id = v_w), '[]'::jsonb));
end $fn$;

-- ------------------------------------------------------------- comprovante
/** Registra o comprovante e decide o que fazer (§9.3).
 *
 *  p: { phone, valor_cents, storage_path, transaction_id?, destinatario?,
 *       pago_em?, confianca?, extracted?, order_id? }
 *
 *  `order_id` é opcional: sem ele, a função procura pelo telefone. Com dois
 *  pedidos abertos ela NÃO escolhe — devolve `sem_pedido` com a lista, porque
 *  adivinhar em qual creditar é a única forma de errar dinheiro em silêncio.
 */
create or replace function fn_registrar_comprovante(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_tel     text := trim(coalesce(p->>'phone',''));
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
    if not fn_telefone_valido(v_tel) then
      raise exception 'Informe order_id ou um telefone em E.164.' using errcode = 'LB400';
    end if;
    select * into v_c from customers where phone_e164 = v_tel;

    select count(*) into v_abertos
      from orders
     where customer_id = v_c.id and week_id = v_w and payment_status <> 'confirmado';

    -- §9.3: automático só com UM pedido aberto. Zero ou vários, a equipe olha.
    if v_c.id is null or v_abertos <> 1 then
      insert into payment_receipts (
        customer_id, storage_path, sha256, extracted, transaction_id,
        check_result, check_detail, status, shadow_decision
      ) values (
        v_c.id, p->>'storage_path', v_sha, p->'extracted', v_txid,
        'sem_pedido'::receipt_check_result,
        case when v_c.id is null then 'número não está no cadastro'
             when v_abertos = 0  then 'nenhum pedido aberto nesta semana'
             else v_abertos || ' pedidos abertos — a equipe escolhe em qual creditar' end,
        'pendente'::receipt_status, false
      ) returning id into v_receipt;

      return jsonb_build_object(
        'decisao', 'conferir',
        'motivo', 'sem_pedido',
        'receipt_id', v_receipt,
        'pedidos_abertos', coalesce(v_abertos, 0),
        'detalhe', case when v_c.id is null then 'número não está no cadastro'
                        when v_abertos = 0 then 'nenhum pedido aberto nesta semana'
                        else 'mais de um pedido aberto' end);
    end if;

    select * into o
      from orders
     where customer_id = v_c.id and week_id = v_w and payment_status <> 'confirmado';
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

-- A automação entra como `service_role` (que ignora RLS) ou como um usuário da
-- equipe. Em nenhum caso isto fica aberto para o anon: é escrita de dinheiro.
revoke execute on function fn_pedidos_do_telefone(text)   from public;
revoke execute on function fn_registrar_comprovante(jsonb) from public;
grant execute on function fn_pedidos_do_telefone(text)     to authenticated, service_role;
grant execute on function fn_registrar_comprovante(jsonb)  to authenticated, service_role;
