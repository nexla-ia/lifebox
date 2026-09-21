-- LifeBox · usuários e convite por link
-- Ref: LIFEBOX_PROJECT.md §3, §9.8 · telas 9d (Usuários) e 9e (primeiro acesso)
--
-- §3: "convite por e-mail (expira em 7 dias), definição de senha no primeiro
-- acesso, troca de perfil e desativação".
--
-- O convite sai daqui como LINK, não como e-mail: mandar e-mail exigiria SMTP
-- configurado no projeto, e a equipe se fala por WhatsApp de qualquer jeito. O
-- Administrador copia o link e manda. O que importa da regra continua de pé —
-- a pessoa define a própria senha, o convite expira e serve uma vez só.
--
-- Escrever em auth.users precisa de `security definer`: o role `authenticated`
-- não tem grant nenhum lá. Por isso cada função abre com o guard de papel —
-- security definer sem guard é uma porta aberta com a chave na fechadura.

-- --------------------------------------------- is_admin() nunca devolve NULL
-- ACHADO AO ESCREVER ESTA MIGRATION, e o motivo de ela começar por aqui.
--
-- `current_role_of()` devolve NULL para quem não tem perfil ATIVO — anônimo,
-- desativado, convite pendente. E `NULL = 'admin'` é NULL, não false. Então
-- `if not is_admin() then raise` recebia NULL, que o plpgsql trata como falso:
-- o guard simplesmente não disparava.
--
-- Em policy de RLS isso nunca apareceu, porque `using (NULL)` já barra. Mas em
-- função `security definer` o guard é a ÚNICA barreira — e sem ele um chamador
-- anônimo criava Administrador. Reproduzido antes do conserto.
--
-- coalesce aqui, e não em cada chamador: um predicado de permissão que devolve
-- NULL é uma armadilha que se paga uma vez por lugar que esquecer dela.
create or replace function is_admin() returns boolean
language sql stable as $$ select coalesce(current_role_of() = 'admin', false) $$;

create or replace function is_staff() returns boolean
language sql stable as $$
  select coalesce(current_role_of() in ('admin','operacao'), false)
$$;

create table user_invites (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz
);
create index on user_invites (user_id) where accepted_at is null;

alter table user_invites enable row level security;
alter table user_invites force row level security;
-- ninguém lê a tabela direto: o convite chega pelo token, pelas funções abaixo
create policy user_invites_admin on user_invites
  for select using (is_admin());
grant select on user_invites to authenticated;

-- ------------------------------------------------------------------ convidar
/** Cria o usuário e devolve o token do convite (tela 9d).
 *
 *  A senha nasce aleatória e ninguém a conhece — nem quem convidou. O acesso
 *  só abre quando a pessoa define a dela, porque `email_confirmed_at` fica
 *  nulo até lá e o GoTrue recusa o login. */
create or replace function fn_convidar_usuario(
  p_email text, p_nome text, p_papel user_role
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_email text := lower(trim(p_email));
  v_id    uuid := gen_random_uuid();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_exp   timestamptz := now() + interval '7 days';
  v_quem  uuid := auth.uid();
begin
  if not is_admin() then
    raise exception 'Só o Administrador convida usuários.' using errcode = 'LB403';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.' using errcode = 'LB400';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'O nome é obrigatório.' using errcode = 'LB400';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Já existe usuário com o e-mail %.', v_email using errcode = 'LB409';
  end if;

  -- Ver a armadilha documentada em supabase/tools/criar_usuario.sql: os quatro
  -- campos de token não têm DEFAULT e o GoTrue os lê como string não-nula.
  -- Deixá-los NULL faz o login devolver 500 antes de conferir a senha.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, invited_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id,
    'authenticated', 'authenticated', v_email,
    -- senha impossível de adivinhar e que ninguém guardou: o caminho de
    -- entrada é o convite, não um "primeiro acesso" com senha padrão
    extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'),
                     extensions.gen_salt('bf')),
    null, now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_nome), 'role', p_papel::text),
    '', '', '', ''
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, created_at, updated_at
  ) values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', false),
    'email', now(), now()
  );

  update profiles set invited_by = v_quem where id = v_id;

  insert into user_invites (token, user_id, email, invited_by, expires_at)
  values (v_token, v_id, v_email, v_quem, v_exp);

  return jsonb_build_object('user_id', v_id, 'token', v_token, 'expires_at', v_exp);
end $fn$;

/** Novo token para quem não acessou a tempo (tela 9e: "expirou? peça um novo").
 *  O anterior morre junto — convite velho circulando é chave a mais. */
