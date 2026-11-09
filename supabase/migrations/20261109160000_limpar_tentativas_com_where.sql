-- LifeBox · a válvula de escape do rate limit não abria
-- Ref: medido contra o Supabase da cliente em 09/11/2026
--
-- `fn_link_limpar_tentativas()` fazia `delete from public_requests;` sem WHERE.
-- No cluster local isso funciona. No Supabase, NÃO:
--
--   {"code":"21000","message":"DELETE requires a WHERE clause"}
--
-- O Supabase carrega o pg_safeupdate no role do PostgREST, que recusa DELETE e
-- UPDATE sem qualificação. A função nunca apagou nada em produção — levantava
-- 21000 e voltava o erro para quem chamou.
--
-- O estrago não é o teste que quebrou. Essas duas funções são a ÚNICA válvula
-- de escape quando o limite barra cliente de verdade (§9.7): o limite por IP é
-- folgado de propósito, mas em rede de celular muita gente divide o mesmo IP, e
-- depois de um disparo de campanha o link começa a recusar quem deveria entrar.
-- A equipe clicaria em "soltar tudo" e nada aconteceria.
--
-- `fn_link_liberar_tentativas(chave)` não tem o problema: ela já filtra por
-- chave, então tem WHERE. Quem estava quebrada era só a de soltar tudo — e é
-- justamente a de emergência.
--
-- MESMA ARMADILHA DO `revoke ... from anon`: o cluster local não tem a
-- extensão, então o teste local passa e o Supabase fica quebrado. O que pega
-- este caso é rodar contra o Supabase, não contra o cluster.
--
-- O WHERE é sobre COLUNA de propósito. `where true` é dobrado para constante
-- pelo planejador e o pg_safeupdate recusa do mesmo jeito; `created_at <=
-- now()` é uma qualificação de verdade, que o planejador mantém, e diz o que
-- a função faz: apaga o que já foi registrado.

create or replace function fn_link_limpar_tentativas() returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not is_admin() then
    raise exception 'Só o Administrador limpa o controle de tentativas.'
      using errcode = 'LB403';
  end if;
  -- qualificação sobre coluna: o pg_safeupdate do Supabase recusa DELETE sem
  -- WHERE, e `where true` não conta porque é dobrado para constante
  delete from public_requests where created_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

comment on function fn_link_limpar_tentativas() is
  'Solta o controle de tentativas do link (§9.7). O WHERE sobre created_at '
  'existe porque o pg_safeupdate do Supabase recusa DELETE sem qualificação — '
  'sem ele a função levantava 21000 e a válvula de escape não abria '
  '(medido em 09/11/2026).';

revoke execute on function fn_link_limpar_tentativas() from public, anon;
grant  execute on function fn_link_limpar_tentativas() to authenticated;
