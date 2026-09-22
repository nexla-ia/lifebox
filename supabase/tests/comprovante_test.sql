-- LifeBox · testes do comprovante de pagamento (§9.3)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/comprovante_test.sql
--
-- O que mais importa aqui e o que NAO confirma. Confirmar pagamento que nao
-- entrou e o erro caro deste sistema: o pedido sai para producao, a bag vai
-- para a rua e ninguem cobra. Por isso cada checagem do §9.3 tem teste, e o
-- caminho feliz so fecha com o modo sombra desligado de proposito.

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
declare v_plan uuid; v_s uuid; v_d uuid; v_w uuid; v_c uuid;
begin
  select id into v_s from sizes where code = 'S';
  insert into plans (name_pt, name_en, meals_qty, breakfasts_qty)
    values ('PLANO CMP', 'PLAN CMP', 5, 0) returning id into v_plan;
  insert into plan_prices (plan_id, size_id, base_price_cents) values (v_plan, v_s, 10000);
  insert into dishes (name_pt, name_en, category)
    values ('Prato cmp', 'Dish cmp', 'classico') returning id into v_d;

  insert into payment_methods (name_pt, name_en, recipient_keys, active)
    values ('Zelle CMP', 'Zelle CMP', array['pagamentos@lifebox.test'], true);

  insert into customers (first_name, phone_e164, status)
    values ('Paga Certo', '+15552220001', 'ativo') returning id into v_c;

  v_w := fn_semana_atual();
  perform fn_create_order(jsonb_build_object(
    'customer_id', v_c, 'week_id', v_w, 'kind', 'plan',
    'plan_id', v_plan, 'size_id', v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
end $fx$;

-- ------------------------------------------------------------------ testes
do $t$
declare
  r jsonb; o orders%rowtype; v_aberto int; v_c uuid;
begin
  select id into v_c from customers where phone_e164 = '+15552220001';
  select * into o from orders where customer_id = v_c;
  v_aberto := o.total_cents - o.paid_amount_cents;

  raise notice 'a automacao acha o pedido pelo TELEFONE (orders nao guarda numero)';
  r := fn_pedidos_do_telefone('+15552220001');
  perform assert_eq((r->>'encontrado')::boolean, true, 'cliente encontrado');
  perform assert_eq(jsonb_array_length(r->'pedidos'), 1, 'um pedido na semana');
  perform assert_eq((r->'pedidos'->0->>'em_aberto_cents')::int, v_aberto,
                    'em aberto = total - pago');
  perform assert_eq(r->'pedidos'->0->>'payment_status', 'aguardando_pagamento',
                    'nasce aguardando pagamento');
  perform assert_eq((fn_pedidos_do_telefone('+15559999999')->>'encontrado')::boolean,
                    false, 'numero fora do cadastro');

  raise notice 'MODO SOMBRA: passa em tudo, mas NAO confirma sozinho (§9.3.9)';
  perform assert_eq(setting_bool('receipt_auto_confirm'), false, 'sombra ligada no seed');
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto,
    'storage_path','comprovantes/a.jpg',
    'destinatario','pagamentos@lifebox.test',
    'transaction_id','TX-001', 'confianca', 0.98));
  perform assert_eq(r->>'motivo', 'ok', 'todas as checagens passaram');
  perform assert_eq((r->>'teria_confirmado')::boolean, true, 'o sistema confirmaria');
  perform assert_eq((r->>'modo_sombra')::boolean, true, 'mas esta em modo sombra');
  perform assert_eq(r->>'decisao', 'conferir', 'entao vai para a fila');
  perform assert_eq((select payment_status from orders where id = o.id)::text,
                    'comprovante_recebido', 'pedido marcado como comprovante recebido');
  perform assert_eq((select shadow_decision from payment_receipts
                      where transaction_id = 'TX-001'), true,
                    'a decisao do sistema fica registrada para comparar');

  raise notice 'comprovante repetido e o unico caso em que o dinheiro NAO entrou';
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto,
    'storage_path','comprovantes/a2.jpg',
    'destinatario','pagamentos@lifebox.test',
    'transaction_id','TX-001', 'confianca', 0.98));
  perform assert_eq(r->>'motivo', 'duplicado', 'mesmo transaction_id');
  perform assert_eq((r->>'teria_confirmado')::boolean, false, 'nao confirmaria');

  raise notice 'valor diferente do que esta em aberto nao confirma';
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto - 500,
    'storage_path','comprovantes/b.jpg',
    'destinatario','pagamentos@lifebox.test', 'confianca', 0.99));
  perform assert_eq(r->>'motivo', 'valor_divergente', 'faltou dinheiro');
  perform assert_eq(position('em aberto' in (r->>'detalhe')) > 0, true,
                    'o motivo diz os dois valores');

  raise notice 'destinatario fora das chaves cadastradas nao confirma';
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto,
    'storage_path','comprovantes/c.jpg',
    'destinatario','pix-de-outra-pessoa@x.com', 'confianca', 0.99));
  perform assert_eq(r->>'motivo', 'destinatario_nao_reconhecido', 'chave desconhecida');

  raise notice 'confianca baixa da extracao nao confirma';
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto,
    'storage_path','comprovantes/d.jpg',
    'destinatario','pagamentos@lifebox.test', 'confianca', 0.42));
  perform assert_eq(r->>'motivo', 'baixa_confianca', 'leitura incerta');

  raise notice 'nome do pagador NAO bloqueia (§9.3.6): outra pessoa pode pagar';
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto,
    'storage_path','comprovantes/e.jpg',
    'destinatario','pagamentos@lifebox.test',
    'transaction_id','TX-002', 'confianca', 0.99,
    'extracted', jsonb_build_object('pagador','Marido da Cliente')));
  perform assert_eq((r->>'teria_confirmado')::boolean, true,
                    'pagador diferente nao e motivo de recusa');

  raise notice 'com o automatico LIGADO, o que passa em tudo confirma';
  update settings set value = 'true' where key = 'receipt_auto_confirm';
  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220001', 'valor_cents', v_aberto,
    'storage_path','comprovantes/f.jpg',
    'destinatario','pagamentos@lifebox.test',
    'transaction_id','TX-003', 'confianca', 0.99));
  perform assert_eq(r->>'decisao', 'confirmado', 'confirmou sozinho');
  perform assert_eq((select payment_status from orders where id = o.id)::text,
                    'confirmado', 'pedido confirmado');
  perform assert_eq((select confirmed_by_kind from orders where id = o.id)::text,
                    'auto', 'registrado como automatico, e reversivel (§9.3.8)');
  perform assert_eq((select paid_amount_cents from orders where id = o.id),
                    o.total_cents, 'valor pago = total');
  update settings set value = 'false' where key = 'receipt_auto_confirm';

  raise notice 'COMPROVANTE OK';
