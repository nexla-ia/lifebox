-- LifeBox · clientes, semanas do cliente, pedidos, pagamento, bags
-- Ref: LIFEBOX_PROJECT.md §6, §7 · telas 4a-4d, 9a-9c, 11a-11f

-- ------------------------------------------------------------ clientes §6.1
-- 1 cliente -> N pedidos, sem cadastro duplicado. O telefone e a chave de
-- cruzamento com o WhatsApp (§2).
create table customers (
  id                     uuid primary key default gen_random_uuid(),
  first_name             text not null,
  last_name              text,
  phone_e164             text not null unique,
  email                  text,
  street_address         text,
  city                   text,
  state                  text default 'MA',
  zip_code               text,
  route_id               uuid references routes(id),      -- editavel (§6.1)
  source_id              uuid references sources(id),
  lead_type              lead_type        not null default 'new',
  status                 customer_status  not null default 'lead',
  fulfillment_preference fulfillment_type not null default 'delivery',
  uses_thermal_bag       boolean not null default true,   -- §6.7
  -- plano padrao que puxa na renovacao (tela 4b). Ausente no §7.
  default_plan_id        uuid references plans(id),
  default_size_id        uuid references sizes(id),
  delivery_notes         text,
  office_notes           text,
  kitchen_notes          text,                            -- §6.8
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger touch before update on customers
  for each row execute function tg_touch_updated_at();
create index on customers (route_id);
create index on customers (status);

-- §6.2 Old Lead nunca volta a ser New Lead
create or replace function tg_lead_type_never_back() returns trigger
language plpgsql as $fn$
begin
  if old.lead_type = 'old' and new.lead_type = 'new' then
    new.lead_type := 'old';
  end if;
  return new;
end $fn$;

create trigger lead_type_one_way before update on customers
  for each row execute function tg_lead_type_never_back();

-- §9.1 lead criado pelo webhook da Evolution quando um numero desconhecido fala
create table leads (
  id                uuid primary key default gen_random_uuid(),
  phone_e164        text not null,
  customer_id       uuid references customers(id) on delete set null,
  name              text,
  source_id         uuid references sources(id),
  lead_type         lead_type not null default 'new',
  first_contact_at  timestamptz not null default now(),
  converted_at      timestamptz,
  converted_week_id uuid references weeks(id)
);
create index on leads (phone_e164);

-- §6.3 UMA linha por cliente por semana. E aqui que Skip, Follow-up e
-- Cancelamento existem sem pedido.
create table customer_weeks (
  customer_id      uuid not null references customers(id) on delete cascade,
  week_id          uuid not null references weeks(id) on delete cascade,
  order_status     order_status not null default 'aguardando_selecao',
  order_id         uuid,
  follow_up_week_n int,
  updated_at       timestamptz not null default now(),
  primary key (customer_id, week_id)
);
create trigger touch before update on customer_weeks
  for each row execute function tg_touch_updated_at();
create index on customer_weeks (week_id, order_status);

-- -------------------------------------------------------------- pedidos §7
create sequence order_seq;

create table orders (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,            -- 'W39-0142'
  customer_id            uuid not null references customers(id),
  week_id                uuid not null references weeks(id),
  kind                   order_kind not null,
  plan_id                uuid references plans(id),
  size_id                uuid references sizes(id),
  -- planilha real W37: breakfast tem tamanho proprio (Boston, pedido 10:
  -- 6 MEALS LARGE + 5 MEALS SMALL + 5 BREAKFAST SMALL). Ausente no §7.
  breakfast_size_id      uuid references sizes(id),
  fulfillment            fulfillment_type not null default 'delivery',
  post_cutoff            boolean not null default false,  -- §4
  is_partnership         boolean not null default false,  -- §6.4
  -- valores calculados no servidor (§2). Nunca vem do front.
  taxable_cents          int not null default 0,
  tax_cents              int not null default 0,
  delivery_cents         int not null default 0,
  non_taxable_cents      int not null default 0,
  total_cents            int not null default 0,
  commercial_value_cents int not null default 0,          -- parceria
  paid_amount_cents      int not null default 0,
  payment_method_id      uuid references payment_methods(id),
  payment_status         payment_status not null default 'aguardando_pagamento',
  confirmed_by_kind      confirmed_by_kind,
  confirmed_by           uuid references profiles(id),
  confirmed_at           timestamptz,
  bag_qty                int not null default 1,          -- §6.7 padrao 1
  assembled_at           timestamptz,
  deliver_with_order_id  uuid references orders(id),      -- §6.6
  source                 order_source not null default 'manual',
  created_by             uuid references profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- um pedido por cliente por semana (link publico checa isso, tela 6m)
  unique (customer_id, week_id)
);
create trigger touch before update on orders
  for each row execute function tg_touch_updated_at();
create index on orders (week_id, payment_status);
create index on orders (customer_id, created_at desc);

alter table customer_weeks
  add constraint customer_weeks_order_fk
  foreign key (order_id) references orders(id) on delete set null;

-- §2 snapshot: alterar o catalogo nao muda pedido ja lancado
create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  item_type         item_type not null,
  dish_id           uuid references dishes(id),
  addon_id          uuid references addons(id),
  variant_id        uuid references addon_variants(id),
  size_id           uuid references sizes(id),
  qty               int not null check (qty > 0),
  unit_price_cents  int not null default 0,
  name_snapshot     text not null,
  category_snapshot dish_category,     -- para a folha da cozinha
  taxable           boolean not null default true,
  charges_delivery  boolean not null default false,
  position          int not null default 0
);
create index on order_items (order_id);
-- v_production conta SO item_type='dish': sao os pratos que a cozinha faz.
-- 'extra' e linha de preco (o prato em si ja esta numa linha 'dish').
create index on order_items (item_type, dish_id);

-- ------------------------------------------------------- comprovantes §9.3
create table payment_receipts (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references orders(id) on delete cascade,
  customer_id     uuid references customers(id),
  storage_path    text not null,
  sha256          text,
  phash           text,
  extracted       jsonb,                -- plataforma, valor, data, destinatario
  transaction_id  text unique,
  check_result    receipt_check_result,
  check_detail    text,
  status          receipt_status not null default 'pendente',
  -- §9.3 modo sombra: o sistema decide, a equipe confirma
  shadow_decision boolean,
  received_at     timestamptz not null default now()
);
create unique index on payment_receipts (sha256) where sha256 is not null;
create index on payment_receipts (order_id);

-- ----------------------------------------------------------- bags §6.7
create table bag_movements (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  week_id     uuid references weeks(id),
  order_id    uuid references orders(id) on delete set null,
  type        bag_movement_type not null,
  qty         int not null check (qty <> 0),
  note        text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index on bag_movements (customer_id, created_at);

create table bag_collections (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  week_id     uuid not null references weeks(id) on delete cascade,
  qty         int not null check (qty > 0),
  status      bag_collection_status not null default 'planned',
  created_at  timestamptz not null default now(),
  unique (customer_id, week_id)
);
