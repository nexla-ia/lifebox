-- LifeBox · catálogo: pratos, planos, preços, adicionais
-- Ref: LIFEBOX_PROJECT.md §5, §7 · telas 5a–5f, 6n, 11e
-- Princípio §1: nada hardcoded. Tudo abaixo é cadastrado pela LifeBox.

-- ------------------------------------------------------------- pratos §5.5
-- tags são tabela, não enum: a tela 5e tem "＋ Nova tag"
create table dish_tags (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,
  label_pt text not null,
  label_en text not null,
  icon     text,
  position int not null default 0,
  active   boolean not null default true
);

create table allergens (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,
  label_pt text not null,
  label_en text not null,
  icon     text,
  active   boolean not null default true
);

create table dishes (
  id          uuid primary key default gen_random_uuid(),
  name_pt     text not null,                -- a cozinha lê PT (§5.5)
  name_en     text not null,                -- o link público lê EN
  desc_pt     text,
  desc_en     text,
  category    dish_category not null,
  protein_tag text,
  photos      text[] not null default '{}', -- caminhos no Storage
  -- nutrição por porção · tela 5e, cartões 5f/6b. Ausente no §7, exigida pelo protótipo.
  calories    int,
  protein_g   int,
  carbs_g     int,
  fat_g       int,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger touch before update on dishes
  for each row execute function tg_touch_updated_at();

create table dish_tag_links (
  dish_id uuid not null references dishes(id) on delete cascade,
  tag_id  uuid not null references dish_tags(id) on delete cascade,
  primary key (dish_id, tag_id)
);

create table dish_allergens (
  dish_id     uuid not null references dishes(id) on delete cascade,
  allergen_id uuid not null references allergens(id) on delete cascade,
  primary key (dish_id, allergen_id)
);

-- disponibilidade por tamanho (§5.5)
create table dish_sizes (
  dish_id uuid not null references dishes(id) on delete cascade,
  size_id uuid not null references sizes(id),
  primary key (dish_id, size_id)
);

-- ciclo de 4 menus, rotação automática (§4)
create table menu_dishes (
  menu_id uuid not null references menus(id) on delete cascade,
  dish_id uuid not null references dishes(id) on delete cascade,
  active  boolean not null default true,
  primary key (menu_id, dish_id)
);

-- ------------------------------------------------------------- planos §5.1
create table plans (
  id              uuid primary key default gen_random_uuid(),
  name_pt         text not null,
  name_en         text not null,
  meals_qty       int not null check (meals_qty >= 0),
  breakfasts_qty  int not null default 0 check (breakfasts_qty >= 0),
  position        int not null default 0,
  active          boolean not null default true
);

-- preço BASE pré-tax, já com o service de $1.75 embutido (§5.1).
-- O preço final ao cliente é derivado: base + tax + delivery.
create table plan_prices (
  plan_id          uuid not null references plans(id) on delete cascade,
  size_id          uuid not null references sizes(id),
  base_price_cents int  not null check (base_price_cents >= 0),
  primary key (plan_id, size_id)
);

-- §5.2 extras. Desvio do §7: lá a chave é `tier_key` ('S5','L10'…).
-- Aqui é (plano, tamanho) — mesma granularidade, sem string mágica, e permite
-- à LifeBox dar preços diferentes a "5 Meals" e "5 Meals + 5 Breakfasts".
create type extra_kind as enum ('meal','breakfast');

create table extra_prices (
  plan_id          uuid not null references plans(id) on delete cascade,
  size_id          uuid not null references sizes(id),
  item_kind        extra_kind not null,
  unit_price_cents int  not null check (unit_price_cents >= 0),
  primary key (plan_id, size_id, item_kind)
);

-- §5.3 Pedido Personalizado: unitário por tamanho
create table custom_unit_prices (
  size_id          uuid primary key references sizes(id),
  unit_price_cents int not null check (unit_price_cents >= 0)
);

-- --------------------------------------------------------- adicionais §5.4
create table addons (
  id                uuid primary key default gen_random_uuid(),
  name_pt           text not null,
  name_en           text not null,
  desc_pt           text,
  desc_en           text,
  photo             text,
  category          addon_category not null default 'other',
  price_cents       int not null check (price_cents >= 0),
  charges_tax       boolean not null default false,
  charges_delivery  boolean not null default false,
  requires_plan     boolean not null default false,
  -- §5.4 ⚠️ resolvido pela planilha real da W37 (South Shore, pedido 2):
  -- o Super Detox inclui refeições ESCOLHIDAS do menu da semana, e elas entram
  -- na folha da cozinha. 0 = adicional puro de estoque.
  includes_meals_qty int not null default 0 check (includes_meals_qty >= 0),
  position          int not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger touch before update on addons
  for each row execute function tg_touch_updated_at();

-- variações: Detox Juice → Green #1, Red… · Detox Soup → Beterraba… (tela 11e)
create table addon_variants (
  id      uuid primary key default gen_random_uuid(),
  addon_id uuid not null references addons(id) on delete cascade,
  name_pt text not null,
  name_en text not null,
  position int not null default 0,
  active  boolean not null default true
);

-- ------------------------------------------------- formas de pagamento §6.5
create table payment_methods (
  id              uuid primary key default gen_random_uuid(),
  name_pt         text not null,
  name_en         text not null,
  instructions_pt text,
  instructions_en text,
  pay_link        text,
  -- chaves reconhecidas na checagem do comprovante (§9.3)
  recipient_keys  text[] not null default '{}',
  position        int not null default 0,
  active          boolean not null default true
);

-- ------------------------------------------------------- mensagens §9, 6p
create table message_templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null,
  language   lang not null,
  body       text not null,
  updated_at timestamptz not null default now(),
  unique (key, language)
);
create trigger touch before update on message_templates
  for each row execute function tg_touch_updated_at();