end $t$;

-- ------------------------------------ dois pedidos abertos: a equipe escolhe
do $dois$
declare
  v_plan uuid; v_s uuid; v_d uuid; v_w uuid; v_c uuid; r jsonb;
begin
  select id into v_plan from plans  where name_en = 'PLAN CMP';
  select id into v_s    from sizes  where code = 'S';
  select id into v_d    from dishes where name_en = 'Dish cmp';
  v_w := fn_semana_atual();

  insert into customers (first_name, phone_e164, status)
    values ('Pediu Duas', '+15552220002', 'ativo') returning id into v_c;

  -- desde 22/09/2026 isto e permitido, e e justamente o caso em que a
  -- automacao NAO pode escolher: creditar no pedido errado some com dinheiro
  perform fn_create_order(jsonb_build_object(
    'customer_id', v_c, 'week_id', v_w, 'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  perform fn_create_order(jsonb_build_object(
    'customer_id', v_c, 'week_id', v_w, 'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));

  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220002', 'valor_cents', 10000,
    'storage_path','comprovantes/g.jpg', 'confianca', 0.99));
  perform assert_eq(r->>'motivo', 'sem_pedido', 'nao escolhe entre dois');
  perform assert_eq((r->>'pedidos_abertos')::int, 2, 'diz quantos ha');
  perform assert_eq(r->>'decisao', 'conferir', 'vai para a fila da equipe');
  -- e nenhum dos dois foi tocado
  perform assert_eq((select count(*)::int from orders
                      where customer_id = v_c and payment_status <> 'aguardando_pagamento'),
                    0, 'nenhum pedido mexido');
  -- mas o comprovante fica guardado: e ele que a equipe vai abrir
  perform assert_eq((select count(*)::int from payment_receipts
                      where storage_path = 'comprovantes/g.jpg'), 1,
                    'comprovante guardado mesmo sem pedido');

  raise notice 'com order_id explicito, a automacao credita no pedido certo';
  r := fn_registrar_comprovante(jsonb_build_object(
    'order_id', (select id from orders where customer_id = v_c order by code limit 1),
    'valor_cents', 10000, 'storage_path','comprovantes/h.jpg', 'confianca', 0.99));
  perform assert_eq(r->>'motivo', 'valor_divergente', 'confere o valor do pedido escolhido');

  raise notice 'DOIS PEDIDOS OK';
