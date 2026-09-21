-- LifeBox · Overview (Módulo 2)
-- Ref: LIFEBOX_PROJECT.md §10 · telas 8a, 8b, 8c, 8d, 8f
--
-- SEMANA É A UNIDADE. Mês e ano são conjuntos de semanas, e a semana entra no
-- mês da sua ENTREGA (o domingo, `ends_on`). É o que faz o §10 fechar — "a
-- visão mensal precisa bater com a soma das semanas" — e é o que o protótipo
-- mostra: setembro/2026 = W36 a W39, porque a W36 entrega dia 06/09 e a W40 já
-- entrega em outubro. Contar por dia corrido partiria a semana em dois meses e
-- nenhum dos dois fecharia.
--
-- Tudo é derivado: nada aqui é digitado, nem acumulado em contador. Se um
-- pedido mudar de status, o Overview muda junto na próxima consulta.

/** Semanas que compõem o período. `week` é a própria; `month` e `year` vão
 *  pelo domingo de entrega. */
create or replace function fn_semanas_do_periodo(p_tipo text, p_chave text)
returns setof uuid
language sql stable as $fn$
  select id from weeks
   where case p_tipo
           when 'week'  then iso_code = p_chave
           when 'month' then to_char(ends_on, 'YYYY-MM') = p_chave
           when 'year'  then to_char(ends_on, 'YYYY') = p_chave
           else false
         end
   order by starts_on
$fn$;

/** Rótulo e limites do período, para o cabeçalho e para a navegação ‹ ›. */
create or replace function fn_periodo(p_tipo text, p_chave text)
returns jsonb
language sql stable as $fn$
  select jsonb_build_object(
    'tipo', p_tipo,
    'chave', p_chave,
    'inicio', min(w.starts_on),
    'fim',    max(w.ends_on),
    'semanas', coalesce(jsonb_agg(w.iso_code order by w.starts_on), '[]'::jsonb),
    -- em andamento = o período ainda contém o hoje operacional
    'em_andamento', coalesce(max(w.ends_on) >= fn_hoje_operacional()
                             and min(w.starts_on) <= fn_hoje_operacional(), false)
  )
  from weeks w
 where w.id in (select fn_semanas_do_periodo(p_tipo, p_chave))
$fn$;

/** Os períodos que existem, para a navegação ‹ › do cabeçalho.
 *
 *  Derivar "a semana anterior" no front daria errado na virada do ano — a
 *  W01 não vem depois da W52 de todo ano, porque nem todo ano tem 52. Aqui a
 *  lista sai do que existe em `weeks`, em ordem. */
create or replace function fn_overview_periodos(p_tipo text)
returns jsonb
language sql stable as $fn$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from (
    select distinct case p_tipo
             when 'week'  then iso_code
             when 'month' then to_char(ends_on, 'YYYY-MM')
             else to_char(ends_on, 'YYYY')
           end as k
      from weeks
  ) t where k is not null
$fn$;

-- ---------------------------------------------------------------- overview
/** Todos os números de um período, numa chamada só (tela 8a).
 *
 *  A tela desenha dez blocos; dez consultas separadas fariam dez idas ao
 *  servidor para montar uma coisa que é lida de uma vez.
 *
 *  §3: exclusiva do Administrador. `security invoker` basta — a Operação não
 *  tem policy em orders/customers para leitura agregada? Tem, e por isso o
 *  guard é explícito: o Overview não é dela (tela 9d). */
create or replace function fn_overview(p_tipo text, p_chave text)
returns jsonb
language plpgsql stable security invoker as $fn$
declare
  v_semanas uuid[];
  v_periodo jsonb;
  v_meta    int;
  v_pago    int;
  v_pagos   int;
  r         record;
