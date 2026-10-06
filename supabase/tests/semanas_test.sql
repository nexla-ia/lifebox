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

-- --------------------------- ordem do menu e clientes sumindo (reuniao 22/09)
do $ordem$
declare
  v_u uuid := gen_random_uuid(); v_m uuid; v_ids uuid[]; v_n int;
  v_novo uuid;
begin
  insert into auth.users (id, email) values (v_u, 'menu.ord@teste.local');
  update profiles set role = 'operacao', status = 'ativo' where id = v_u;
  perform set_config('request.jwt.claim.sub', v_u::text, true);

  select menu_id into v_m from menu_dishes group by menu_id order by count(*) desc limit 1;

  raise notice 'todo prato do menu tem posicao — ordem nunca fica por conta do banco';
  perform assert_eq((select count(*)::int from menu_dishes
                      where menu_id = v_m and position is null), 0,
                    'nenhum prato sem posicao');

  raise notice 'a equipe reordena o menu inteiro numa chamada';
  select array_agg(dish_id order by position desc) into v_ids
    from menu_dishes where menu_id = v_m;
  v_n := fn_ordenar_menu(v_m, v_ids);
  perform assert_eq(v_n, array_length(v_ids, 1), 'todas as linhas gravadas');
  perform assert_eq((select dish_id from menu_dishes
                      where menu_id = v_m order by position limit 1),
                    v_ids[1], 'quem foi posto em primeiro e o primeiro');

  raise notice 'prato novo entra no FIM, nao no comeco';
  -- senao todo prato incluido cairia na frente da folha e a equipe teria de
  -- reordenar de novo a cada inclusao
  insert into dishes (name_pt, name_en, category)
    values ('Prato do fim', 'Last dish', 'classico') returning id into v_novo;
  insert into menu_dishes (menu_id, dish_id) values (v_m, v_novo);
  perform assert_eq((select dish_id from menu_dishes
                      where menu_id = v_m order by position desc limit 1),
                    v_novo, 'o recem-incluido e o ultimo');

  raise notice 'e quem nao e da equipe nao reordena';
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform fn_ordenar_menu(v_m, v_ids);
    raise exception 'FALHOU: anonimo reordenou o menu';
  exception when sqlstate 'LB403' then raise notice '  ok  recusa quem nao e da equipe';
  end;

  raise notice 'ORDEM DO MENU OK';
end $ordem$;

do $sumindo$
declare
  v_u uuid := gen_random_uuid(); v_p uuid; v_s uuid; v_d uuid;
  w1 uuid; w2 uuid; v_a uuid; v_b uuid; v_c uuid;
begin
  insert into auth.users (id, email) values (v_u, 'sumindo@teste.local');
  update profiles set role = 'operacao', status = 'ativo' where id = v_u;
  perform set_config('request.jwt.claim.sub', v_u::text, true);

  select id into v_s from sizes where code = 'S';
  select id into v_p from plans where active and meals_qty = 5 limit 1;
  w1 := fn_ensure_week(fn_hoje_operacional() - 28);
  w2 := fn_ensure_week(fn_hoje_operacional() - 21);
  select md.dish_id into v_d from menu_dishes md
   where md.menu_id = (select menu_id from weeks where id = w1) limit 1;

  insert into customers (first_name, phone_e164, status) values
    ('Sumiu Mesmo','+15551110001','ativo'),
    ('Pausou E Avisou','+15551110002','ativo'),
    ('Nunca Comprou','+15551110003','ativo');
  select id into v_a from customers where phone_e164 = '+15551110001';
  select id into v_b from customers where phone_e164 = '+15551110002';
  select id into v_c from customers where phone_e164 = '+15551110003';

  perform fn_create_order(jsonb_build_object('customer_id', x, 'week_id', w1,
    'kind','plan','plan_id',v_p,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))))
    from unnest(array[v_a, v_b]) x;
  perform fn_set_week_status(v_b, w2, 'skip');

  raise notice 'quem comprava e parou aparece';
  perform assert_eq((select count(*)::int from fn_clientes_sumindo(1)
                      where customer_id = v_a), 1, 'o que sumiu esta na lista');

  raise notice 'quem AVISOU que pausa nao aparece — avisado nao e perdido';
  perform assert_eq((select count(*)::int from fn_clientes_sumindo(1)
                      where customer_id = v_b), 0, 'Skip fica de fora');

  raise notice 'e quem nunca comprou tambem nao: isso e lead, outra conversa';
  perform assert_eq((select count(*)::int from fn_clientes_sumindo(1)
                      where customer_id = v_c), 0, 'sem historico, fora');

  raise notice 'a janela e pergunta de tela: pedir mais semanas encurta a lista';
  perform assert_eq((select count(*)::int from fn_clientes_sumindo(99)), 0,
                    'ninguem sumiu ha 99 semanas');

  raise notice 'CLIENTES SUMINDO OK';
end $sumindo$;

rollback;
