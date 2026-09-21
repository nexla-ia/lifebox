-- LifeBox · provisionamento de usuário
-- Ref: LIFEBOX_PROJECT.md §3 "convite por e-mail (expira em 7 dias), definição
-- de senha no primeiro acesso, troca de perfil e desativação"
--
-- O Auth do Supabase cria a linha em auth.users; o perfil operacional (nome,
-- papel, status) mora em public.profiles. Estes gatilhos mantêm os dois em dia,
-- para não existir usuário autenticado sem perfil — que entraria no sistema sem
-- papel nenhum e veria tela de erro.
--
-- security definer: roda como o dono (postgres, que tem BYPASSRLS), porque no
-- momento do cadastro auth.uid() ainda é nulo e nenhuma policy de profiles
-- deixaria inserir.

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_role user_role;
begin
  -- o papel vem do convite; valor inválido ou ausente cai no menos privilegiado
  -- entre os perfis de escritório, nunca em admin
  v_role := case
    when new.raw_user_meta_data->>'role' in ('admin','operacao','cozinha')
      then (new.raw_user_meta_data->>'role')::user_role
    else 'operacao'::user_role
  end;

  insert into public.profiles (id, full_name, email, role, status, invited_at)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
             split_part(coalesce(new.email, 'usuario'), '@', 1)),
    coalesce(new.email, ''),
    v_role,
    -- quem já chega confirmado entra ativo; convite fica pendente até a pessoa
    -- definir a senha no primeiro acesso
    case when new.email_confirmed_at is not null then 'ativo'::user_status
         else 'convite_pendente'::user_status end,
    new.invited_at
  )
  on conflict (id) do nothing;

  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- primeiro acesso concluído: o convite vira acesso ativo
create or replace function handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles
       set status = 'ativo'
     where id = new.id
       and status = 'convite_pendente';
  end if;
  return new;
end $fn$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function handle_user_confirmed();

-- Desativar um usuário é mudar profiles.status: o histórico fica, o acesso cai
-- (o AuthProvider recusa quem não está 'ativo'). Não apagamos auth.users, senão
-- perderíamos o autor de pedidos e confirmações antigas.
comment on column profiles.status is
  'ativo | convite_pendente | desativado. Desativação preserva histórico (§3).';
