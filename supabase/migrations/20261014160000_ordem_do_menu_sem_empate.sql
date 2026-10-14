-- LifeBox · a ordem do menu não pode ter dois pratos no mesmo lugar
-- Ref: releitura das funções de ordenar, 14/10/2026
--
-- A migration de 06/10 acabou com o empate de posição e escreveu o motivo:
-- empate é ordem que muda sozinha, e a folha da cozinha sai numa sequência
-- hoje e noutra amanhã. Ele voltou por outra porta, e a porta é a tela.
--
-- A tela de Ordem do menu lista só os pratos LIGADOS — é o que a equipe
-- organiza, porque é o que a semana vai ter. Então ela manda só esses ids, e
-- `fn_ordenar_menu` numerava 1..N apenas o que recebeu. Os pratos desligados
-- do mesmo menu ficavam com a posição velha, agora dentro da faixa 1..N.
--
-- Reproduzido no cluster local, com o menu do seed:
--
--   1. menu com A(1) B(2) C(3)
--   2. desliga B  → B continua em 2, desligado
--   3. a tela reordena os ativos [A, C] → A=1, C=2
--   4. liga B de volta (o upsert de ligar não mexe em `position`)
--      → "Bolo de laranja" e "Chicken broccoli alfredo" os dois na posição 2
--
-- Ninguém digita nada errado em nenhum desses passos. E o passo 4 é comum:
-- desligar um prato numa semana e trazê-lo de volta na outra é o ciclo normal
-- dos 4 menus (§4).
--
-- Não apareceu nos testes porque o teste manda o menu INTEIRO — o que a tela
-- nunca faz. O teste novo manda só os ativos, que é a chamada de verdade.
--
-- A correção é no servidor, não na tela: quem recebeu a lista é quem garante
-- a numeração, e a próxima tela que chamar a função não precisa saber disso.
-- Semântica: o que vem na lista fica na frente, na ordem pedida; o resto do
-- menu vai para o fim. É o lugar certo para um prato que não está na semana —
-- quando voltar, volta no fim, e não no meio de um menu já organizado.

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

  -- Conta ANTES do empurrão: o row_count do segundo UPDATE somaria os pratos
  -- que a chamadora nem mencionou, e a conferência de "gravei o que me
  -- pediram" passaria a dizer outra coisa.
  get diagnostics v_n = row_count;
  if v_n <> array_length(p_ids, 1) then
    raise exception 'Não consegui gravar a ordem: % de % pratos estão neste menu.',
      v_n, array_length(p_ids, 1) using errcode = 'LB409';
  end if;

  -- O resto do menu vai para o fim, mantendo a ordem relativa que tinha. Sem
  -- isto a faixa 1..N fica dividida com quem não foi reordenado.
  with resto as (
    select md.dish_id,
           v_n + row_number() over (order by md.position, d.name_pt) as n
      from menu_dishes md join dishes d on d.id = md.dish_id
     where md.menu_id = p_menu and not (md.dish_id = any(p_ids))
  )
  update menu_dishes md set position = r.n
    from resto r
   where md.menu_id = p_menu and md.dish_id = r.dish_id
     and md.position is distinct from r.n;

  return v_n;
end $fn$;

comment on function fn_ordenar_menu(uuid, uuid[]) is
  'Grava a ordem do menu. O que vem na lista fica em 1..N; o resto do menu vai '
  'para o fim, para que não sobre empate de posição (14/10/2026).';

revoke execute on function fn_ordenar_menu(uuid, uuid[]) from public, anon;
grant  execute on function fn_ordenar_menu(uuid, uuid[]) to authenticated;

-- Conserta o que já ficou empatado. Mesma ordem de referência da migration de
-- 06/10: posição primeiro, nome como desempate — quem estava organizado
-- continua como estava, e o empate se resolve de forma estável em vez de
-- ficar por conta da ordem em que o banco devolver as linhas.
with ordenado as (
  select md.menu_id, md.dish_id,
         row_number() over (
           partition by md.menu_id
           order by coalesce(nullif(md.position, 0), 2147483647), d.name_pt
         ) as n
    from menu_dishes md join dishes d on d.id = md.dish_id
)
update menu_dishes md set position = o.n
  from ordenado o
 where md.menu_id = o.menu_id and md.dish_id = o.dish_id
   and md.position is distinct from o.n;
