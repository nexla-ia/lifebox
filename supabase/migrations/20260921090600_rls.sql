-- LifeBox · Row Level Security
-- Ref: LIFEBOX_PROJECT.md §3
--
--   Administrador → tudo
--   Operação      → Semana, Pedidos, Clientes, Catálogo (preços só leitura),
--                   Produção, Montagem, Bags. Sem Overview, sem Configurações.
--   Cozinha       → SÓ Produção, por view sem valores nem dados pessoais.
--
-- O front esconde menu e rota, mas quem manda é isto aqui: URL direta de perfil
-- errado não devolve dado, devolve vazio (tela 9f "acesso negado").

do $rls$
declare t text;
begin
  foreach t in array array[
    'profiles','settings','routes','zip_codes','sources','sizes','menus','weeks','goals',
    'dish_tags','allergens','dishes','dish_tag_links','dish_allergens','dish_sizes',
    'menu_dishes','plans','plan_prices','extra_prices','custom_unit_prices',
    'addons','addon_variants','payment_methods','message_templates',
    'customers','leads','customer_weeks','orders','order_items',
    'payment_receipts','bag_movements','bag_collections','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $rls$;

-- GRANT é o portão; a policy é o filtro. Sem os dois, RLS não protege nada:
-- tabela sem policy + grant = tudo bloqueado; com grant e sem RLS = tudo aberto.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- --------------------------------------------------------------- perfis §3
create policy profiles_self_read on profiles
  for select using (id = auth.uid() or is_staff());
create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- ------------------------------------------------- leitura de staff, escrita de admin
-- Configurações, geografia, origens, tamanhos, planos e TODO preço.
-- Operação lê (precisa da taxa para montar a tela) mas não edita (§3).
do $p$
declare t text;
begin
  foreach t in array array[
    'settings','routes','zip_codes','sources','sizes','plans',
    'plan_prices','extra_prices','custom_unit_prices',
    'addons','addon_variants','payment_methods','goals'
  ] loop
    execute format(
      'create policy %I on %I for select using (is_staff())', t || '_staff_read', t);
    execute format(
      'create policy %I on %I for all using (is_admin()) with check (is_admin())',
      t || '_admin_write', t);
  end loop;
end $p$;

-- ------------------------------------------------------ catálogo editável §3
-- Pratos, tags, alérgenos e menus do ciclo: Operação edita (tela 5c mostra
-- "＋ Adicionar prato" no perfil Operação). Só PREÇO é exclusivo do Admin.
do $p$
declare t text;
begin
  foreach t in array array[
    'menus','dish_tags','allergens','dishes','dish_tag_links',
    'dish_allergens','dish_sizes','menu_dishes','weeks'
  ] loop
    execute format(
      'create policy %I on %I for all using (is_staff()) with check (is_staff())',
      t || '_staff_all', t);
  end loop;
end $p$;

-- ------------------------------------------ operação do dia a dia, sem Cozinha
-- Clientes, pedidos, pagamento e bags: Admin e Operação. A Cozinha não tem
-- policy nenhuma aqui, então não enxerga linha alguma.
do $p$
declare t text;
begin
  foreach t in array array[
    'customers','leads','customer_weeks','orders','order_items',
    'payment_receipts','bag_movements','bag_collections'
  ] loop
    execute format(
      'create policy %I on %I for all using (is_staff()) with check (is_staff())',
      t || '_staff_all', t);
  end loop;
end $p$;

-- ------------------------------------------------------------ mensagens §6p
-- Templates de WhatsApp: só Administrador (tela 6p, "🔒 Só Administrador").
create policy message_templates_admin on message_templates
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------- auditoria §7
create policy audit_admin_read on audit_log for select using (is_admin());
create policy audit_staff_write on audit_log for insert with check (is_staff());

-- ---------------------------------------------------- janela da Cozinha §3
-- v_production e v_kitchen_notes rodam como dona (security_invoker = false):
-- são a ÚNICA porta da Cozinha para os dados, já agregados e sem valor,
-- contato ou endereço.
revoke all on v_production, v_kitchen_notes from public;
grant select on v_production, v_kitchen_notes to authenticated;

-- v_week_summary e v_bag_balance respeitam a RLS de baixo: para a Cozinha
-- voltam vazias.
grant select on v_week_summary, v_bag_balance to authenticated;