end $dois$;

-- ------------------------------------- o numero e do PEDIDO, nao do cadastro
do $tel$
declare
  v_plan uuid; v_s uuid; v_d uuid; v_w uuid; v_c uuid; v_o uuid; r jsonb;
begin
  select id into v_plan from plans  where name_en = 'PLAN CMP';
  select id into v_s    from sizes  where code = 'S';
  select id into v_d    from dishes where name_en = 'Dish cmp';
  v_w := fn_semana_atual();

  insert into customers (first_name, phone_e164, status)
    values ('Trocou Numero', '+15552220003', 'ativo') returning id into v_c;
  r := fn_create_order(jsonb_build_object(
    'customer_id', v_c, 'week_id', v_w, 'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  v_o := (r->>'order_id')::uuid;

  perform assert_eq((select phone_e164 from orders where id = v_o), '+15552220003',
                    'o pedido nasce com o numero usado nele');

  raise notice 'e a consulta do n8n e uma so: numero + status';
  perform assert_eq((select count(*)::int from orders
                      where phone_e164 = '+15552220003'
                        and payment_status = 'aguardando_pagamento'), 1,
                    'acha o pedido a receber sem join');

  raise notice 'o cliente troca de numero e o pedido NAO muda (§9.3)';
  -- e o caso que derruba procurar por customers: o comprovante chega pelo
  -- numero antigo, que e para onde a confirmacao foi
  update customers set phone_e164 = '+15552220099' where id = v_c;

  perform assert_eq((select phone_e164 from orders where id = v_o), '+15552220003',
                    'pedido continua com o numero de quando foi feito');
  perform assert_eq(jsonb_array_length(
                      fn_pedidos_do_telefone('+15552220003')->'pedidos'), 1,
                    'o numero antigo ainda acha o pedido');
  perform assert_eq(jsonb_array_length(
                      fn_pedidos_do_telefone('+15552220099')->'pedidos'), 0,
                    'o numero novo nao tem pedido nenhum ainda');

  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','+15552220003', 'valor_cents',
    (select total_cents from orders where id = v_o),
    'storage_path','comprovantes/i.jpg',
    'destinatario','pagamentos@lifebox.test',
    'transaction_id','TX-004', 'confianca', 0.99));
  perform assert_eq(r->>'order_id', v_o::text, 'o comprovante caiu no pedido certo');

  raise notice 'TELEFONE DO PEDIDO OK';
end $tel$;

-- ------------------------------ o numero como a Evolution entrega (sem o `+`)
do $evo$
declare
  v_plan uuid; v_s uuid; v_d uuid; v_w uuid; v_c uuid; v_o uuid; r jsonb;
