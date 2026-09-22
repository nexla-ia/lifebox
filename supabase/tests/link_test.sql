-- LifeBox · testes do link público (§9.7)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/link_test.sql
--
-- Monta a propria massa e desfaz no fim. So precisa do seed BASE.
--
-- O teste que mais importa aqui e o ultimo: `anon` nao le tabela nenhuma.
-- O link publico e a unica parte do sistema que atende quem nao fez login,
-- entao a porta tem de ser so as funcoes fn_link_*.

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

-- ------------------------------------------------------------------- massa
do $fx$
declare v_plan uuid; v_s uuid; v_rota uuid; v_menu uuid; v_d1 uuid; v_d2 uuid; v_w uuid;
begin
  select id into v_s    from sizes  where code = 'S';
  select id into v_rota from routes where active order by position limit 1;

  insert into zip_codes (zip, city, state, route_id, active)
  values ('02118', 'Boston', 'MA', v_rota, true)
  on conflict (zip) do update set active = true;

  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('TESTE LINK', 'TEST LINK', 5, 0) returning id into v_plan;
  insert into plan_prices (plan_id, size_id, base_price_cents) values (v_plan, v_s, 8000);
  insert into extra_prices (plan_id, size_id, item_kind, unit_price_cents)
    values (v_plan, v_s, 'meal', 1200);

  insert into dishes (name_pt, name_en, category, calories)
    values ('Prato link', 'Link dish', 'classico', 500) returning id into v_d1;
  insert into dishes (name_pt, name_en, category)
    values ('Fora do menu', 'Off menu', 'classico') returning id into v_d2;

  insert into addons (name_pt, name_en, price_cents, requires_plan, active)
    values ('Suco link', 'Link juice', 2990, true, true);

  v_w := fn_semana_atual();
  select menu_id into v_menu from weeks where id = v_w;
  insert into menu_dishes (menu_id, dish_id, active) values (v_menu, v_d1, true);
end $fx$;

-- ------------------------------------------------------------------ testes
do $t$
declare
  v_plan uuid; v_s uuid; v_d uuid; v_w uuid;
  r jsonb; v_cli uuid; v_cut timestamptz; i int;
