-- LifeBox · quem comprava e parou
-- Ref: reunião de 22/09/2026 — "para a gente ver algum cliente que comprou em
-- uma semana, mas não está comprando mais e evitar correr o risco de perder"
--
-- O sistema já sabia quem pediu e quem não pediu NESTA semana. O que não sabia
-- dizer é quem vinha comprando e sumiu — que é o cliente que ainda dá para
-- trazer de volta com uma mensagem, e que some sem ninguém perceber porque
-- nunca aparece numa tela de "pendências": ele não tem pedido pendente, ele
-- não tem pedido nenhum.
--
-- SKIP NÃO É SUMIÇO. Quem pausou avisou que volta, e cobrar essa pessoa é
-- tratar um cliente avisado como um cliente perdido. Ela sai da lista
-- enquanto o Skip for a última notícia dela.
--
-- CANCELAMENTO TAMBÉM NÃO, pelo motivo oposto: quem cancelou já tem o
-- follow-up da semana seguinte (§6.4), e apareceria duas vezes.

/** Clientes que compravam e pararam.
 *
 *  `p_semanas_sem` é quantas semanas seguidas sem pedido já contam como
 *  sumiço. Não vira cadastro em settings porque é pergunta de tela — a equipe
 *  muda o número para olhar mais perto ou mais longe, e cada pessoa olha de um
 *  jeito numa segunda-feira de manhã.
 *
 *  `semanas_sem_pedido` conta semanas que EXISTEM no sistema, não semanas de
 *  calendário: se a LifeBox parar duas semanas no fim do ano, ninguém vira
 *  cliente sumido por causa do recesso. */
create or replace function fn_clientes_sumindo(p_semanas_sem int default 2)
returns table (
  customer_id uuid,
  cliente text,
  telefone text,
  semanas_sem_pedido int,
  ultimo_pedido_em date,
  ultimo_total_cents int,
  pedidos_no_total int
)
language sql stable security invoker as $fn$
  with semanas as (
    -- as semanas já fechadas, da mais nova para a mais velha
    select w.id, w.ends_on,
           row_number() over (order by w.starts_on desc) as recencia
      from weeks w
     where w.ends_on < fn_hoje_operacional()
  ),
  ultima as (
    select o.customer_id,
           max(s.ends_on) as ultimo_em,
           min(s.recencia) as recencia_do_ultimo,
           count(*)::int   as pedidos
      from orders o
      join semanas s on s.id = o.week_id
     where o.canceled_at is null
     group by o.customer_id
  )
  select c.id,
         (c.first_name || ' ' || coalesce(c.last_name, ''))::text,
         c.phone_e164,
         (u.recencia_do_ultimo - 1)::int,
         u.ultimo_em,
         (select o.total_cents from orders o
           where o.customer_id = c.id and o.canceled_at is null
           order by o.created_at desc limit 1),
         u.pedidos
    from customers c
    join ultima u on u.customer_id = c.id
   where c.status = 'ativo'
     -- já comprou alguma vez: quem nunca comprou é lead, outra conversa
     and u.pedidos > 0
     and (u.recencia_do_ultimo - 1) >= p_semanas_sem
     -- quem pausou avisou que volta, e quem cancelou já tem follow-up (§6.4)
     and not exists (
       select 1 from customer_weeks cw
         join semanas s on s.id = cw.week_id
        where cw.customer_id = c.id
          and s.recencia < u.recencia_do_ultimo
          and cw.order_status in ('skip', 'cancelamento', 'follow_up'))
   order by (u.recencia_do_ultimo - 1) desc, u.ultimo_em desc
$fn$;

comment on function fn_clientes_sumindo(int) is
  'Clientes ativos que compravam e pararam (reunião de 22/09/2026). Skip e '
  'Cancelamento ficam fora: um avisou que volta, o outro já tem follow-up.';

revoke execute on function fn_clientes_sumindo(int) from public, anon;
grant  execute on function fn_clientes_sumindo(int) to authenticated;
