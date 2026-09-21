-- LifeBox · testes de usuarios e convite (§3, §9.8)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/usuarios_test.sql
--
-- O convite escreve em auth.users por `security definer`. Entao o que mais
-- importa aqui nao e o caminho feliz: e a Operacao ser RECUSADA em cada uma
-- das funcoes, e ninguem conseguir se trancar do lado de fora.

\set ON_ERROR_STOP on

begin;

create or replace function assert_eq(p_got anyelement, p_want anyelement, p_what text)
returns void language plpgsql as $fn$
begin
  if p_got is distinct from p_want then
    raise exception 'FALHOU %: esperado %, veio %', p_what, p_want, p_got;
  end if;
  raise notice '  ok  % = %', p_what, p_got;
end $fn$;

do $fx$
declare v_admin uuid := gen_random_uuid(); v_oper uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (v_admin, 'admin.usr@teste.local', now()),
    (v_oper,  'oper.usr@teste.local',  now());
  update profiles set role = 'admin',    status = 'ativo' where id = v_admin;
  update profiles set role = 'operacao', status = 'ativo' where id = v_oper;
  perform set_config('lb.admin', v_admin::text, false);
  perform set_config('lb.oper',  v_oper::text,  false);
end $fx$;

do $t$
declare
  v_admin uuid := current_setting('lb.admin')::uuid;
  v_oper  uuid := current_setting('lb.oper')::uuid;
  r jsonb; v_token text; v_novo uuid; v_hash_antes text;
