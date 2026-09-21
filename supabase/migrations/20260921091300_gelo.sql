-- LifeBox · conferência do gelo na montagem
-- Ref: tela 11a, coluna "Gelo"
--
-- Cada entrega leva bag(s) térmica(s) E pack de gelo (§6.7). A folha de
-- domingo confere os dois separadamente: dá para montar a sacola e esquecer
-- o gelo, e aí a comida chega quente.

alter table orders add column if not exists ice_packed boolean not null default false;

comment on column orders.ice_packed is
  'Pack de gelo conferido na montagem de domingo (tela 11a). Separado de '
  'assembled_at porque são duas conferências distintas.';
