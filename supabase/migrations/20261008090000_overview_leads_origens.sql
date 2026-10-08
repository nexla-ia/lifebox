-- LifeBox · o Overview quebrava em periodo sem dado
-- Ref: §10 · caca de bugs de 08/10/2026
--
-- Sintoma: a tela do Overview ficava EM BRANCO ao trocar de visao, de forma
-- intermitente. Com o ErrorBoundary no lugar virou "Esta tela nao abriu", e o
-- stack acusou `Cannot read properties of undefined (reading 'length')` dentro
-- do Dashboard. A sonda apontou o campo: `ov.leads.origens`.
--
-- A causa nao era a corrida — a corrida so tornava facil de ver. `fn_overview_leads`
-- tem um EARLY RETURN para periodo sem semana nenhuma, e esse return montava um
-- objeto com oito chaves enquanto o caminho normal monta nove. Faltava `origens`,
-- e a tela faz `ov.leads.origens.length`.
--
-- Quer dizer: QUALQUER periodo sem semana derrubava o Overview. Navegar para um
-- mes antigo bastava. A troca rapida de visao so acertava essa combinacao mais
-- depressa, porque durante a transicao a chave e a visao ficam trocadas.
--
-- A licao que fica no codigo: early return que devolve forma DIFERENTE da do
-- caminho feliz e a maneira mais discreta de quebrar quem consome — nao da erro
-- no banco, nao da erro no teste de SQL, e so aparece na tela de quem usa.

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
    -- MESMAS CHAVES do caminho normal, incluindo `origens`. Faltava ela aqui,
    -- e a tela lia `ov.leads.origens.length` — periodo sem semana derrubava o
    -- Overview inteiro. Early return que devolve uma forma diferente da do
    -- caminho feliz e a maneira mais discreta de quebrar quem consome.
    return jsonb_build_object('novos', 0, 'convertidos', 0, 'follow_up', 0,
                              'conversao', null, 'ads_leads', 0, 'ads_convertidos', 0,
                              'ads_conversao', null, 'ads_revenue_cents', 0,
                              'origens', '[]'::jsonb);
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