begin
  select id into v_plan from plans  where name_en = 'TEST LINK';
  select id into v_s    from sizes  where code = 'S';
  select id into v_d    from dishes where name_en = 'Link dish';
  v_w := fn_semana_atual();

  raise notice 'semana: o link abre e fecha pelo cutoff (§4)';
  r := fn_link_semana();
  perform assert_eq((r->>'aberto')::boolean, true, 'aberto antes do cutoff');
  perform assert_eq(r->>'iso_code', (select iso_code from weeks where id = v_w), 'semana corrente');
  perform assert_eq((r->>'entrega')::date, (select ends_on from weeks where id = v_w),
                    'entrega no domingo');

  select cutoff_at into v_cut from weeks where id = v_w;
  update weeks set cutoff_at = now() - interval '1 hour' where id = v_w;
  perform assert_eq((fn_link_semana()->>'aberto')::boolean, false, 'fechado apos o cutoff');
  perform assert_eq((fn_link_semana()->>'proxima_abertura')::date,
                    (select starts_on + 7 from weeks where id = v_w),
                    'proxima janela na segunda seguinte');

  raise notice 'com o link fechado, o servidor recusa — nao so a tela';
  begin
    perform fn_link_criar_pedido(jsonb_build_object(
      'phone','+15550100001','first_name','Fechado','zip_code','02118',
      'kind','plan','plan_id',v_plan,'size_id',v_s,
      'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
    raise exception 'FALHOU: aceitou pedido depois do cutoff';
  exception when sqlstate 'LB423' then
    raise notice '  ok  recusa depois do cutoff';
  end;
  update weeks set cutoff_at = v_cut where id = v_w;

  raise notice 'catalogo';
  r := fn_link_catalogo();
  perform assert_eq(
    (select count(*)::int from jsonb_array_elements(r->'dishes') d
      where d->>'name_en' = 'Link dish'), 1, 'prato do menu da semana');
  perform assert_eq(
    (select count(*)::int from jsonb_array_elements(r->'dishes') d
      where d->>'name_en' = 'Off menu'), 0, 'prato fora do menu nao vai');
  perform assert_eq(
    (select (d->>'calories')::int from jsonb_array_elements(r->'dishes') d
      where d->>'name_en' = 'Link dish'), 500, 'nutricao vai junto (tela 6b)');
  perform assert_eq(
    (select (a->>'requires_plan')::boolean from jsonb_array_elements(r->'addons') a
      where a->>'name_en' = 'Link juice'), true, 'adicional que exige plano (§5.4)');
  perform assert_eq(
    (select (p->'extras'->0->>'unit_price_cents')::int
       from jsonb_array_elements(r->'plans') p where p->>'name_en' = 'TEST LINK'),
    1200, 'unitario da faixa para o aviso de extra (tela 6d)');
  perform assert_eq((r->>'tax_rate')::numeric, setting_num('tax_rate'), 'tax do settings');

  raise notice 'ZIP: quem responde e a tabela (§6.1)';
  perform assert_eq((fn_link_zip('02118')->>'atende')::boolean, true, 'ZIP atendido');
  perform assert_eq(fn_link_zip('02118')->>'city', 'Boston', 'cidade do cadastro');
  perform assert_eq((fn_link_zip('99999')->>'atende')::boolean, false, 'ZIP fora da area');

  raise notice 'identificacao (telas 6e, 6g)';
  perform assert_eq((fn_link_identificar('+15550100002')->>'conhecido')::boolean, false,
                    'numero novo');
  begin
    perform fn_link_identificar('5550100002');
    raise exception 'FALHOU: aceitou telefone fora do E.164';
  exception when sqlstate 'LB400' then
    raise notice '  ok  recusa telefone fora do E.164';
  end;

  raise notice 'telefone: EUA e Brasil valem, o resto nao';
  perform assert_eq(fn_telefone_valido('+15085550164'), true, 'EUA');
  perform assert_eq(fn_telefone_valido('+5569992695898'), true, 'Brasil, celular com 9');
  perform assert_eq(fn_telefone_valido('+551134567890'), true, 'Brasil, fixo');
  perform assert_eq(fn_telefone_valido('+351912345678'), false, 'outro pais, nao');
  perform assert_eq(fn_telefone_valido('15085550164'), false, 'sem o +, nao');
  perform assert_eq(fn_telefone_valido('+1508555016'), false, 'EUA com digito a menos');

  raise notice 'o link fecha pedido com numero do Brasil (§2)';
  declare r_br jsonb; begin
    r_br := fn_link_criar_pedido(jsonb_build_object(
      'phone','+5569992695898','first_name','Brasileiro em Boston',
      'street_address','1 Test St','zip_code','02118',
      'kind','plan','plan_id',v_plan,'size_id',v_s,
      'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
    perform assert_eq(r_br->>'code' is not null, true, 'pedido criado');
    perform assert_eq((select phone_e164 from customers where phone_e164 = '+5569992695898'),
                      '+5569992695898', 'telefone gravado em E.164');
    -- o webhook leva o numero como esta: e a chave do WhatsApp.
    -- net.chamadas e o dubl� do stub local; no Supabase pg_net e real e nao
    -- guarda o corpo enviado, entao o payload se confere aqui.
    if to_regclass('net.chamadas') is not null then
      perform assert_eq(
        (select body->>'telefone' from net.chamadas
          where body->>'code' = r_br->>'code'),
        '+5569992695898', 'automacao recebe o numero do Brasil');
    end if;
  end;
  perform assert_eq((fn_link_identificar('+5569992695898')->>'conhecido')::boolean, true,
                    'e o numero do Brasil e reconhecido depois');

  raise notice 'pedido pelo link';
  r := fn_link_criar_pedido(jsonb_build_object(
    'phone','+15550100003','first_name','Cliente Link',
    'street_address','1 Test St','zip_code','02118',
    'delivery_notes','Porta lateral',
    'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));

  select id into v_cli from customers where phone_e164 = '+15550100003';
  perform assert_eq(v_cli is not null, true, 'cliente criado na hora');
  perform assert_eq((select city from customers where id = v_cli), 'Boston',
                    'cidade vem do ZIP, nao do que a pessoa digitou');
  perform assert_eq((select route_id is not null from customers where id = v_cli), true,
                    'rota sugerida pelo ZIP');
  perform assert_eq((select source from orders where customer_id = v_cli)::text,
                    'public_link', 'pedido marcado como vindo do link');
  -- 5 x 8000 de plano: o total sai do servidor, nunca do navegador (§2)
  perform assert_eq((r->>'total_cents')::int,
                    (fn_price_order('plan', v_plan, v_s, null, 'delivery',
                      jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5)))
                     ->>'total_cents')::int,
                    'total igual ao fn_price_order');
  perform assert_eq((select order_status from customer_weeks
                      where customer_id = v_cli and week_id = v_w)::text,
                    'novo_pedido', 'classificado como Novo Pedido (§6.3)');
  perform assert_eq((select lead_type from customers where id = v_cli)::text, 'old',
                    'quem pediu deixa de ser primeiro contato (§6.2)');

  raise notice 'o pedido avisa a automacao, com a mensagem montada (§9.2)';
  if to_regclass('net.chamadas') is not null then
    declare v_codigo text; begin
      select code into v_codigo from orders where customer_id = v_cli;

      -- um disparo POR PEDIDO, nao um disparo no total: outros pedidos do
      -- proprio teste ja dispararam antes
      perform assert_eq((select count(*)::int from net.chamadas
                          where body->>'code' = v_codigo), 1, 'um disparo para este pedido');
      perform assert_eq(
        (select url from net.chamadas where body->>'code' = v_codigo),
        (select value #>> '{}' from settings where key = 'webhook_order_confirmation'),
        'foi para a URL do settings, nao para uma fixa no codigo');
      perform assert_eq((select body->>'telefone' from net.chamadas
                          where body->>'code' = v_codigo),
                        '+15550100003', 'telefone em E.164, que e a chave do WhatsApp');
      -- a mensagem e a que a LifeBox escreveu na tela 6p, ja preenchida
      perform assert_eq(
        (select position('{' in (body->>'mensagem')) from net.chamadas
          where body->>'code' = v_codigo),
        0, 'nenhuma variavel sobrou por substituir');
      perform assert_eq(
        (select position(v_codigo in (body->>'mensagem')) > 0 from net.chamadas
          where body->>'code' = v_codigo),
        true, 'o numero do pedido entrou no texto');
      perform assert_eq(
        (select body->'variaveis'->>'total' from net.chamadas
          where body->>'code' = v_codigo),
        '$95.60', 'total formatado como o cliente le');
    end;
  else
    raise notice '  --  payload do webhook so no cluster local (aqui pg_net e real)';
  end if;

  raise notice 'webhook fora do ar nao derruba o pedido';
  -- URL invalida: fn_notificar_pedido engole o erro e o pedido continua de pe
  update settings set value = '"nao-e-url"' where key = 'webhook_order_confirmation';
  declare v_antes int; begin
    select count(*) into v_antes from orders;
    perform fn_link_criar_pedido(jsonb_build_object(
      'phone','+15550100009','first_name','Apesar do Webhook','zip_code','02118',
      'kind','plan','plan_id',v_plan,'size_id',v_s,
      'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
    perform assert_eq((select count(*)::int from orders), v_antes + 1,
                      'pedido gravado mesmo com webhook quebrado');
  end;

  raise notice 'URL vazia desliga o aviso, sem erro';
  update settings set value = '""' where key = 'webhook_order_confirmation';
  perform assert_eq(fn_notificar_pedido(
    (select id from orders where customer_id = v_cli), 'pt'), null, 'saiu calado');

  raise notice 'quem volta ao link faz um segundo pedido (tela 6m)';
  perform fn_link_criar_pedido(jsonb_build_object(
    'phone','+15550100003','first_name','Cliente Link','zip_code','02118',
    'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  perform assert_eq((select count(*)::int from orders where customer_id = v_cli),
                    2, 'dois pedidos do mesmo cliente');

  r := fn_link_identificar('+15550100003');
  perform assert_eq((r->>'conhecido')::boolean, true, 'numero reconhecido');
  perform assert_eq(r->>'first_name', 'Cliente Link', 'nome para o "Ola, {nome}"');
  -- a tela 6m mostra o que JA existe antes de a pessoa decidir fazer outro
  perform assert_eq(jsonb_array_length(r->'pedidos'), 2,
                    'a tela lista os dois pedidos da semana');

  raise notice 'ZIP fora da area bloqueia o pedido (tela 6f)';
  begin
    perform fn_link_criar_pedido(jsonb_build_object(
      'phone','+15550100004','first_name','Fora','zip_code','99999',
      'kind','plan','plan_id',v_plan,'size_id',v_s,
      'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
    raise exception 'FALHOU: aceitou pedido fora da area de entrega';
  exception when sqlstate 'LB422' then
    raise notice '  ok  recusa ZIP fora da area';
  end;
  perform assert_eq((select count(*)::int from customers where phone_e164 = '+15550100004'),
                    0, 'ZIP recusado nao deixa cliente pela metade');

  raise notice 'rate limit por telefone (§9.7)';
  for i in 1..6 loop perform fn_link_identificar('+15550100005'); end loop;
  begin
    perform fn_link_identificar('+15550100005');
    raise exception 'FALHOU: consulta de cadastro sem limite';
  exception when sqlstate 'LB429' then
    raise notice '  ok  corta na setima tentativa do mesmo numero';
  end;

  raise notice 'LINK OK';
end $t$;

-- ---------------------------------------------------- a porta e so a funcao
-- Os dois ambientes barram o anon de formas diferentes, e as duas valem:
-- no cluster local ele nao tem GRANT e leva 42501; no Supabase o bootstrap ja
-- concede grant a anon em public, entao quem barra e a RLS e a consulta volta
-- VAZIA. O que se testa aqui e o resultado — nao sai dado — e nao o mecanismo.
do $anon$
declare
  v_t text; v_n int; v_falhas text[] := '{}';
begin
  -- Tabela nova sem RLS no Supabase nasce aberta para o anon, porque la o
  -- grant ja existe. Esta checagem e o alarme para isso.
  select array_agg(c.relname order by c.relname) into v_falhas
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if coalesce(array_length(v_falhas, 1), 0) > 0 then
    raise exception 'FALHOU: tabela sem RLS: %', array_to_string(v_falhas, ', ');
  end if;
  raise notice '  ok  toda tabela de public tem RLS ligada';

  v_falhas := '{}';
  set local role anon;

  foreach v_t in array array['customers','orders','order_items','customer_weeks',
                             'profiles','plans','plan_prices','extra_prices',
                             'zip_codes','settings','dishes','public_requests']
  loop
    begin
      execute format('select count(*) from %I', v_t) into v_n;
      if v_n <> 0 then
        v_falhas := v_falhas || format('%s (%s linhas)', v_t, v_n);
      end if;
    exception when insufficient_privilege then
      null;   -- sem grant nenhum: melhor ainda
    end;
  end loop;

  -- escrever e o risco de verdade num endpoint publico
  -- ROW_COUNT, nao FOUND: EXECUTE nao zera FOUND, entao a variavel chega aqui
  -- com o valor do select anterior e o teste acusaria escrita que nao houve.
  begin
    execute $i$insert into customers (first_name, phone_e164)
              values ('Invasor', '+15550199999')$i$;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_falhas := v_falhas || 'INSERT em customers'::text; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute $u$update settings set value = '0.00' where key = 'tax_rate'$u$;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_falhas := v_falhas || 'UPDATE em settings'::text; end if;
  exception when insufficient_privilege then null;
  end;

  -- ...e a porta continua abrindo
  perform fn_link_semana();
  perform fn_link_catalogo();
  perform fn_link_zip('02118');

  reset role;

  if coalesce(array_length(v_falhas, 1), 0) > 0 then
    raise exception 'FALHOU: anon alcancou %', array_to_string(v_falhas, ', ');
  end if;
  raise notice '  ok  anon nao le nem escreve tabela, e passa pelas funcoes do link';
  raise notice 'PORTA OK';
end $anon$;

rollback;
