-- LifeBox · enums
-- Ref: LIFEBOX_PROJECT.md §3, §6, §7

create type user_role            as enum ('admin','operacao','cozinha');
create type user_status          as enum ('ativo','convite_pendente','desativado');

create type week_status          as enum ('open','closed');
create type goal_period          as enum ('week','month');
create type lang                 as enum ('en','pt');

create type dish_category        as enum ('classico','brasileiro','breakfast');
create type addon_category       as enum ('juice','detox','other');
create type source_kind          as enum ('channel','influencer');

-- §6.2 fixo na pessoa, nunca volta para 'new'
create type lead_type            as enum ('new','old');
create type customer_status      as enum ('ativo','pausado','cancelado','lead');

-- §6.3 por pessoa, por semana
create type order_status         as enum (
  'novo_pedido','renovacao','follow_up','skip','cancelamento','parceria','aguardando_selecao'
);

create type order_kind           as enum ('plan','custom','addons_only');
create type fulfillment_type     as enum ('delivery','pickup');
create type order_source         as enum ('public_link','manual');
create type item_type            as enum ('dish','extra','addon');

-- §6.4
create type payment_status       as enum (
  'aguardando_pagamento','comprovante_recebido','confirmado','parcial','recusado'
);
create type confirmed_by_kind    as enum ('auto','user');

-- §9.3 checagens do comprovante
create type receipt_check_result as enum (
  'ok','valor_divergente','destinatario_nao_reconhecido','duplicado','baixa_confianca','sem_pedido'
);
create type receipt_status       as enum ('pendente','aprovado','recusado');

-- §6.7
create type bag_movement_type    as enum ('sent','returned','adjustment');
create type bag_collection_status as enum ('planned','collected','failed');
