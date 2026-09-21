-- LifeBox · ciclo semanal
-- Ref: LIFEBOX_PROJECT.md §4
--
--   segunda        abre a semana e o link público
--   quinta 18:00   cutoff — o link fecha sozinho, sem exceção
--   sexta          pré-preparo; pedido manual entra com post_cutoff
--   sábado         produção
--   domingo        montagem e entrega
--
-- Tudo no fuso operacional, que vem de settings (America/New_York). Calcular
-- cutoff no fuso do servidor daria 3 horas de diferença e fecharia o link na
-- hora errada.

/** O "hoje" da operação, não o do servidor. */
create or replace function fn_hoje_operacional() returns date
language sql stable as $fn$
  select (now() at time zone coalesce(
    (settings.value #>> '{}'), 'America/New_York'))::date
  from settings where key = 'timezone'
$fn$;

/** Segunda-feira da semana ISO que contém a data. */
create or replace function fn_inicio_semana(p_data date) returns date
language sql immutable as $fn$
  select (date_trunc('week', p_data::timestamp))::date
$fn$;

/** '2026-W38'. Semana ISO, começando na segunda (§2). */
create or replace function fn_codigo_semana(p_data date) returns text
language sql immutable as $fn$
  select to_char(p_data, 'IYYY-"W"IW')
$fn$;

/** Posição no ciclo de 4 menus para uma semana (§4).
 *
 *  A rotação é automática, mas ancorada: `menu_cycle_offset` em settings
 *  desloca o ciclo para casar com o que a LifeBox já estava rodando. Sem
 *  âncora, o sistema escolheria um menu arbitrário na primeira semana.
 */
create or replace function fn_menu_do_ciclo(p_data date) returns int
language sql stable as $fn$
  select ((extract(week from p_data)::int
           + coalesce((select (value #>> '{}')::int from settings
                        where key = 'menu_cycle_offset'), 0)
           - 1) % greatest(coalesce((select (value #>> '{}')::int from settings
                                      where key = 'menu_cycle_length'), 4), 1)) + 1
$fn$;

/** Instante do cutoff de uma semana, no fuso operacional. */
create or replace function fn_cutoff_da_semana(p_inicio date) returns timestamptz
language sql stable as $fn$
  select ((p_inicio
           + (coalesce((select (value #>> '{}')::int from settings
                         where key = 'cutoff_weekday'), 4) - 1))::text
          || ' '
          || coalesce((select (value #>> '{}') from settings
                        where key = 'cutoff_time'), '18:00'))::timestamp
         at time zone coalesce((select (value #>> '{}') from settings
                                 where key = 'timezone'), 'America/New_York')
$fn$;

/** Garante que a semana da data existe e devolve o id.
 *
 *  Idempotente: chamar de novo não duplica nem sobrescreve o menu que a equipe
 *  tenha trocado à mão. O ciclo só decide o menu na CRIAÇÃO. */
create or replace function fn_ensure_week(p_data date default null)
returns uuid
language plpgsql as $fn$
declare
  v_data   date := coalesce(p_data, fn_hoje_operacional());
  v_inicio date := fn_inicio_semana(v_data);
  v_id     uuid;
begin
  select id into v_id from weeks where starts_on = v_inicio;
  if v_id is not null then return v_id; end if;

  insert into weeks (iso_code, starts_on, ends_on, menu_id, cutoff_at, status)
  values (
    fn_codigo_semana(v_inicio),
    v_inicio,
    v_inicio + 6,
    (select id from menus where cycle_position = fn_menu_do_ciclo(v_inicio)),
    fn_cutoff_da_semana(v_inicio),
    'open'
  )
  on conflict (iso_code) do nothing
  returning id into v_id;

  -- corrida entre dois acessos simultâneos: quem perdeu lê o que o outro criou
  if v_id is null then
    select id into v_id from weeks where starts_on = v_inicio;
  end if;

  return v_id;
end $fn$;

/** A semana corrente, criando se ainda não existir. */
create or replace function fn_semana_atual() returns uuid
language sql as $fn$ select fn_ensure_week(null) $fn$;

/** §4: passou do cutoff? Vale para o link público fechar sozinho e para marcar
 *  post_cutoff em pedido lançado depois. */
create or replace function fn_passou_cutoff(p_week uuid) returns boolean
language sql stable as $fn$
  select now() > cutoff_at from weeks where id = p_week
$fn$;

-- âncora do ciclo: 0 mantém o cálculo puro pelo número da semana ISO.
-- A LifeBox ajusta este número uma vez, para o Menu 1 cair na semana certa.
insert into settings (key, value, description)
values ('menu_cycle_offset', '0',
        'Desloca a rotação de menus para casar com o ciclo real da LifeBox (§4)')
on conflict (key) do nothing;