begin
  raise notice 'normalizar aceita o JID do WhatsApp e o que a equipe digita';
  perform assert_eq(fn_telefone_normalizar('17744148199'),   '+17744148199', 'JID da Evolution');
  perform assert_eq(fn_telefone_normalizar('+1 (774) 414-8199'), '+17744148199', 'como a tela mostra');
  perform assert_eq(fn_telefone_normalizar('774-414-8199'),  '+17744148199', 'como a planilha tem');
  perform assert_eq(fn_telefone_normalizar('5569992695898'), '+5569992695898', 'Brasil com o nono');
  perform assert_eq(fn_telefone_normalizar('556992695898'),  '+556992695898',  'Brasil sem o nono');

  raise notice 'e RECUSA o ambiguo em vez de chutar codigo de pais';
  perform assert_eq(fn_telefone_normalizar('55123456789'), null, '11 digitos sem comecar em 1');
  perform assert_eq(fn_telefone_normalizar('4148199'),     null, 'curto demais');
  -- 10 digitos sao dos EUA mesmo comecando em 55: 551 e New Jersey
  perform assert_eq(fn_telefone_normalizar('5514148199'),  '+15514148199', '10 digitos = EUA');

  raise notice 'a chave casa o Brasil com e sem o nono digito';
  perform assert_eq(fn_telefone_chave('+5569992695898'),
                    fn_telefone_chave('+556992695898'), 'a mesma pessoa');
  perform assert_eq(fn_telefone_chave('+17744148199') = fn_telefone_chave('+17744148100'),
                    false, 'numeros diferentes continuam diferentes');

  select id into v_plan from plans  where name_en = 'PLAN CMP';
  select id into v_s    from sizes  where code = 'S';
  select id into v_d    from dishes where name_en = 'Dish cmp';
  v_w := fn_semana_atual();

  raise notice 'o pedido feito com +55 e achado pelo que a Evolution manda';
  -- Numero de teste do Brasil NAO se inventa parecido com um de verdade: os
  -- +1555… daqui usam o prefixo ficticio dos EUA, e o Brasil nao tem faixa
  -- reservada. Este teste ja estourou `customers_phone_e164_key` contra o
  -- banco da cliente, onde o numero escolhido era de um cliente real.
  insert into customers (first_name, phone_e164, status)
    values ('Veio do Brasil', '+5569988880001', 'ativo') returning id into v_c;
  r := fn_create_order(jsonb_build_object(
    'customer_id', v_c, 'week_id', v_w, 'kind','plan','plan_id',v_plan,'size_id',v_s,
    'items', jsonb_build_array(jsonb_build_object('type','dish','dish_id',v_d,'qty',5))));
  v_o := (r->>'order_id')::uuid;

  -- o WhatsApp devolve o JID ora com o nono digito, ora sem — e as duas formas
  -- tem de achar o mesmo pedido, senao a automacao falha uma semana sim e
  -- outra nao, sem dar erro nenhum
  perform assert_eq((fn_pedidos_do_telefone('5569988880001')->'pedidos'->0->>'order_id'),
                    v_o::text, 'JID com o nono digito');
  perform assert_eq((fn_pedidos_do_telefone('556988880001')->'pedidos'->0->>'order_id'),
                    v_o::text, 'JID SEM o nono digito acha o mesmo pedido');

  r := fn_registrar_comprovante(jsonb_build_object(
    'phone','556988880001', 'valor_cents',
    (select total_cents from orders where id = v_o),
    'storage_path','comprovantes/j.jpg',
    'destinatario','pagamentos@lifebox.test',
    'transaction_id','TX-005', 'confianca', 0.99));
  perform assert_eq(r->>'order_id', v_o::text, 'e o comprovante cai nele');

  raise notice 'EVOLUTION OK';
end $evo$;

-- ----------------------------------------------------- comprovante e dinheiro
do $seg$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin
    perform fn_registrar_comprovante(jsonb_build_object(
      'phone','+15552220001','valor_cents',1,'storage_path','x'));
    reset role;
    raise exception 'FALHOU: anon registrou comprovante';
  exception when insufficient_privilege then
    reset role;
    raise notice '  ok  anon nao registra comprovante';
  end;
  reset role;
  raise notice 'ACESSO OK';
end $seg$;

rollback;
