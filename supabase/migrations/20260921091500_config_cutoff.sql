-- LifeBox · cutoff editável
-- Ref: LIFEBOX_PROJECT.md §4, §9.8 · tela 9d
--
-- `weeks.cutoff_at` é gravado na CRIAÇÃO da semana (fn_ensure_week), não lido
-- de settings a cada consulta. É de propósito: a semana carrega o cutoff que
-- valia quando abriu, e mudar a configuração não reescreve história.
--
-- Só que quem muda o cutoff na tela quer dizer "a partir de agora, inclusive
-- esta semana". Sem realinhar, a equipe salvaria quarta 16h e veria o link
-- continuar fechando quinta 18h, sem erro nenhum — o pior tipo de silêncio.
-- Então a função move as semanas que ainda não terminaram, e só essas.

create or replace function fn_salvar_cutoff(p_weekday int, p_hora text)
returns jsonb
language plpgsql security invoker as $fn$
declare v_n int;
begin
  -- RLS recusaria o UPDATE em settings devolvendo ZERO LINHAS, sem erro: a
  -- tela diria "salvo" e nada teria mudado. O guard explícito é o que
  -- transforma isso numa recusa visível (§3).
  if not is_admin() then
    raise exception 'Só o Administrador edita o cutoff.' using errcode = 'LB403';
  end if;

  if p_weekday is null or p_weekday < 1 or p_weekday > 7 then
    raise exception 'Dia do cutoff inválido: use 1 (segunda) a 7 (domingo).'
      using errcode = 'LB400';
  end if;
  if p_hora !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Hora do cutoff inválida: use HH:MM, de 00:00 a 23:59.'
      using errcode = 'LB400';
  end if;

  update settings
     set value = to_jsonb(p_weekday), updated_at = now(), updated_by = auth.uid()
   where key = 'cutoff_weekday';
  update settings
     set value = to_jsonb(p_hora), updated_at = now(), updated_by = auth.uid()
   where key = 'cutoff_time';

  -- statement separado do UPDATE acima: fn_cutoff_da_semana é STABLE e lê
  -- settings no snapshot do início DO STATEMENT. No mesmo comando ela ainda
  -- enxergaria o valor antigo.
  update weeks
     set cutoff_at = fn_cutoff_da_semana(starts_on)
   where ends_on >= fn_hoje_operacional();
  get diagnostics v_n = row_count;

  return jsonb_build_object('semanas_realinhadas', v_n);
end $fn$;

grant execute on function fn_salvar_cutoff(int, text) to authenticated;
