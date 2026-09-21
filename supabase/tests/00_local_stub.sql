-- Stub do que o Supabase fornece pronto, para rodar as migrations num Postgres
-- puro (cluster local de teste). NÃO faz parte das migrations e NÃO vai para
-- o projeto Supabase — lá o schema auth e os roles já existem.

create schema if not exists auth;

-- Espelha as colunas de auth.users que o nosso código toca. NÃO é a tabela
-- completa do Supabase — só o bastante para as migrations e os testes rodarem.
-- Se uma migration passar a usar outra coluna, adicione aqui também, senão o
-- cluster local diverge do Supabase e o erro só aparece no deploy.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  -- varchar(255), como no Supabase, e nao text: a diferenca aparece em
  -- assert_eq(anyelement, anyelement), que exige o MESMO tipo nos dois lados.
  -- Com text aqui o teste passava local e quebrava lá.
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at         timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- os quatro sem DEFAULT no Supabase. Aqui vão com default '' porque o que
  -- interessa reproduzir é a leitura do GoTrue, não a armadilha do insert —
  -- essa quem guarda é o check do criar_usuario.sql.
  confirmation_token     varchar(255) not null default '',
  recovery_token         varchar(255) not null default '',
  email_change_token_new varchar(255) not null default '',
  email_change           varchar(255) not null default ''
);

-- o GoTrue exige a identidade do provedor para aceitar o login; a migration
-- do convite cria uma junto com o usuário
create table if not exists auth.identities (
  provider_id     text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (provider, provider_id)
);

-- pgcrypto mora no schema `extensions` no Supabase: crypt() e gen_salt() são
-- o bcrypt que o GoTrue confere no login
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- no Supabase vem do JWT; aqui vem de uma variável de sessão, para os testes
-- de RLS trocarem de usuário com  set local request.jwt.claim.sub = '<uuid>'
create or replace function auth.uid() returns uuid
language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $roles$;

grant usage on schema public to anon, authenticated, service_role;
-- no Supabase o anon enxerga o schema auth (as policies chamam auth.uid() o
-- tempo todo); sem este grant o cluster local diverge e o erro só apareceria lá
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Storage: o Supabase fornece; aqui só o esqueleto que a migration 0800 toca.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text,
  owner     uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
