-- LifeBox · fechar as views que ignoram a RLS
--
-- ACHADO em auditoria, e é o irmão do que a migration 092500 fechou nas
-- funções — ali eu tratei só de EXECUTE e deixei as VIEWS de fora.
--
-- `v_production` e `v_kitchen_notes` são `security_invoker = false` de
-- propósito: são a única porta da Cozinha (§3), e precisam enxergar pedido sem
-- que a RLS de `orders` as barre. O preço disso é que elas não têm defesa
-- própria — quem tiver SELECT nelas vê TUDO.
--
-- E o `anon` tinha SELECT. Medido no banco da cliente, como anon:
--
--   v_production    -> 6 linhas   (o cardápio e as quantidades da semana)
--   v_kitchen_notes -> 0 linhas   (só porque não há nota cadastrada agora)
--
-- A segunda é a que assusta: ela leva `customer_label` junto com a restrição
-- alimentar. Na primeira nota que a LifeBox cadastrar, nome de cliente e
-- alergia ficam legíveis para qualquer um com a chave anônima — que é pública
-- por desenho, vai no bundle do front.
--
-- A regra que faltava, e que o teste passa a cobrar: view que ignora a RLS é
-- porta de serviço, e porta de serviço não abre para a rua.

revoke all on v_production    from anon;
revoke all on v_kitchen_notes from anon;

-- e as demais, por garantia: nenhuma view deste sistema é para quem não fez
-- login. O link público passa por função, nunca por view (§9.7).
revoke all on v_week_summary from anon;
revoke all on v_bag_balance  from anon;
revoke all on v_bag_collect  from anon;
revoke all on v_bag_estoque  from anon;

comment on view v_production is
  'Folha da cozinha (§3). security_invoker = false de propósito: é a porta que '
  'deixa a Cozinha ver pedido sem alcançar orders. Por isso NÃO pode ser '
  'concedida ao anon — ela não tem RLS para barrar nada.';