begin
  if not is_admin() then
    raise exception 'O Overview é exclusivo do Administrador.' using errcode = 'LB403';
  end if;

  v_semanas := array(select fn_semanas_do_periodo(p_tipo, p_chave));
  v_periodo := fn_periodo(p_tipo, p_chave);

  -- §10: a visão Semana usa a meta semanal; a visão Mês, a mensal. O ano soma
  -- as metas mensais, porque meta anual não existe em `goals`.
  select coalesce(sum(g.amount_cents), 0)::int into v_meta
    from goals g
   where (p_tipo = 'week'  and g.period_type = 'week'  and g.period_key = p_chave)
      or (p_tipo = 'month' and g.period_type = 'month' and g.period_key = p_chave)
      or (p_tipo = 'year'  and g.period_type = 'month' and g.period_key like p_chave || '-%');

  select
    coalesce(sum(s.total_pedidos), 0)::int              as pedidos,
    coalesce(sum(s.novo_pedido), 0)::int                as novo,
    coalesce(sum(s.renovacao), 0)::int                  as renovacao,
    coalesce(sum(s.skip), 0)::int                       as skip,
    coalesce(sum(s.cancelamento), 0)::int               as cancelamento,
    coalesce(sum(s.parceria), 0)::int                   as parceria,
    coalesce(sum(s.aguardando_selecao), 0)::int         as aguardando,
    coalesce(sum(s.pedidos_cents), 0)::int              as total_cents,
    coalesce(sum(s.faturado_cents), 0)::int             as faturado_cents,
    coalesce(sum(s.a_receber_cents), 0)::int            as a_receber_cents,
    coalesce(sum(s.parceria_valor_comercial_cents), 0)::int as parceria_cents
    into r
    from v_week_summary s
   where s.week_id = any(v_semanas);

  -- §10 manda "faturado ÷ pedidos pagos". O protótipo (8f) divide o total pelo
  -- número de pedidos e dá outro número; o documento-mestre vence e o conflito
  -- está em DECISOES-ABERTAS item 9. Os dois saem daqui, com nomes diferentes,
  -- para virar a chave ser uma linha de tela.
  select coalesce(sum(o.total_cents), 0)::int, count(*)::int into v_pago, v_pagos
    from orders o
    join customer_weeks cw on cw.order_id = o.id
   where o.week_id = any(v_semanas)
     and cw.order_status in ('novo_pedido', 'renovacao')
     and o.payment_status = 'confirmado';

  return jsonb_build_object(
    'periodo', v_periodo,
    'meta_cents', v_meta,

    'faturamento', jsonb_build_object(
      'total_cents',     r.total_cents,
      'faturado_cents',  r.faturado_cents,
      'a_receber_cents', r.a_receber_cents,
      'pct_meta', case when v_meta > 0
                       then round(r.total_cents::numeric * 100 / v_meta, 1) else null end),

    'pedidos', jsonb_build_object(
      'total', r.pedidos, 'novo', r.novo, 'renovacao', r.renovacao,
      'skip', r.skip, 'cancelamento', r.cancelamento, 'parceria', r.parceria,
      'aguardando_selecao', r.aguardando),

    'ticket_medio_cents', case when v_pagos > 0 then (v_pago / v_pagos)::int end,
    'ticket_pagos', v_pagos,
    'ticket_por_pedido_cents', case when r.pedidos > 0
                                    then (r.total_cents / r.pedidos)::int end,

    -- §10 taxa de renovação = renovações ÷ clientes com pedido na semana anterior
    'renovacao', fn_overview_renovacao(v_semanas),

    'leads', fn_overview_leads(v_semanas),

    -- §10 mix SEM adicionais: Detox e suco são produto, não plano
    'mix_planos', coalesce((
      select jsonb_agg(x order by x->>'qtd' desc) from (
        select jsonb_build_object('plano', coalesce(p.name_pt, 'Personalizado'),
                                  'qtd', count(*)::int) as x
          from orders o
          join customer_weeks cw on cw.order_id = o.id
          left join plans p on p.id = o.plan_id
         where o.week_id = any(v_semanas)
           and cw.order_status in ('novo_pedido','renovacao')
           and o.kind in ('plan','custom')
         group by p.name_pt) t), '[]'::jsonb),

    'mix_tamanhos', coalesce((
      select jsonb_agg(jsonb_build_object('size', s.code, 'qtd', q) order by s.position)
        from (select o.size_id, count(*)::int as q
                from orders o
                join customer_weeks cw on cw.order_id = o.id
               where o.week_id = any(v_semanas)
                 and cw.order_status in ('novo_pedido','renovacao')
                 and o.size_id is not null
               group by o.size_id) t
        join sizes s on s.id = t.size_id), '[]'::jsonb),

    'adicionais', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd, 'valor_cents', valor)
                       order by valor desc)
        from (select i.name_snapshot as nome, sum(i.qty)::int as qtd,
                     sum(i.qty * i.unit_price_cents)::int as valor
                from order_items i
                join orders o on o.id = i.order_id
               where o.week_id = any(v_semanas)
                 and i.item_type = 'addon' and i.unit_price_cents > 0
               group by i.name_snapshot) t), '[]'::jsonb),

    'parcerias', jsonb_build_object(
      'qtd', r.parceria, 'valor_comercial_cents', r.parceria_cents),

    -- o que a cozinha mais fez: linha `dish`, que é o prato de verdade
    'top_pratos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd) order by qtd desc)
        from (select i.name_snapshot as nome, sum(i.qty)::int as qtd
                from order_items i
                join orders o on o.id = i.order_id
               where o.week_id = any(v_semanas) and i.item_type = 'dish'
               group by i.name_snapshot
               order by 2 desc limit 8) t), '[]'::jsonb)
  );
