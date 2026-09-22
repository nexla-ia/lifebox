-- LifeBox · fechar o que o anon alcança
--
-- ACHADO ao escrever os testes do comprovante, e é grave o bastante para ter
-- migration própria.
--
-- O Supabase define DEFAULT PRIVILEGES que concedem EXECUTE de toda função
-- nova em `public` diretamente aos roles `anon`, `authenticated` e
-- `service_role`. Ou seja: `revoke execute ... from public` — que era o que
-- este projeto vinha fazendo — **não fecha nada lá**, porque a concessão não é
-- para PUBLIC, é para o role `anon` nominalmente.
--
-- No cluster local isso não existe, então o teste passava e o Supabase ficava
-- aberto. Duas coisas estavam de fato expostas ao anônimo:
--
--   · `fn_mensagem_pedido(order_id)` devolve nome do cliente, plano, pratos e
--     total — vazamento de dado pessoal com um uuid.
--   · `fn_registrar_comprovante` escreve pagamento. Com o automático ligado,
--     um chamador anônimo marcaria pedido como pago.
--
-- As demais tinham guard de papel (`is_admin()`), então devolviam LB403 — mas
-- depender do guard de cada função é uma barreira por vez. A porta se fecha
-- aqui, uma vez.
--
-- O que o anon PRECISA alcançar é curto e explícito: o fluxo do link público
-- e o primeiro acesso por convite. Tudo o mais é da equipe.

-- São DUAS concessões diferentes, e fechar uma só deixa a outra aberta:
--   · o Postgres concede EXECUTE a PUBLIC em toda função nova (vale nos dois
--     ambientes, e `anon` herda por ser membro de PUBLIC);
--   · o Supabase concede, ALÉM disso, nominalmente a `anon`.
-- O cluster local só tem a primeira. Por isso o teste local passava.

-- 1) Função nova: tira a concessão NOMINAL ao anon e já deixa a equipe dentro.
--
--    O `grant` não é conveniência, ele segura o `revoke`: quando a ACL padrão
--    resultante fica VAZIA o Postgres apaga a linha de `pg_default_acl`, e sem
--    linha vale o padrão embutido — a revogação se desfaz sozinha, em silêncio.
--
--    E vale saber o limite, porque ele é o motivo de existir o teste do item 6:
--    a linha guardada SOMA-SE ao padrão embutido, não o substitui. Medido aqui:
--
--      pg_default_acl → f|{authenticated=X/postgres,service_role=X/postgres}
--      função criada  → {=X/postgres,postgres=X/…,authenticated=X/…,…}
--                        ^^ PUBLIC, de volta
--
--    Ou seja: o EXECUTE que o Postgres dá a PUBLIC em toda função nova NÃO sai
--    por `alter default privileges`, em nenhuma variação. Só sai com `revoke`
--    na função, uma a uma — que é o item 2. Contar com esta seção para fechar a
--    porta seria falsa sensação de segurança.
alter default privileges in schema public grant  execute on functions to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon;

-- 2) O que já existe: fecha tudo, devolve para quem tem sessão.
do $fechar$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', r.assinatura);
    -- a equipe (`authenticated`) continua alcançando tudo: quem protege dado
    -- dela é a RLS e o guard de papel, não a falta de EXECUTE. O que muda é o
    -- anônimo, que passa a alcançar só o que está na lista abaixo.
    execute format('grant execute on function %s to authenticated, service_role',
                   r.assinatura);
  end loop;
end $fechar$;

-- 3) Os predicados que a PRÓPRIA RLS chama ficam abertos, e têm de ficar.
--
--    A policy é avaliada com os privilégios de quem consulta. Sem EXECUTE em
--    `is_staff()`, o anon que tocar numa tabela protegida recebe
--    `permission denied for function is_staff` — um ERRO — em vez do resultado
--    VAZIO de que este projeto depende (ver §9.7, `link_test.sql`). Fechar
--    aqui não protegeria nada e trocaria "não veio dado" por "estourou".
--
--    E não há o que vazar: as três falam da sessão de QUEM CHAMA. Sem JWT,
--    `current_role_of()` é nulo e as duas devolvem `false`.
grant execute on function is_admin()         to anon;
grant execute on function is_staff()         to anon;
grant execute on function current_role_of()  to anon;

-- 4) A porta do link público (§9.7) e a do convite (§3), nominalmente.
grant execute on function fn_link_semana()            to anon;
grant execute on function fn_link_catalogo()          to anon;
grant execute on function fn_link_zip(text)           to anon;
grant execute on function fn_link_identificar(text)   to anon;
grant execute on function fn_link_precificar(jsonb)   to anon;
grant execute on function fn_link_criar_pedido(jsonb) to anon;
grant execute on function fn_convite(text)            to anon;
grant execute on function fn_aceitar_convite(text, text) to anon;

-- 5) Escrita de dinheiro não é nem de `authenticated` genérico: a automação
--    entra como `service_role`, e a equipe pela tela, que passa pela RLS.
revoke execute on function fn_registrar_comprovante(jsonb) from authenticated;
grant  execute on function fn_registrar_comprovante(jsonb) to service_role;

comment on function fn_registrar_comprovante(jsonb) is
  'Escreve pagamento (§9.3). Só service_role: a automação do n8n. '
  'A equipe confirma pela tela, que passa pela RLS.';

-- 6) O guarda que sobra — e é o que vale.
--
--    Como a concessão a PUBLIC sempre volta em função nova, nenhuma linha deste
--    arquivo protege o que ainda não existe. Quem cobra é `link_test.sql`: ele
--    lista TUDO que o anon alcança em `public` e falha nomeando o que não está
--    na lista curta acima. Função nova que devia ser da equipe quebra o
--    `npm run db:test` no mesmo dia, com o nome dela na mensagem.
--
--    Por isso o fechamento não é só esta migration: é a migration MAIS o teste.