begin
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  raise notice 'convidar cria o usuario com o acesso FECHADO';
  r := fn_convidar_usuario('tatiane@teste.local', 'Tatiane Alves', 'operacao');
  v_novo  := (r->>'user_id')::uuid;
  v_token := r->>'token';

  perform assert_eq((select status from profiles where id = v_novo)::text,
                    'convite_pendente', 'perfil nasce com convite pendente');
  perform assert_eq((select role from profiles where id = v_novo)::text,
                    'operacao', 'papel veio do convite');
  perform assert_eq((select full_name from profiles where id = v_novo),
                    'Tatiane Alves', 'nome veio do convite');
  perform assert_eq((select invited_by from profiles where id = v_novo), v_admin,
                    'quem convidou fica registrado');
  -- email_confirmed_at nulo e o que barra o login no GoTrue
  perform assert_eq((select email_confirmed_at is null from auth.users where id = v_novo),
                    true, 'login fechado ate a pessoa definir a senha');
  perform assert_eq((select count(*)::int from auth.identities where user_id = v_novo),
                    1, 'identidade do provedor criada');
  perform assert_eq(length(v_token) >= 40, true, 'token longo o bastante');
  perform assert_eq((select expires_at > now() + interval '6 days'
                       from user_invites where token = v_token),
                    true, 'expira em 7 dias (§3)');

  raise notice 'e-mail repetido e recusado';
  begin
    perform fn_convidar_usuario('tatiane@teste.local', 'Outra', 'cozinha');
    raise exception 'FALHOU: convidou duas vezes o mesmo e-mail';
  exception when sqlstate 'LB409' then raise notice '  ok  recusa e-mail ja cadastrado';
  end;

  raise notice 'a tela do convite mostra so o necessario (9e)';
  r := fn_convite(v_token);
  perform assert_eq((r->>'valido')::boolean, true, 'convite valido');
  perform assert_eq(r->>'nome', 'Tatiane Alves', 'nome para o "Bem-vinda"');
  perform assert_eq(r->>'convidou', (select full_name from profiles where id = v_admin),
                    'quem convidou aparece');
  perform assert_eq((fn_convite('token-que-nao-existe')->>'valido')::boolean, false,
                    'token invalido nao conta nada');

  raise notice 'senha curta e recusada antes de qualquer escrita';
  select encrypted_password::text into v_hash_antes from auth.users where id = v_novo;
  begin
    perform fn_aceitar_convite(v_token, 'curta');
    raise exception 'FALHOU: aceitou senha de 5 caracteres';
  exception when sqlstate 'LB400' then raise notice '  ok  recusa senha curta';
  end;
  perform assert_eq((select encrypted_password::text from auth.users where id = v_novo),
                    v_hash_antes, 'senha intacta apos a recusa');

  raise notice 'aceitar define a senha e abre o acesso';
  perform fn_aceitar_convite(v_token, 'senha-de-verdade');
  perform assert_eq((select status from profiles where id = v_novo)::text, 'ativo',
                    'gatilho de confirmacao ativou o perfil');
  perform assert_eq((select email_confirmed_at is not null from auth.users where id = v_novo),
                    true, 'e-mail confirmado');
  -- bcrypt: o mesmo que o GoTrue confere no login
  perform assert_eq((select encrypted_password = extensions.crypt('senha-de-verdade',
                                                                 encrypted_password)
                       from auth.users where id = v_novo),
                    true, 'senha confere pelo bcrypt');

  raise notice 'convite serve UMA vez';
  begin
    perform fn_aceitar_convite(v_token, 'outra-senha-ainda');
    raise exception 'FALHOU: reusou o convite';
  exception when sqlstate 'LB410' then raise notice '  ok  recusa convite ja usado';
  end;

  raise notice 'convite expirado nao vale';
  r := fn_convidar_usuario('expirado@teste.local', 'Expirado', 'cozinha');
  update user_invites set expires_at = now() - interval '1 hour' where token = r->>'token';
  perform assert_eq((fn_convite(r->>'token')->>'valido')::boolean, false, 'expirado e invalido');
  begin
    perform fn_aceitar_convite(r->>'token', 'senha-boa-mesmo');
    raise exception 'FALHOU: aceitou convite expirado';
  exception when sqlstate 'LB410' then raise notice '  ok  recusa convite expirado';
  end;

  raise notice 'reenviar troca o token e mata o anterior';
  v_token := fn_reenviar_convite((r->>'user_id')::uuid)->>'token';
  perform assert_eq((select count(*)::int from user_invites
                      where user_id = (r->>'user_id')::uuid and accepted_at is null),
                    1, 'so um convite aberto por usuario');
  perform assert_eq((fn_convite(v_token)->>'valido')::boolean, true, 'novo token vale');

  raise notice 'desativar cancela o convite pendente';
  perform fn_definir_status((r->>'user_id')::uuid, 'desativado');
  perform assert_eq((fn_convite(v_token)->>'valido')::boolean, false,
                    'convite de desativado nao abre');

  raise notice 'desativar tira o acesso de verdade, nao so o menu (§3)';
  perform fn_definir_status(v_oper, 'desativado');
  perform set_config('request.jwt.claim.sub', v_oper::text, true);
  perform assert_eq(current_role_of() is null, true, 'sem papel, RLS nao devolve linha');
  -- false, nao NULL: `if not is_admin()` com NULL nao dispara o raise, e em
  -- funcao security definer o guard e a unica barreira
  perform assert_eq(is_staff(), false, 'is_staff devolve false, nao NULL');
  perform assert_eq(is_admin(), false, 'is_admin devolve false, nao NULL');

  raise notice 'Operacao e recusada em todas as portas';
  perform set_config('request.jwt.claim.sub', v_oper::text, true);
  begin
    perform fn_convidar_usuario('invasor@teste.local', 'Invasor', 'admin');
    raise exception 'FALHOU: nao-admin convidou usuario';
  exception when sqlstate 'LB403' then raise notice '  ok  convidar recusado';
  end;
  begin
    perform fn_definir_papel(v_novo, 'admin');
    raise exception 'FALHOU: nao-admin trocou papel';
  exception when sqlstate 'LB403' then raise notice '  ok  trocar papel recusado';
  end;
  begin
    perform fn_definir_status(v_novo, 'desativado');
    raise exception 'FALHOU: nao-admin desativou usuario';
  exception when sqlstate 'LB403' then raise notice '  ok  desativar recusado';
  end;

  raise notice 'ninguem se tranca do lado de fora';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform fn_definir_papel(v_admin, 'cozinha');
    raise exception 'FALHOU: admin rebaixou a si mesmo';
  exception when sqlstate 'LB403' then raise notice '  ok  nao troca o proprio perfil';
  end;
  begin
    perform fn_definir_status(v_admin, 'desativado');
    raise exception 'FALHOU: admin desativou a si mesmo';
  exception when sqlstate 'LB403' then raise notice '  ok  nao desativa a si mesmo';
  end;

  raise notice 'e o sistema nunca fica sem Administrador ativo';
  -- Tatiane vira a segunda Administradora e o primeiro admin sai de cena
  perform fn_definir_papel(v_novo, 'admin');
  perform assert_eq((select role from profiles where id = v_novo)::text, 'admin',
                    'promovida a Administradora');
  perform set_config('request.jwt.claim.sub', v_novo::text, true);
  perform fn_definir_status(v_admin, 'desativado');

  -- o banco da cliente ja tem Administrador de verdade, entao o teste nao pode
  -- supor que comecou do zero: tira os outros de cena DENTRO da transacao
  -- (que faz rollback no fim) ate sobrar so a Tatiane
  update profiles set status = 'desativado'
   where role = 'admin' and status = 'ativo' and id <> v_novo;
  perform assert_eq((select count(*)::int from profiles
                      where role = 'admin' and status = 'ativo'), 1,
                    'sobrou um Administrador ativo');

  -- a policy de profiles deixa o Administrador editar a propria linha DIRETO
  -- pela tabela. Se a trava vivesse so dentro de fn_definir_papel, um PATCH em
  -- /rest/v1/profiles passaria por cima dela.
  begin
    update profiles set role = 'operacao' where id = v_novo;
    raise exception 'FALHOU: ficou sem Administrador ativo pela tabela';
  exception when sqlstate 'LB409' then
    raise notice '  ok  o gatilho barra ate o UPDATE direto';
  end;
  begin
    update profiles set status = 'desativado' where id = v_novo;
    raise exception 'FALHOU: o ultimo Administrador se desativou pela tabela';
  exception when sqlstate 'LB409' then
    raise notice '  ok  e barra a desativacao do ultimo tambem';
  end;
  perform assert_eq((select count(*)::int from profiles
                      where role = 'admin' and status = 'ativo'), 1,
                    'continua com Administrador');

  raise notice 'convite para o e-mail errado se desfaz';
  perform set_config('request.jwt.claim.sub', v_novo::text, true);
  r := fn_convidar_usuario('errado@teste.local', 'Endereco Errado', 'cozinha');
  perform fn_remover_usuario((r->>'user_id')::uuid);
  perform assert_eq((select count(*)::int from auth.users
                      where email = 'errado@teste.local'), 0, 'usuario removido');
  perform assert_eq((select count(*)::int from profiles
                      where email = 'errado@teste.local'), 0, 'perfil caiu por cascade');
  -- e o endereco volta a ficar livre, que era o problema
  perform fn_convidar_usuario('errado@teste.local', 'Agora Certo', 'cozinha');
  perform assert_eq((select full_name from profiles where email = 'errado@teste.local'),
                    'Agora Certo', 'da para convidar o mesmo e-mail de novo');

  raise notice 'mas quem ja lancou pedido NAO sai';
  begin
    perform fn_remover_usuario(v_admin);   -- convidou a Tatiane: tem historico
    raise exception 'FALHOU: removeu usuario com historico';
  exception when sqlstate 'LB409' then
    raise notice '  ok  recusa remover quem tem historico';
  end;
  perform assert_eq((select count(*)::int from profiles where id = v_admin), 1,
                    'o autor dos lancamentos continua la');

  raise notice 'USUARIOS OK';