end $fn$;

-- ------------------------------------------------------------- renovação §10
/** Renovações ÷ clientes com pedido na semana ANTERIOR.
 *
 *  Num mês, a base é a semana anterior à primeira do período — não a soma das
 *  bases de cada semana, que contaria o mesmo cliente várias vezes. */
create or replace function fn_overview_renovacao(p_semanas uuid[])
returns jsonb
language plpgsql stable as $fn$
declare v_primeira date; v_base int; v_renovou int;
begin
  select min(starts_on) into v_primeira from weeks where id = any(p_semanas);
  if v_primeira is null then
    return jsonb_build_object('base', 0, 'renovou', 0, 'taxa', null);
  end if;

  select count(*)::int into v_base
    from customer_weeks cw
    join weeks w on w.id = cw.week_id
   where w.starts_on = v_primeira - 7
     and cw.order_status in ('novo_pedido','renovacao');

  select coalesce(sum(s.renovacao), 0)::int into v_renovou
    from v_week_summary s where s.week_id = any(p_semanas);

  return jsonb_build_object(
    'base', v_base, 'renovou', v_renovou,
    'taxa', case when v_base > 0
                 then round(v_renovou::numeric * 100 / v_base, 1) end);
end $fn$;

-- ----------------------------------------------------------------- leads §10
/** Funil e conversão.
 *
 *  Fica tudo em zero até a automação do n8n criar lead a partir da conversa
 *  (§9.1) — é ela quem alimenta `leads`. A tela diz isso em vez de mostrar
 *  "0%" como se fosse desempenho ruim.
 *
 *  §10: % Conversão Total = convertidos ÷ New Leads; % Conversão ADS =
 *  convertidos Ads ÷ leads Ads; Ads Revenue = faturamento dos novos clientes
 *  vindos de Ads. */
create or replace function fn_overview_leads(p_semanas uuid[])
returns jsonb
language plpgsql stable as $fn$
declare
  v_ini date; v_fim date;
  v_novos int; v_conv int; v_follow int;
  v_ads int; v_ads_conv int; v_ads_rev int;
