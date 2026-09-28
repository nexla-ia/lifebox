-- LifeBox · a ordem em que o driver entrega
-- Ref: LIFEBOX_PROJECT.md §6.7 · reunião de 22/09/2026
--
-- A folha saía ordenada por código do pedido, que é a ordem em que os pedidos
-- entraram — não tem nada a ver com o trajeto. Quem dirige reordenava de
-- cabeça toda semana.
--
-- `delivery_seq` é por SEMANA, não do cliente: o trajeto muda conforme quem
-- pediu naquela semana. Nulo = ainda não classificado, e esses vão para o fim
-- na ordem do código, para parada nova não se perder no meio do que já foi
-- organizado.

alter table orders add column if not exists delivery_seq int;

comment on column orders.delivery_seq is
  'Ordem de entrega dentro da rota, definida arrastando na Montagem. Nula '
  'enquanto ninguém classificou — aí a parada vai para o fim da folha.';

create index if not exists orders_delivery_seq_idx
  on orders (week_id, delivery_seq);

/** Grava a ordem de uma rota inteira de uma vez.
 *
 *  Uma chamada só, e não um UPDATE por parada: reordenar mexe em todas as
 *  linhas, e meio caminho deixaria a folha com duas paradas na mesma posição —
 *  a cozinha imprimiria uma sequência que não existe. */
create or replace function fn_ordenar_entrega(p_ids uuid[]) returns int
language plpgsql security invoker as $fn$
declare v_n int;
begin
  if not is_staff() then
    raise exception 'Só a equipe reordena a entrega.' using errcode = 'LB403';
  end if;

  update orders o
     set delivery_seq = x.ord, updated_at = now()
    from (select id, ordinality::int as ord
            from unnest(p_ids) with ordinality as t(id, ordinality)) x
   where o.id = x.id;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function fn_ordenar_entrega(uuid[]) from public, anon;
grant  execute on function fn_ordenar_entrega(uuid[]) to authenticated, service_role;
