-- LifeBox · a ordem do menu, definida pela equipe
-- Ref: reunião de 22/09/2026 — "mesma sequência da montagem será o mesmo jeito
-- que o menu estiver organizado"
--
-- `menu_dishes.position` já existia e já manda nas folhas de Produção e de
-- Montagem: a cozinha conta e monta na ordem do menu, e foi para isso que a
-- coluna entrou. Faltava o único pedaço que a equipe toca — a tela.
--
-- Até aqui a ordem era a que o banco devolvesse, que muda sozinha conforme as
-- linhas são reescritas. Duas impressões da mesma semana podiam sair em ordens
-- diferentes, e aí a conferência vira caça ao prato.

/** Grava a ordem do menu inteiro numa chamada.
 *
 *  Espelha `fn_ordenar_entrega`, e pelo mesmo motivo: reordenar mexe em todas
 *  as linhas, e um UPDATE por prato deixaria dois na mesma posição se parasse
 *  no meio — a folha sairia com uma sequência que não existe.
 *
 *  Só reposiciona o que JÁ está no menu. Mandar um prato de fora não o inclui:
 *  entrar no menu é outra decisão, com outra consequência (a cozinha compra
 *  ingrediente), e misturar as duas numa função de ordenar faria um arrasto
 *  acidental virar prato novo na semana. */
create or replace function fn_ordenar_menu(p_menu uuid, p_ids uuid[])
returns int
language plpgsql security invoker as $fn$
declare v_n int;
begin
  if not is_staff() then
    raise exception 'Só a equipe organiza o menu.' using errcode = 'LB403';
  end if;

  update menu_dishes md
     set position = x.ord
    from (select id, ordinality::int as ord
            from unnest(p_ids) with ordinality as t(id, ordinality)) x
   where md.menu_id = p_menu and md.dish_id = x.id;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function fn_ordenar_menu(uuid, uuid[]) from public, anon;
grant  execute on function fn_ordenar_menu(uuid, uuid[]) to authenticated;

-- Prato novo no menu entra no FIM, não na posição 1. Sem isto todo prato
-- incluído cairia no começo da folha e a equipe teria de reordenar de novo —
-- e `position` nulo deixaria a ordem por conta do banco outra vez.
-- O DEFAULT 0 era a armadilha: `position` nunca chegava nula no gatilho, e
-- todo prato incluído nascia em ZERO — ou seja, na FRENTE da folha da cozinha,
-- empatado com todos os outros que também entraram assim. Quem inclui um prato
-- no meio da semana não está dizendo "este é o primeiro".
alter table menu_dishes alter column position drop default;

create or replace function menu_dishes_posicao_no_fim() returns trigger
language plpgsql as $fn$
begin
  -- zero conta como "ninguém escolheu": é o que o default deixou para trás, e
  -- aceitar zero como posição válida devolveria o empate na frente da folha
  if new.position is null or new.position = 0 then
    select coalesce(max(position), 0) + 1 into new.position
      from menu_dishes where menu_id = new.menu_id;
  end if;
  return new;
end $fn$;

revoke execute on function menu_dishes_posicao_no_fim() from public, anon;

drop trigger if exists menu_dishes_posicao on menu_dishes;
create trigger menu_dishes_posicao
  before insert on menu_dishes
  for each row execute function menu_dishes_posicao_no_fim();

-- Renumera o MENU INTEIRO, não só as linhas sem posição.
--
-- A primeira versão disto numerava só os buracos, começando do 1 — e
-- colidia com quem já tinha posição. No banco da cliente dois pratos ficaram
-- empatados em 1, e empate é ordem que muda sozinha: a folha saía numa ordem
-- hoje e noutra amanhã, e na tela a linha voltava para o lugar antigo depois
-- do F5 como se o arrasto não tivesse pegado.
--
-- A ordem de referência é `position` primeiro e o nome como desempate: quem já
-- estava organizado continua como estava, e quem não tinha posição entra na
-- ordem alfabética, que ao menos é estável entre impressões.
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

-- Tentei prender isso com `unique (menu_id, position)`, inclusive deferrable.
-- Não dá: o upsert de "ligar prato no menu" usa ON CONFLICT, e o Postgres
-- recusa constraint deferrable como árbitro. Quem garante a unicidade daqui
-- em diante são os dois caminhos que escrevem posição — o gatilho, que põe no
-- fim, e `fn_ordenar_menu`, que renumera 1..N de uma vez.