begin
  select min(starts_on), max(ends_on) into v_ini, v_fim
    from weeks where id = any(p_semanas);
  if v_ini is null then
    return jsonb_build_object('novos', 0, 'convertidos', 0, 'follow_up', 0,
                              'conversao', null, 'ads_leads', 0, 'ads_convertidos', 0,
                              'ads_conversao', null, 'ads_revenue_cents', 0);
  end if;

  select count(*)::int into v_novos
    from leads l
   where l.first_contact_at::date between v_ini and v_fim;

  select count(*)::int into v_conv
    from leads l where l.converted_week_id = any(p_semanas);

  -- em contato, ainda sem pedido, dentro da janela de follow_up_weeks
  select count(*)::int into v_follow
    from leads l
   where l.converted_at is null
     and l.first_contact_at::date
         > v_fim - (coalesce(setting_num('follow_up_weeks'), 3) * 7)::int
     and l.first_contact_at::date <= v_fim;

  select count(*)::int,
         count(*) filter (where l.converted_week_id = any(p_semanas))::int
    into v_ads, v_ads_conv
    from leads l
    join sources s on s.id = l.source_id
   where lower(s.name) = 'ads'
     and l.first_contact_at::date between v_ini and v_fim;

  select coalesce(sum(o.total_cents), 0)::int into v_ads_rev
    from orders o
    join customer_weeks cw on cw.order_id = o.id
    join customers c on c.id = o.customer_id
    join sources s on s.id = c.source_id
   where o.week_id = any(p_semanas)
     and cw.order_status = 'novo_pedido'
     and lower(s.name) = 'ads';

  return jsonb_build_object(
    'novos', v_novos, 'convertidos', v_conv, 'follow_up', v_follow,
    'conversao', case when v_novos > 0
                      then round(v_conv::numeric * 100 / v_novos, 1) end,
    'ads_leads', v_ads, 'ads_convertidos', v_ads_conv,
    'ads_conversao', case when v_ads > 0
                          then round(v_ads_conv::numeric * 100 / v_ads, 1) end,
    'ads_revenue_cents', v_ads_rev,
    'origens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', nome, 'leads', leads, 'convertidos', conv,
               'pct', case when leads > 0
                           then round(conv::numeric * 100 / leads, 1) end)
             order by conv desc, leads desc)
        from (select s.name as nome, count(*)::int as leads,
                     count(*) filter (where l.converted_week_id = any(p_semanas))::int as conv
                from leads l join sources s on s.id = l.source_id
               where l.first_contact_at::date between v_ini and v_fim
               group by s.name) t), '[]'::jsonb));
end $fn$;

-- ------------------------------------------------------------------- série
/** Os N períodos até `p_chave`, para os gráficos (tela 8a).
 *
 *  Traz a meta e o mesmo período do ano anterior na mesma linha: sem isso a
 *  tela faria N+N consultas para desenhar uma barra com duas referências. */
create or replace function fn_overview_serie(p_tipo text, p_chave text, p_n int default 5)
returns jsonb
language plpgsql stable security invoker as $fn$
declare
  v_chaves text[];
  v_fim    date;
  v_saida  jsonb := '[]'::jsonb;
  k        text;
  v_sem    uuid[];
  v_ant    text;
  r        record;
  v_meta   int;
  v_ano_ant int;
begin
  if not is_admin() then
    raise exception 'O Overview é exclusivo do Administrador.' using errcode = 'LB403';
  end if;

  select max(ends_on) into v_fim from weeks
   where id in (select fn_semanas_do_periodo(p_tipo, p_chave));
  if v_fim is null then return '[]'::jsonb; end if;

  -- as N chaves anteriores, inclusive a atual
  if p_tipo = 'week' then
    select array_agg(iso_code order by starts_on) into v_chaves
      from (select iso_code, starts_on from weeks
             where ends_on <= v_fim order by starts_on desc limit p_n) t;
  elsif p_tipo = 'month' then
    select array_agg(m order by m) into v_chaves
      from (select distinct to_char(ends_on, 'YYYY-MM') as m from weeks
             where ends_on <= v_fim order by 1 desc limit p_n) t;
  else
    select array_agg(a order by a) into v_chaves
      from (select distinct to_char(ends_on, 'YYYY') as a from weeks
             where ends_on <= v_fim order by 1 desc limit p_n) t;
  end if;

  foreach k in array coalesce(v_chaves, '{}') loop
    v_sem := array(select fn_semanas_do_periodo(p_tipo, k));

    select coalesce(sum(s.pedidos_cents), 0)::int  as total,
           coalesce(sum(s.faturado_cents), 0)::int as faturado,
           coalesce(sum(s.novo_pedido), 0)::int    as novo,
           coalesce(sum(s.renovacao), 0)::int      as renovacao,
           coalesce(sum(s.skip), 0)::int           as skip,
           coalesce(sum(s.cancelamento), 0)::int   as cancelamento
      into r
      from v_week_summary s where s.week_id = any(v_sem);

    select coalesce(sum(g.amount_cents), 0)::int into v_meta
      from goals g
     where (p_tipo = 'week'  and g.period_type = 'week'  and g.period_key = k)
        or (p_tipo = 'month' and g.period_type = 'month' and g.period_key = k)
        or (p_tipo = 'year'  and g.period_type = 'month' and g.period_key like k || '-%');

    -- mesmo período do ano anterior: a linha de referência do gráfico
    v_ant := case p_tipo
               when 'week'  then (substring(k from 1 for 4)::int - 1)::text
                                 || substring(k from 5)
               when 'month' then (substring(k from 1 for 4)::int - 1)::text
                                 || substring(k from 5)
               else (k::int - 1)::text
             end;
    select coalesce(sum(s.pedidos_cents), 0)::int into v_ano_ant
      from v_week_summary s
     where s.week_id in (select fn_semanas_do_periodo(p_tipo, v_ant));

    v_saida := v_saida || jsonb_build_object(
      'chave', k,
      'rotulo', case p_tipo when 'week' then regexp_replace(k, '^\d+-', '') else k end,
      'total_cents', r.total, 'faturado_cents', r.faturado,
      'meta_cents', v_meta, 'ano_anterior_cents', v_ano_ant,
      'novo', r.novo, 'renovacao', r.renovacao,
      'skip', r.skip, 'cancelamento', r.cancelamento,
      'em_andamento', (fn_periodo(p_tipo, k)->>'em_andamento')::boolean);
  end loop;

  return v_saida;
