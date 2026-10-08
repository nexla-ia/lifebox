-- LifeBox · ordenar não pode dizer que deu certo quando não fez nada
-- Ref: caça de bugs de 08/10/2026
--
-- Medido: `fn_ordenar_entrega(array[uuid_qualquer])` devolvia **0 linhas** sem
-- reclamar, e a tela chamava `onMudou()` como se tivesse gravado. Id repetido
-- (arrasto duplo) devolvia 1 linha e deixava `delivery_seq` com o valor da
-- ÚLTIMA ocorrência — que depende da ordem em que o executor aplicou as
-- linhas, ou seja, não é determinístico.
--
-- As duas são a mesma falha de sempre neste projeto: escrita que não escreve e
-- não avisa. A tela mostra a ordem nova, o banco fica com a antiga, e a
-- diferença só aparece no domingo, quando a folha sai numa sequência que
-- ninguém escolheu.
--
-- Zero linhas é resultado legítimo em UM caso: lista vazia. Aí não há o que
-- gravar e não há o que avisar.

create or replace function fn_ordenar_entrega(p_ids uuid[]) returns int
language plpgsql security invoker as $fn$
declare v_n int; v_dist int; v_semanas int;
begin
  if not is_staff() then
    raise exception 'Só a equipe reordena a entrega.' using errcode = 'LB403';
  end if;

  p_ids := coalesce(p_ids, '{}');
  if array_length(p_ids, 1) is null then return 0; end if;

  select count(distinct x) into v_dist from unnest(p_ids) x;
  if v_dist <> array_length(p_ids, 1) then
    raise exception 'A mesma parada apareceu duas vezes na ordem.'
      using errcode = 'LB422';
  end if;

  -- todas da MESMA semana: a ordem é do trajeto de um domingo, e misturar
  -- semanas renumeraria a folha de outra sem ninguém pedir
  select count(distinct week_id) into v_semanas
    from orders where id = any(p_ids);
  if v_semanas <> 1 then
    raise exception 'A ordem precisa ser de pedidos de uma semana só.'
      using errcode = 'LB422';
  end if;

  update orders o
     set delivery_seq = x.ord, updated_at = now()
    from (select id, ordinality::int as ord
            from unnest(p_ids) with ordinality as t(id, ordinality)) x
   where o.id = x.id;

  get diagnostics v_n = row_count;
  if v_n <> array_length(p_ids, 1) then
    raise exception 'Não consegui gravar a ordem: % de % paradas foram encontradas.',
      v_n, array_length(p_ids, 1) using errcode = 'LB409';
  end if;
  return v_n;
end $fn$;

create or replace function fn_ordenar_menu(p_menu uuid, p_ids uuid[])
returns int
language plpgsql security invoker as $fn$
declare v_n int; v_dist int;
begin
  if not is_staff() then
    raise exception 'Só a equipe organiza o menu.' using errcode = 'LB403';
  end if;

  p_ids := coalesce(p_ids, '{}');
  if array_length(p_ids, 1) is null then return 0; end if;

  select count(distinct x) into v_dist from unnest(p_ids) x;
  if v_dist <> array_length(p_ids, 1) then
    raise exception 'O mesmo prato apareceu duas vezes na ordem.'
      using errcode = 'LB422';
  end if;

  update menu_dishes md
     set position = x.ord
    from (select id, ordinality::int as ord
            from unnest(p_ids) with ordinality as t(id, ordinality)) x
   where md.menu_id = p_menu and md.dish_id = x.id;

  get diagnostics v_n = row_count;
  if v_n <> array_length(p_ids, 1) then
    raise exception 'Não consegui gravar a ordem: % de % pratos estão neste menu.',
      v_n, array_length(p_ids, 1) using errcode = 'LB409';
  end if;
  return v_n;
end $fn$;

revoke execute on function fn_ordenar_entrega(uuid[])    from public, anon;
revoke execute on function fn_ordenar_menu(uuid, uuid[]) from public, anon;
grant  execute on function fn_ordenar_entrega(uuid[])    to authenticated, service_role;
grant  execute on function fn_ordenar_menu(uuid, uuid[]) to authenticated;
