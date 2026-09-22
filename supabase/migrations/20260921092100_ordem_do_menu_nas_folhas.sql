-- LifeBox · a folha da cozinha segue a ordem do menu
-- Decidido na reunião com a LifeBox (22/09/2026):
-- "a mesma sequência da montagem será do mesmo jeito que o menu estiver
--  organizado".
--
-- A cozinha monta olhando o menu. Se a folha listar em ordem alfabética e o
-- menu em outra, cada prato vira uma busca — e quem monta doze sacolas seguidas
-- não procura, erra.
--
-- `v_production` ganha a posição do menu da semana. Quando o prato não está no
-- menu daquela semana (caso do pedido pós-cutoff com prato de outro ciclo), vai
-- para o fim em vez de sumir: melhor aparecer por último do que não aparecer.

create or replace view v_production
with (security_invoker = false) as
select o.week_id,
       oi.dish_id,
       oi.name_snapshot    as dish_name_pt,
       oi.category_snapshot as category,
       s.code              as size_code,
       sum(oi.qty)::int    as qty,
       bool_or(o.post_cutoff) as has_post_cutoff,
       sum(oi.qty) filter (where o.post_cutoff)::int as qty_post_cutoff,
       -- 999999 = fora do menu desta semana; ordena depois de todo o resto
       coalesce(min(md.position), 999999) as menu_position
  from order_items oi
  join orders o  on o.id = oi.order_id
  left join sizes s on s.id = oi.size_id
  left join weeks w on w.id = o.week_id
  left join menu_dishes md
         on md.menu_id = w.menu_id and md.dish_id = oi.dish_id
 where oi.item_type = 'dish'
 group by o.week_id, oi.dish_id, oi.name_snapshot, oi.category_snapshot, s.code;

revoke all on v_production from public;
grant select on v_production to authenticated;
