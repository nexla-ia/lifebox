-- LifeBox · testes de Configuracoes (§9.8)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/config_test.sql
--
-- O que se prova: mudar o cutoff move a semana em andamento, e quem nao e
-- Administrador e RECUSADO em vez de salvar no vazio.
--
-- O segundo importa mais do que parece: RLS barra UPDATE devolvendo ZERO
-- LINHAS, sem erro. Sem o guard explicito, a Operacao salvaria o cutoff, a
-- tela diria "salvo" e nada teria mudado.

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

-- dois usuarios de teste, um de cada papel
do $fx$
declare v_admin uuid := gen_random_uuid(); v_oper uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values
    (v_admin, 'admin.cfg@teste.local'), (v_oper, 'oper.cfg@teste.local');
  -- o gatilho on_auth_user_created cria o perfil; aqui so ajusta papel e status
  update profiles set role = 'admin',    status = 'ativo' where id = v_admin;
  update profiles set role = 'operacao', status = 'ativo' where id = v_oper;
  perform set_config('lb.admin', v_admin::text, false);
  perform set_config('lb.oper',  v_oper::text,  false);
end $fx$;

do $t$
declare
  v_w uuid; v_prox uuid; r jsonb;
  v_antes timestamptz; v_depois timestamptz;
begin
  -- semana corrente e a seguinte, para separar o que move do que nao move
  v_w    := fn_semana_atual();
  v_prox := fn_ensure_week(fn_hoje_operacional() + 7);

  perform set_config('request.jwt.claim.sub', current_setting('lb.admin'), true);
  perform assert_eq(is_admin(), true, 'o teste roda como Administrador');

  raise notice 'salvar o cutoff grava em settings';
  select cutoff_at into v_antes from weeks where id = v_w;
  r := fn_salvar_cutoff(3, '16:30');
  perform assert_eq((select (value #>> '{}')::int from settings where key = 'cutoff_weekday'),
                    3, 'dia salvo');
  perform assert_eq((select (value #>> '{}') from settings where key = 'cutoff_time'),
                    '16:30', 'hora salva');

  raise notice 'e move as semanas que ainda nao terminaram';
  select cutoff_at into v_depois from weeks where id = v_w;
  perform assert_eq(v_depois is distinct from v_antes, true,
                    'semana em andamento realinhada');
  perform assert_eq(
    to_char(v_depois at time zone
            (select (value #>> '{}') from settings where key = 'timezone'), 'Dy HH24:MI'),
    to_char((select starts_on + 2 from weeks where id = v_w) + time '16:30', 'Dy HH24:MI'),
    'quarta as 16:30 no fuso operacional');
  perform assert_eq((select count(*)::int from weeks
                      where ends_on >= fn_hoje_operacional()
                        and cutoff_at <> fn_cutoff_da_semana(starts_on)),
                    0, 'nenhuma semana aberta fora do novo cutoff');
  perform assert_eq((r->>'semanas_realinhadas')::int >= 2, true,
                    'a semana seguinte tambem move');

  raise notice 'semana ja encerrada NAO se mexe — o pedido antigo continua explicavel';
  -- uma semana no passado, com o cutoff de quando ela valia
  insert into weeks (iso_code, starts_on, ends_on, menu_id, cutoff_at, status)
  values ('2020-W01', date '2020-01-06', date '2020-01-12',
          (select id from menus order by cycle_position limit 1),
          timestamptz '2020-01-09 18:00-05', 'closed');
  perform fn_salvar_cutoff(5, '09:00');
  perform assert_eq((select cutoff_at from weeks where iso_code = '2020-W01'),
                    timestamptz '2020-01-09 18:00-05', 'semana fechada intacta');

  raise notice 'validacao de entrada';
  begin
    perform fn_salvar_cutoff(9, '18:00');
    raise exception 'FALHOU: aceitou dia fora de 1..7';
  exception when sqlstate 'LB400' then raise notice '  ok  recusa dia invalido';
  end;
  begin
    perform fn_salvar_cutoff(4, '25:99');
    raise exception 'FALHOU: aceitou hora invalida';
  exception when sqlstate 'LB400' then raise notice '  ok  recusa hora invalida';
  end;

  raise notice 'Operacao e recusada, nao salva no vazio (§3)';
  perform set_config('request.jwt.claim.sub', current_setting('lb.oper'), true);
  perform assert_eq(is_admin(), false, 'agora roda como Operacao');
  begin
    perform fn_salvar_cutoff(1, '08:00');
    raise exception 'FALHOU: Operacao mudou o cutoff';
  exception when sqlstate 'LB403' then raise notice '  ok  recusa quem nao e Administrador';
  end;
  perform assert_eq((select (value #>> '{}')::int from settings where key = 'cutoff_weekday'),
                    5, 'cutoff continua o que o Administrador deixou');

  raise notice 'CONFIG OK';
end $t$;

-- ---------------------------------------------------- templates do seed base
do $tpl$
declare v_pt text; v_en text;
begin
  select body into v_pt from message_templates
   where key = 'order_confirmation' and language = 'pt';
  select body into v_en from message_templates
   where key = 'order_confirmation' and language = 'en';

  perform assert_eq(v_pt is not null and v_en is not null, true,
                    'confirmacao existe em PT e EN');
  -- §9.2: sem o pedido de comprovante a automacao nao tem o que conferir
  perform assert_eq(position('comprovante' in v_pt) > 0, true, 'PT pede o comprovante');
  perform assert_eq(position('receipt' in v_en) > 0, true, 'EN pede o comprovante');
  perform assert_eq(position('{numero_pedido}' in v_pt) > 0, true, 'PT traz o numero');
  perform assert_eq(position('{total}' in v_en) > 0, true, 'EN traz o total');
  -- nenhum valor monetario escrito no template: o dinheiro vem do pedido
  perform assert_eq(v_pt ~ '\$[0-9]', false, 'nenhum valor fixo no template PT');
  perform assert_eq(v_en ~ '\$[0-9]', false, 'nenhum valor fixo no template EN');
  raise notice 'TEMPLATES OK';
end $tpl$;

-- ------------------------------ o aviso que NAO saiu tem de aparecer (§9.2)
do $aviso$
declare
  v_u uuid := gen_random_uuid(); v_w uuid; v_p uuid; v_s uuid; v_d uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; r jsonb;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_r1 bigint; v_r2 bigint; v_r3 bigint;
begin
  insert into auth.users (id, email) values (v_u, 'aviso.cfg@teste.local');
  update profiles set role = 'operacao', status = 'ativo' where id = v_u;
  perform set_config('request.jwt.claim.sub', v_u::text, true);

  v_w := fn_semana_atual();
  select id into v_s from sizes where code = 'S';
  select id into v_p from plans where active and meals_qty = 5 limit 1;
  select md.dish_id into v_d from menu_dishes md
   where md.menu_id = (select menu_id from weeks where id = v_w) limit 1;

  insert into customers (first_name, phone_e164, status) values
    ('Aviso Um','+15559990001','ativo'), ('Aviso Dois','+15559990002','ativo'),
    ('Aviso Tres','+15559990003','ativo');
  select id into v_c1 from customers where phone_e164 = '+15559990001';
  select id into v_c2 from customers where phone_e164 = '+15559990002';
  select id into v_c3 from customers where phone_e164 = '+15559990003';

  r := fn_create_order(jsonb_build_object('customer_id',v_c1,'week_id',v_w,'kind','plan',
    'plan_id',v_p,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  v_o1 := (r->>'order_id')::uuid;
  r := fn_create_order(jsonb_build_object('customer_id',v_c2,'week_id',v_w,'kind','plan',
    'plan_id',v_p,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  v_o2 := (r->>'order_id')::uuid;
  r := fn_create_order(jsonb_build_object('customer_id',v_c3,'week_id',v_w,'kind','plan',
    'plan_id',v_p,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  v_o3 := (r->>'order_id')::uuid;

  v_r1 := fn_notificar_pedido(v_o1, 'pt');
  v_r2 := fn_notificar_pedido(v_o2, 'pt');
  v_r3 := fn_notificar_pedido(v_o3, 'pt');

  raise notice 'o aviso nasce PENDENTE, nao entregue';
  -- e a diferenca que faltava: antes o audit dizia "enviou" e acabava ali
  perform assert_eq((select situacao from v_avisos_semana where order_id = v_o1),
                    'enviando', 'sem resposta ainda, esta enviando');

  raise notice 'o desfecho do pg_net vira situacao na tela';
  insert into net._http_response (id, status_code) values (v_r1, 200);
  insert into net._http_response (id, status_code, error_msg)
    values (v_r2, null, 'Timeout of 5000 ms reached');
  perform assert_eq(fn_conferir_avisos() >= 2, true, 'conferiu os dois que tinham resposta');

  perform assert_eq((select situacao from v_avisos_semana where order_id = v_o1),
                    'entregue', '200 = entregue');
  perform assert_eq((select situacao from v_avisos_semana where order_id = v_o2),
                    'falhou', 'timeout = falhou');
  perform assert_eq(position('Timeout' in (select erro from v_avisos_semana
                                            where order_id = v_o2)) > 0, true,
                    'e o motivo fica legivel para a equipe');

  raise notice 'o que o pg_net apagou vira DESCONHECIDO, nao entregue';
  -- nao saber se chegou e diferente de ter chegado: marcar como entregue por
  -- omissao esconderia exatamente o caso que este teste existe para pegar
  update webhook_avisos set enviado_em = now() - interval '7 hours'
   where request_id = v_r3;
  perform fn_conferir_avisos();
  perform assert_eq((select situacao from v_avisos_semana where order_id = v_o3),
                    'falhou', 'aviso sem resposta e vencido conta como falha');
  perform assert_eq(position('expirou' in (select erro from v_avisos_semana
                                            where order_id = v_o3)) > 0, true,
                    'e diz que expirou, nao inventa motivo');

  raise notice 'reenviar cria um aviso NOVO, sem apagar o que falhou';
  declare v_antes int; begin
    select count(*) into v_antes from webhook_avisos where order_id = v_o2;
    perform fn_reenviar_aviso(v_o2);
    perform assert_eq((select count(*)::int from webhook_avisos where order_id = v_o2),
                      v_antes + 1, 'o historico da falha continua la');
  end;

  raise notice 'e quem nao e da equipe nao confere nem reenvia';
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform fn_reenviar_aviso(v_o2);
    raise exception 'FALHOU: anonimo reenviou aviso';
  exception when sqlstate 'LB403' then raise notice '  ok  recusa quem nao e da equipe';
  end;

  raise notice 'AVISOS OK';
end $aviso$;

rollback;
