-- LifeBox · núcleo: perfis, settings, geografia, semanas
-- Ref: LIFEBOX_PROJECT.md §2, §3, §4, §7

create extension if not exists pgcrypto;

-- updated_at automático
create or replace function tg_touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- perfis §3
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        user_role   not null,
  status      user_status not null default 'convite_pendente',
  invited_at  timestamptz,
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger touch before update on profiles
  for each row execute function tg_touch_updated_at();

-- papel do usuário corrente, sem recursão de RLS
create or replace function current_role_of() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'ativo'
$$;

create or replace function is_admin() returns boolean
language sql stable as $$ select current_role_of() = 'admin' $$;

-- Admin e Operação. Cozinha fica de fora de tudo que tem valor/contato (§3)
create or replace function is_staff() returns boolean
language sql stable as $$ select current_role_of() in ('admin','operacao') $$;

-- ------------------------------------------------------------- settings §7
-- tax_rate, delivery_fee_cents, service_fee_cents, cutoff_weekday, cutoff_time,
-- timezone, follow_up_weeks, pickup_charges_delivery, bag_stock_total,
-- bag_default_qty, delivery_window, pickup_window
create table settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id)
);
create trigger touch before update on settings
  for each row execute function tg_touch_updated_at();

create or replace function setting(p_key text) returns jsonb
language sql stable as $$ select value from settings where key = p_key $$;

-- ---------------------------------------------------------- geografia §6.1
create table routes (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  position int  not null default 0,
  active   boolean not null default true
);

-- a rota é editável por cliente; o ZIP apenas sugere (§6.1)
create table zip_codes (
  zip      text primary key,
  city     text not null,
  state    text not null default 'MA',
  route_id uuid not null references routes(id),
  active   boolean not null default true
);

create table sources (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  kind   source_kind not null default 'channel',
  active boolean not null default true
);

-- Small e Large ativos; Medium cadastrado e inativo (§5.1 ⚠️)
create table sizes (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique,
  name     text not null,
  position int not null default 0,
  active   boolean not null default true
);

-- ------------------------------------------------------------- semanas §4
create table menus (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  cycle_position int  not null unique check (cycle_position between 1 and 4)
);

create table weeks (
  id         uuid primary key default gen_random_uuid(),
  iso_code   text not null unique,              -- '2026-W38'
  starts_on  date not null,                     -- segunda
  ends_on    date not null,                     -- domingo
  menu_id    uuid references menus(id),
  cutoff_at  timestamptz not null,              -- quinta 18:00 America/New_York
  status     week_status not null default 'open',
  created_at timestamptz not null default now(),
  check (ends_on > starts_on)
);
create index on weeks (starts_on desc);

create table goals (
  id           uuid primary key default gen_random_uuid(),
  period_type  goal_period not null,
  period_key   text not null,                   -- '2026-W38' | '2026-09'
  amount_cents int  not null check (amount_cents >= 0),
  unique (period_type, period_key)
);

-- ------------------------------------------------------------- auditoria §7
create table audit_log (
  id        bigserial primary key,
  entity    text not null,
  entity_id uuid,
  action    text not null,
  before    jsonb,
  after     jsonb,
  user_id   uuid references profiles(id),
  at        timestamptz not null default now()
);
create index on audit_log (entity, entity_id, at desc);