end $t$;

-- --------------------------------------------------- a porta do anonimo
-- Este bloco existe porque o buraco esteve aberto: sem perfil ativo,
-- is_admin() devolvia NULL, `not NULL` nao disparava o raise, e funcao nova no
-- Postgres nasce com EXECUTE para PUBLIC. Junto, dava um anonimo criando
-- Administrador. As duas metades sao testadas aqui.
do $anon$
declare v_falhas text[] := '{}';
begin
  -- requisicao anonima nao tem JWT: sem limpar o claim, auth.uid() ainda
  -- devolveria o Administrador do bloco anterior e o teste se enganaria
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;

  perform assert_eq(auth.uid() is null, true, 'sem usuario na sessao');
  perform assert_eq(is_admin(), false, 'anon nao e admin (false, nao NULL)');
  perform assert_eq(not is_admin(), true, 'o guard do `not is_admin()` dispara');

  begin
    perform fn_convidar_usuario('invasor@teste.local', 'Invasor', 'admin');
    v_falhas := v_falhas || 'fn_convidar_usuario'::text;
  exception when insufficient_privilege or sqlstate 'LB403' then null;
  end;
  begin
    perform fn_reenviar_convite(gen_random_uuid());
    v_falhas := v_falhas || 'fn_reenviar_convite'::text;
  exception when insufficient_privilege or sqlstate 'LB403' or sqlstate 'LB409' then null;
  end;
  begin
    perform fn_salvar_cutoff(1, '08:00');
    v_falhas := v_falhas || 'fn_salvar_cutoff'::text;
  exception when insufficient_privilege or sqlstate 'LB403' then null;
  end;
  begin
    perform fn_definir_papel(gen_random_uuid(), 'admin');
    v_falhas := v_falhas || 'fn_definir_papel'::text;
  exception when insufficient_privilege or sqlstate 'LB403' then null;
  end;

  reset role;

  perform assert_eq((select count(*)::int from auth.users
                      where email = 'invasor@teste.local'), 0,
                    'nenhum usuario criado pelo anonimo');
  if coalesce(array_length(v_falhas, 1), 0) > 0 then
    raise exception 'FALHOU: anon executou %', array_to_string(v_falhas, ', ');
  end if;
  raise notice '  ok  anon nao alcanca nenhuma funcao de administracao';
  raise notice 'PORTA DE ADMIN OK';
end $anon$;

rollback;