end $fn$;

-- --------------------------------------------------------------- drill-down
/** A lista por trás de um número (tela 8c).
 *
 *  §10: "clicar em qualquer número, barra ou fatia abre a lista de clientes ou
 *  pedidos que o compõe". Sem isso o dashboard é um cartaz — com isso, cada
 *  número tem de onde ser explicado. */
create or replace function fn_overview_lista(
  p_tipo text, p_chave text, p_recorte text
) returns jsonb
language plpgsql stable security invoker as $fn$
declare v_sem uuid[];
begin
  if not is_admin() then
    raise exception 'O Overview é exclusivo do Administrador.' using errcode = 'LB403';
  end if;
  v_sem := array(select fn_semanas_do_periodo(p_tipo, p_chave));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'customer_id', c.id,
             'cliente', (c.first_name || ' ' || coalesce(c.last_name, ''))::text,
             'code', o.code,
             'plano', p.name_pt,
             'tamanho', s.code,
             'rota', rt.name,
             'total_cents', o.total_cents,
             'pagamento', o.payment_status,
             'status', cw.order_status)
           order by c.first_name)
      from customer_weeks cw
      join customers c on c.id = cw.customer_id
      left join orders o on o.id = cw.order_id
      left join plans p on p.id = o.plan_id
      left join sizes s on s.id = o.size_id
      left join routes rt on rt.id = c.route_id
     where cw.week_id = any(v_sem)
       and case p_recorte
             when 'total'        then cw.order_status in ('novo_pedido','renovacao')
             when 'novo'         then cw.order_status = 'novo_pedido'
             when 'renovacao'    then cw.order_status = 'renovacao'
             when 'skip'         then cw.order_status = 'skip'
             when 'cancelamento' then cw.order_status = 'cancelamento'
             when 'parceria'     then cw.order_status = 'parceria'
             when 'faturado'     then cw.order_status in ('novo_pedido','renovacao')
                                     and o.payment_status = 'confirmado'
             when 'a_receber'    then cw.order_status in ('novo_pedido','renovacao')
                                     and o.payment_status <> 'confirmado'
             else false
           end), '[]'::jsonb);
end $fn$;

grant execute on function fn_semanas_do_periodo(text, text) to authenticated;
grant execute on function fn_overview_periodos(text)        to authenticated;
grant execute on function fn_periodo(text, text)            to authenticated;
grant execute on function fn_overview(text, text)           to authenticated;
grant execute on function fn_overview_serie(text, text, int) to authenticated;
grant execute on function fn_overview_lista(text, text, text) to authenticated;

-- auxiliares das funções acima, não porta de entrada
revoke execute on function fn_overview_renovacao(uuid[]) from public;
revoke execute on function fn_overview_leads(uuid[])     from public;
