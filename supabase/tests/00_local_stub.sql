-- Stub do que o Supabase fornece pronto, para rodar as migrations num Postgres
-- puro (cluster local de teste). NÃO faz parte das migrations e NÃO vai para
-- o projeto Supabase — lá o schema auth e os roles já existem.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

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
