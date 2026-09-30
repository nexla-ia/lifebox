-- LifeBox · a mensagem que não saiu tem de aparecer
-- Ref: LIFEBOX_PROJECT.md §9.2 · teste de 30/09/2026
--
-- O teste do webhook lento provou o que o desenho promete: destino pendurado
-- devolve o pedido em 62 ms, o worker estoura nos 5000 ms configurados e a
-- fila drena. O pedido nunca cai por causa do n8n.
--
-- O que ele destapou é o contrário: quando o envio falha, `fn_notificar_pedido`
-- JÁ retornou e JÁ gravou `webhook_confirmacao` no audit — dizendo que enviou.
-- A falha cai em `net._http_response`, que nenhuma tela lê e que o pg_net
-- apaga em 6 horas. Medido nos dois pedidos reais da semana:
--
--   audit diz: webhook_confirmacao (request 4) / na realidade: já expirou
--   audit diz: webhook_confirmacao (request 1) / na realidade: já expirou
--
-- Na prática: o n8n fica fora do ar dez minutos, a mensagem com as instruções
-- de pagamento não sai, o pedido fica lá bonito e ninguém é avisado. Só se
-- descobre quando o cliente não paga.
--
-- Perder a mensagem continua sendo melhor do que perder o pedido. O que não
-- pode é perder em silêncio.

create table if not exists webhook_avisos (
  request_id   bigint primary key,
  order_id     uuid not null references orders(id) on delete cascade,
  enviado_em   timestamptz not null default now(),
  conferido_em timestamptz,
  status_code  int,
  erro         text
);

comment on table webhook_avisos is
  'Um aviso de pedido disparado para a automação (§9.2). Nasce pendente e '
  'recebe o resultado depois: net._http_response some em 6 horas, então o '
  'resultado tem de ser copiado para cá enquanto ainda existe.';

-- NAO se faz backfill do audit_log. Aviso anterior a esta tabela nao tem
-- desfecho guardado em lugar nenhum, e marcar como falha o que a gente
-- simplesmente nao sabe enche a tela de alarme que a equipe nao consegue
-- resolver — inclusive em pedido JA PAGO, onde a mensagem obviamente chegou.
-- Tentei, vi os dois pedidos reais virarem "falhou", e desfiz.

create index if not exists webhook_avisos_pendentes_idx
  on webhook_avisos (conferido_em) where conferido_em is null;

alter table webhook_avisos enable row level security;

-- a equipe lê pela view; ninguém escreve direto
create policy webhook_avisos_staff_read on webhook_avisos
  for select using (is_staff());

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

  -- rastro de que saiu, e com qual id de requisição
  insert into audit_log (entity, entity_id, action, after)
  values ('order', o.id, 'webhook_confirmacao',
          jsonb_build_object('url', v_url, 'request_id', v_req));

  -- E a linha que fica: `net._http_response` some em 6 horas, e era por isso
  -- que a falha era invisível. Aqui o aviso nasce PENDENTE; quem escreve o
  -- resultado é fn_conferir_avisos, depois.
  insert into webhook_avisos (request_id, order_id)
  values (v_req, o.id) on conflict (request_id) do nothing;

  return v_req;
exception when others then
  insert into audit_log (entity, entity_id, action, after)
  values ('order', p_order, 'webhook_confirmacao_falhou',
          jsonb_build_object('erro', sqlerrm));
  return null;
end $fn$;

/** Copia o resultado dos avisos pendentes antes de o pg_net apagar.
 *
 *  Chamada pela tela da Semana ao abrir. É idempotente e barata (só os
 *  pendentes), então pode virar job do pg_cron no dia em que a LifeBox quiser
 *  — mas enquanto a equipe abre a Semana todo dia, a janela de 6 horas do
 *  pg_net está coberta sem instalar extensão nenhuma no projeto.
 *
 *  Aviso que passou do prazo e não tem resposta vira erro explícito, não
 *  "entregue por omissão": não saber se chegou é diferente de ter chegado. */
create or replace function fn_conferir_avisos() returns int
language plpgsql security definer set search_path = public, net as $fn$
declare v_n int;
begin
  if not is_staff() then
    raise exception 'Só a equipe confere os avisos.' using errcode = 'LB403';
  end if;

  update webhook_avisos a
     set status_code  = r.status_code,
         erro         = r.error_msg,
         conferido_em = now()
    from net._http_response r
   where r.id = a.request_id and a.conferido_em is null;
  get diagnostics v_n = row_count;

  -- o que o pg_net já apagou: passou de 6h sem resposta guardada. Marcar como
  -- desconhecido é o único jeito honesto — e a equipe reenvia se quiser.
  update webhook_avisos
     set erro = 'resposta expirou antes de ser conferida',
         conferido_em = now()
   where conferido_em is null
     and enviado_em < now() - interval '6 hours';

  return v_n;
end $fn$;

/** Reenvia o aviso de um pedido (§9.2).
 *
 *  Existe porque a alternativa era a equipe digitar a mensagem no WhatsApp à
 *  mão, sem o texto do template e sem o link de pagamento. */
create or replace function fn_reenviar_aviso(p_order uuid, p_lang lang default 'pt')
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_req bigint;
begin
  if not is_staff() then
    raise exception 'Só a equipe reenvia aviso.' using errcode = 'LB403';
  end if;
  if not exists (select 1 from orders where id = p_order) then
    raise exception 'Pedido não encontrado.' using errcode = 'LB409';
  end if;

  v_req := fn_notificar_pedido(p_order, p_lang);
  if v_req is null then
    raise exception 'O aviso está desligado em Configurações (webhook sem URL).'
      using errcode = 'LB400';
  end if;
  return jsonb_build_object('request_id', v_req);
end $fn$;

/** Os avisos da semana, do jeito que a tela precisa ler.
 *
 *  `security_invoker` para a RLS valer: sem isso a view seria porta dos fundos
 *  de `orders`, com telefone e dinheiro, para quem alcançasse a view. */
create or replace view v_avisos_semana
with (security_invoker = true) as
  select o.week_id,
         o.id   as order_id,
         o.code,
         a.request_id,
         a.enviado_em,
         a.status_code,
         a.erro,
         case
           when a.status_code between 200 and 299 then 'entregue'
           when a.conferido_em is null            then 'enviando'
           else 'falhou'
         end as situacao
    from webhook_avisos a
    join orders o on o.id = a.order_id;

revoke all on v_avisos_semana from public, anon;
grant select on v_avisos_semana to authenticated;

revoke execute on function fn_conferir_avisos()        from public, anon;
revoke execute on function fn_reenviar_aviso(uuid, lang) from public, anon;
grant  execute on function fn_conferir_avisos()        to authenticated, service_role;
grant  execute on function fn_reenviar_aviso(uuid, lang) to authenticated, service_role;
