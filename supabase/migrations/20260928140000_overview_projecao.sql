-- LifeBox · o que falta no Overview para bater com o §10
-- Ref: LIFEBOX_PROJECT.md §10 · telas 8a e 8d
--
-- Três buracos, e nenhum deles é de tela:
--
--   · o período EM ANDAMENTO mostrava o parcial como se fosse resultado. Uma
--     terça-feira sempre parece queda contra a semana fechada anterior, e a
--     leitura errada é "estamos vendendo menos" quando faltam quatro dias.
--   · não havia como ver quantos clientes ativos ainda não pediram — o número
--     que diz se vale a pena mandar mensagem antes do cutoff (tela 8d).
--   · a série só levava dinheiro, então o sparkline dos outros KPIs não tinha
--     de onde sair.
--
-- Tudo derivado dos pedidos, como o resto do Overview: o único número digitado
-- na tela continua sendo a meta.

/** Período com o quanto dele já passou, e a projeção do fechamento.
 *
 *  A projeção é regra de três sobre os DIAS decorridos, e é deliberadamente
 *  burra: não pondera dia da semana nem histórico. Uma conta que a equipe
 *  consegue refazer de cabeça é melhor do que uma que ela não sabe conferir —
 *  e ela aparece rotulada como projeção, nunca somada ao faturado. */
create or replace function fn_periodo(p_tipo text, p_chave text)
returns jsonb
language sql stable as $fn$
  with p as (
    select min(w.starts_on) as inicio, max(w.ends_on) as fim,
           coalesce(jsonb_agg(w.iso_code order by w.starts_on), '[]'::jsonb) as semanas
      from weeks w
     where w.id in (select fn_semanas_do_periodo(p_tipo, p_chave))
  ), d as (
    select inicio, fim, semanas,
           (fim - inicio + 1)                        as dias,
           (fn_hoje_operacional() - inicio + 1)      as decorridos,
           coalesce(fim >= fn_hoje_operacional()
                    and inicio <= fn_hoje_operacional(), false) as em_andamento
      from p
  )
  select jsonb_build_object(
    'tipo', p_tipo,
    'chave', p_chave,
    'inicio', inicio,
    'fim',    fim,
    'semanas', semanas,
    'em_andamento', em_andamento,
    'dias', dias,
    -- só faz sentido no período aberto; no fechado é 100 e no futuro, nulo
    'pct_decorrido', case when not em_andamento then null
                          when dias > 0 then
                            round(least(decorridos, dias)::numeric * 100 / dias, 1)
                     end)
    from d
$fn$;

/** Quantos clientes ATIVOS ainda não pediram no período (tela 8d).
 *
 *  Conta pessoa, não pedido: quem pediu duas vezes na semana continua sendo
 *  uma pessoa que já pediu. E Skip conta como respondido — quem avisou que
 *  pausa não está pendente, está resolvido. */
create or replace function fn_ativos_sem_pedido(p_tipo text, p_chave text)
returns int
language sql stable as $fn$
  select count(*)::int
    from customers c
   where c.status = 'ativo'
     and not exists (
       select 1 from customer_weeks cw
        where cw.customer_id = c.id
          and cw.week_id in (select fn_semanas_do_periodo(p_tipo, p_chave)))
$fn$;

revoke execute on function fn_ativos_sem_pedido(text, text) from public, anon;
grant  execute on function fn_ativos_sem_pedido(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E os dois consumidores: o resumo do período e a série dos gráficos.

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
                       then round(r.total_cents::numeric * 100 / v_meta, 1) else null end,
      -- Regra de três sobre os dias decorridos, e nada mais. Nunca somada ao
      -- faturado: sai rotulada como projeção, com o quanto do período já
      -- passou ao lado, para ninguém a ler como dinheiro que entrou.
      'projecao_cents', case
        when (v_periodo->>'pct_decorrido')::numeric > 0
        then round(r.total_cents / ((v_periodo->>'pct_decorrido')::numeric / 100))::int
      end,
      'projecao_pct_meta', case
        when v_meta > 0 and (v_periodo->>'pct_decorrido')::numeric > 0
        then round(
          (r.total_cents / ((v_periodo->>'pct_decorrido')::numeric / 100)) * 100 / v_meta, 1)
      end),

    'pedidos', jsonb_build_object(
      'total', r.pedidos, 'novo', r.novo, 'renovacao', r.renovacao,
      -- §10 / tela 8d: é o número que diz se vale mandar mensagem antes do
      -- cutoff. Só faz sentido com o período aberto; no fechado seria uma
      -- cobrança de algo que já passou.
      'ativos_sem_pedido', case when (v_periodo->>'em_andamento')::boolean
                                then fn_ativos_sem_pedido(p_tipo, p_chave) end,
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

create or replace function fn_overview_serie(p_tipo text, p_chave text, p_n int default 5)
returns jsonb
language plpgsql stable security invoker as $fn$
declare
  v_pago_k int; v_pagos_k int;
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

    -- o sparkline dos KPIs sai desta serie; sem o ticket por ponto, o card de
    -- ticket medio ficaria sem historico e so ele
    select coalesce(sum(o.total_cents), 0)::int, count(*)::int
      into v_pago_k, v_pagos_k
      from orders o
      join customer_weeks cw on cw.order_id = o.id
     where o.week_id = any(v_sem)
       and cw.order_status in ('novo_pedido', 'renovacao')
       and o.payment_status = 'confirmado';

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
      'pedidos', r.novo + r.renovacao,
      'ticket_medio_cents', case when v_pagos_k > 0 then (v_pago_k / v_pagos_k)::int end,
      'skip', r.skip, 'cancelamento', r.cancelamento,
      'em_andamento', (fn_periodo(p_tipo, k)->>'em_andamento')::boolean);
  end loop;

  return v_saida;
end $fn$;
