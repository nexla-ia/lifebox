-- LifeBox · testes do ciclo semanal (§4)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/semanas_test.sql

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

do $t$
declare v_id uuid; v_w weeks%rowtype; v_passada uuid; v_futura uuid;
begin
  raise notice 'semana ISO';
  -- 2026-09-21 e uma segunda; 2026-09-27 o domingo da mesma semana
  perform assert_eq(fn_inicio_semana('2026-09-21'), '2026-09-21'::date, 'segunda e o inicio');
  perform assert_eq(fn_inicio_semana('2026-09-27'), '2026-09-21'::date, 'domingo cai na mesma semana');
  perform assert_eq(fn_inicio_semana('2026-09-20'), '2026-09-14'::date, 'sabado anterior e outra semana');
  perform assert_eq(fn_codigo_semana('2026-09-21'), '2026-W39', 'codigo da semana');

  raise notice 'cutoff no fuso operacional';
  -- quinta 18:00 em Nova York = 22:00 UTC no horario de verao
  perform assert_eq(
    fn_cutoff_da_semana('2026-09-21') at time zone 'America/New_York',
    '2026-09-24 18:00'::timestamp, 'quinta 18h em NY');
  perform assert_eq(
    extract(isodow from (fn_cutoff_da_semana('2026-09-21') at time zone 'America/New_York'))::int,
    4, 'cai numa quinta');

  raise notice 'rotacao dos 4 menus';
  -- o ciclo anda de 1 em 1 e volta ao 1 depois do 4
  perform assert_eq(
    array(select fn_menu_do_ciclo('2026-09-21'::date + (n * 7))
            from generate_series(0, 4) n),
    array[fn_menu_do_ciclo('2026-09-21'),
          (fn_menu_do_ciclo('2026-09-21') % 4) + 1,
          ((fn_menu_do_ciclo('2026-09-21') + 1) % 4) + 1,
          ((fn_menu_do_ciclo('2026-09-21') + 2) % 4) + 1,
          fn_menu_do_ciclo('2026-09-21')],
    'ciclo de 4 volta ao inicio');

  raise notice 'criacao da semana';
  v_id := fn_ensure_week('2026-09-23');          -- uma quarta
  select * into v_w from weeks where id = v_id;
  perform assert_eq(v_w.iso_code, '2026-W39', 'codigo');
  perform assert_eq(v_w.starts_on, '2026-09-21'::date, 'comeca na segunda');
  perform assert_eq(v_w.ends_on, '2026-09-27'::date, 'termina no domingo');
  perform assert_eq(v_w.status, 'open'::week_status, 'nasce aberta');
  perform assert_eq(v_w.menu_id is not null, true, 'ja vem com menu do ciclo');

  raise notice 'idempotencia';
  -- qualquer dia da mesma semana devolve a MESMA semana, sem duplicar
  perform assert_eq(fn_ensure_week('2026-09-21'), v_id, 'segunda');
  perform assert_eq(fn_ensure_week('2026-09-27'), v_id, 'domingo');
  perform assert_eq((select count(*)::int from weeks where starts_on = '2026-09-21'),
                    1, 'uma linha so');

  raise notice 'menu trocado a mao nao volta atras';
  update weeks set menu_id = (select id from menus where cycle_position = 1) where id = v_id;
  perform fn_ensure_week('2026-09-23');
  perform assert_eq((select cycle_position from menus
                      where id = (select menu_id from weeks where id = v_id)),
                    1, 'ensure nao sobrescreve o menu');

  raise notice 'cutoff passou?';
  -- datas relativas a hoje: fixar ano no teste o faz quebrar sozinho com o
  -- passar do tempo, e a falha nao apontaria bug nenhum.
  --
  -- Criar e consultar em statements SEPARADOS: fn_passou_cutoff e STABLE e ve
  -- o snapshot do inicio do statement, entao nao enxergaria a semana inserida
  -- na mesma linha de codigo.
  v_passada := fn_ensure_week(fn_hoje_operacional() - 60);
  perform assert_eq(fn_passou_cutoff(v_passada), true, 'semana de dois meses atras');

  v_futura := fn_ensure_week(fn_hoje_operacional() + 30);
  perform assert_eq(fn_passou_cutoff(v_futura), false, 'semana futura ainda nao');

  raise notice 'SEMANAS OK';
end $t$;

rollback;