create or replace function fn_reenviar_convite(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
        v_exp timestamptz := now() + interval '7 days';
        v_email text;
begin
  if not is_admin() then
    raise exception 'Só o Administrador convida usuários.' using errcode = 'LB403';
  end if;
  select email into v_email from profiles where id = p_user and status = 'convite_pendente';
  if v_email is null then
    raise exception 'Este usuário não tem convite pendente.' using errcode = 'LB409';
  end if;

  delete from user_invites where user_id = p_user and accepted_at is null;
  insert into user_invites (token, user_id, email, invited_by, expires_at)
  values (v_token, p_user, v_email, auth.uid(), v_exp);

  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $fn$;

-- ----------------------------------------------------- primeiro acesso (9e)
/** O que a tela de convite mostra antes de pedir a senha.
 *
 *  Token inválido devolve só `valido: false`. Nada de "este e-mail não existe"
 *  ou "expirou em tal dia": numa página aberta, a diferença entre as respostas
 *  já é informação. */
create or replace function fn_convite(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
  perform fn_link_guard('convite', fn_link_ip(), 20, interval '10 minutes');

  select i.token, i.expires_at, p.full_name, p.email, p.role, p.status,
         q.full_name as convidou
    into r
    from user_invites i
    join profiles p on p.id = i.user_id
    left join profiles q on q.id = i.invited_by
   where i.token = p_token
     and i.accepted_at is null
     and i.expires_at > now()
     and p.status = 'convite_pendente';

  if r.token is null then
    return jsonb_build_object('valido', false);
  end if;

  return jsonb_build_object(
    'valido', true, 'nome', r.full_name, 'email', r.email,
    'papel', r.role, 'convidou', r.convidou, 'expira_em', r.expires_at);
end $fn$;

/** Define a senha e abre o acesso.
 *
 *  Confirmar o e-mail dispara on_auth_user_confirmed, que muda o perfil de
 *  `convite_pendente` para `ativo` — a regra de "quando o acesso abre" fica num
 *  lugar só, o mesmo que vale para quem entra por outro caminho. */
create or replace function fn_aceitar_convite(p_token text, p_senha text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_user uuid; v_email text;
begin
  perform fn_link_guard('convite', fn_link_ip(), 20, interval '10 minutes');

  if length(coalesce(p_senha, '')) < 8 then
    raise exception 'A senha precisa de pelo menos 8 caracteres.' using errcode = 'LB400';
  end if;

  select i.user_id, i.email into v_user, v_email
    from user_invites i
    join profiles p on p.id = i.user_id
   where i.token = p_token
     and i.accepted_at is null
     and i.expires_at > now()
     -- desativar alguém antes de ele aceitar também cancela o convite
     and p.status = 'convite_pendente';

  if v_user is null then
    raise exception 'Convite inválido ou expirado. Peça um novo ao Administrador.'
      using errcode = 'LB410';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         email_confirmed_at = now(),
         updated_at = now()
   where id = v_user;

  update user_invites set accepted_at = now() where token = p_token;

  return jsonb_build_object('email', v_email);
end $fn$;

-- ------------------------------------------------------ papel e desativação
/** Troca de perfil (tela 9d).
 *
 *  Não dá para mexer em si mesmo: rebaixar-se sem querer é o jeito mais fácil
 *  de perder o acesso. "Não sobrar nenhum Administrador" é barrado pelo
 *  gatilho abaixo, não aqui — ver o porquê lá.
 */
create or replace function fn_definir_papel(p_user uuid, p_papel user_role)
returns void
language plpgsql security invoker as $fn$
begin
  if not is_admin() then
    raise exception 'Só o Administrador troca perfis.' using errcode = 'LB403';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode trocar o próprio perfil. Peça a outro Administrador.'
      using errcode = 'LB403';
  end if;

  update profiles set role = p_papel where id = p_user;
end $fn$;

/** Desativar preserva o histórico: o usuário continua sendo o autor dos
 *  pedidos e confirmações que lançou. O acesso cai porque current_role_of()
 *  só enxerga quem está 'ativo' — ou seja, a RLS para de devolver linha,
 *  não só o menu some. */
create or replace function fn_definir_status(p_user uuid, p_status user_status)
returns void
language plpgsql security invoker as $fn$
begin
  if not is_admin() then
    raise exception 'Só o Administrador ativa e desativa usuários.' using errcode = 'LB403';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode desativar a si mesmo.' using errcode = 'LB403';
  end if;
  if p_status = 'convite_pendente' then
    raise exception 'Convite pendente não se define à mão: reenvie o convite.'
      using errcode = 'LB400';
  end if;

  update profiles set status = p_status where id = p_user;
end $fn$;

/** Remove de vez quem nunca lançou nada (tela 9d).
 *
 *  Existe por um caso banal e sem saída: convite mandado para o e-mail errado.
 *  Hoje aquele endereço fica ocupado para sempre — `fn_convidar_usuario` recusa
 *  repetido — e sobra um "convite pendente" que ninguém vai aceitar.
 *
 *  Quem já trabalhou NÃO sai: apagar o autor de um pedido deixaria o histórico
 *  sem dono, e é por isso que o caminho normal é desativar (§3). A checagem é
 *  por FK, uma por uma, porque `on delete set null` apagaria o rastro em
 *  silêncio em vez de recusar. */
create or replace function fn_remover_usuario(p_user uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then
    raise exception 'Só o Administrador remove usuários.' using errcode = 'LB403';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode remover a si mesmo.' using errcode = 'LB403';
  end if;
  if not exists (select 1 from profiles where id = p_user) then
    raise exception 'Usuário não encontrado.' using errcode = 'LB409';
  end if;

  if exists (select 1 from orders          where created_by   = p_user)
  or exists (select 1 from orders          where confirmed_by = p_user)
  or exists (select 1 from bag_movements   where created_by   = p_user)
  or exists (select 1 from settings        where updated_by   = p_user)
  or exists (select 1 from audit_log       where user_id      = p_user)
  or exists (select 1 from profiles        where invited_by   = p_user) then
    raise exception
      'Este usuário já tem histórico no sistema. Desative em vez de remover, '
      'para os lançamentos dele continuarem com autor.'
      using errcode = 'LB409';
  end if;

  -- profiles, identities e user_invites caem por cascade a partir de auth.users
  delete from auth.users where id = p_user;
end $fn$;

-- ------------------------------------------------- nunca zero Administradores
/** A trava mora no GATILHO, não nas funções acima.
 *
 *  A policy `profiles_admin_all` deixa o Administrador editar qualquer linha de
 *  profiles — inclusive a dele — direto pela tabela, sem passar por
 *  fn_definir_papel. Uma checagem só dentro da função seria contornada por um
 *  PATCH em /rest/v1/profiles, que é uma requisição, não uma invasão.
 *
 *  Ficar sem Administrador ativo não tem conserto pela interface: ninguém mais
 *  consegue convidar, promover ou mexer em Configurações. Sairia dali só por
 *  psql — coisa que a LifeBox não tem como fazer num domingo de montagem.
 *
 *  Só dispara quando a linha alterada ERA um Administrador ativo: assim um
 *  banco recém-criado, que ainda não tem nenhum, continua editável. */
create or replace function tg_sobra_um_admin() returns trigger
language plpgsql as $fn$
begin
  if (old.role = 'admin' and old.status = 'ativo')
     and not exists (select 1 from profiles
                      where role = 'admin' and status = 'ativo') then
    raise exception 'Precisa sobrar ao menos um Administrador ativo.'
      using errcode = 'LB409';
  end if;
  return null;
end $fn$;

drop trigger if exists sobra_um_admin on profiles;
create trigger sobra_um_admin
  after update or delete on profiles
  for each row execute function tg_sobra_um_admin();

-- ------------------------------------------------------------------ grants
-- SEGUNDA metade do achado acima: no Postgres, função nova nasce com EXECUTE
-- para PUBLIC. `grant ... to authenticated` não fecha nada — só acrescenta.
-- Quem escreve em auth.users tem de REVOGAR de public primeiro, senão o anon
-- alcança pela porta que ninguém abriu de propósito.
revoke execute on function fn_convidar_usuario(text, text, user_role) from public;
revoke execute on function fn_reenviar_convite(uuid)                  from public;
revoke execute on function fn_definir_papel(uuid, user_role)          from public;
revoke execute on function fn_definir_status(uuid, user_status)       from public;
revoke execute on function fn_salvar_cutoff(int, text)                from public;
revoke execute on function fn_remover_usuario(uuid)                   from public;

grant execute on function fn_convidar_usuario(text, text, user_role) to authenticated;
grant execute on function fn_reenviar_convite(uuid)                  to authenticated;
grant execute on function fn_definir_papel(uuid, user_role)          to authenticated;
grant execute on function fn_definir_status(uuid, user_status)       to authenticated;
grant execute on function fn_salvar_cutoff(int, text)                to authenticated;
grant execute on function fn_remover_usuario(uuid)                   to authenticated;

-- o convidado ainda não tem sessão: estas duas atendem o anon de propósito
grant execute on function fn_convite(text)                 to anon, authenticated;
grant execute on function fn_aceitar_convite(text, text)   to anon, authenticated;
