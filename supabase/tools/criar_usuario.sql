-- LifeBox · cria um usuário direto no banco
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v email=alguem@lifeboxfoods.com -v senha='...' \
--     -v nome='Nome Sobrenome' -v papel=admin \
--     -f supabase/tools/criar_usuario.sql
--
-- papel: admin | operacao | cozinha
--
-- Serve para o PRIMEIRO Administrador, que não tem quem o convide. Do segundo
-- em diante o caminho normal é o convite por e-mail da tela de Configurações
-- (§3), que passa pelo Auth e dispara os mesmos gatilhos.
--
-- O perfil em public.profiles NÃO é criado aqui: quem cria é o gatilho
-- on_auth_user_created, lendo full_name e role do metadata. Assim este atalho
-- exercita exatamente o mesmo caminho do convite.

\set ON_ERROR_STOP on

-- o psql NÃO substitui :'variavel' dentro de bloco $$ ... $$, então os valores
-- entram por configuração de sessão e o bloco os lê de volta
select set_config('lb.email', lower(trim(:'email')), false),
       set_config('lb.senha', :'senha', false),
       set_config('lb.nome',  :'nome',  false),
       set_config('lb.papel', :'papel', false) \gset

do $cria$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := current_setting('lb.email');
  v_senha text := current_setting('lb.senha');
  v_nome  text := current_setting('lb.nome');
  v_papel text := current_setting('lb.papel');
  v_hash  text;
begin
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'já existe usuário com o e-mail %', v_email;
  end if;
  if v_papel not in ('admin','operacao','cozinha') then
    raise exception 'papel inválido: % (use admin, operacao ou cozinha)', v_papel;
  end if;
  if length(v_senha) < 8 then
    raise exception 'senha muito curta: mínimo de 8 caracteres';
  end if;

  -- bcrypt, o mesmo algoritmo que o GoTrue usa para conferir no login
  v_hash := extensions.crypt(v_senha, extensions.gen_salt('bf'));

  -- ATENÇÃO aos quatro campos de token no fim do insert: eles não têm DEFAULT
  -- na tabela, e o GoTrue os lê como string não-nula. Deixá-los NULL faz o
  -- login devolver 500 "Database error querying schema" — a leitura da linha
  -- estoura antes de sequer conferir a senha, então o erro não parece de
  -- credencial. Custou um diagnóstico; não remova os '' daqui.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated', v_email, v_hash,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_nome, 'role', v_papel),
    '', '', '', ''
  );

  -- o GoTrue exige a identidade do provedor "email" para aceitar o login;
  -- a coluna email de auth.identities é gerada, então não entra no insert
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  raise notice 'usuário criado: % (%) — perfil %', v_email, v_id, v_papel;
end $cria$;

-- guarda contra a regressão descrita acima: se qualquer usuário ficar com um
-- desses campos nulo, o login dele devolve 500 e o erro não parece de senha
do $check$
declare v_qtd int;
begin
  select count(*) into v_qtd from auth.users
   where confirmation_token is null or recovery_token is null
      or email_change_token_new is null or email_change is null;
  if v_qtd > 0 then
    raise exception '% usuario(s) com campo de token nulo — o login deles vai dar 500', v_qtd;
  end if;
end $check$;

-- confere que o gatilho fez o perfil
select p.email, p.full_name, p.role, p.status
  from profiles p
  join auth.users u on u.id = p.id
 where lower(u.email) = current_setting('lb.email');
