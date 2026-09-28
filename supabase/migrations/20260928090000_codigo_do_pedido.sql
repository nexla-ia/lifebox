-- LifeBox · o código do pedido não pode andar para trás
-- Ref: LIFEBOX_PROJECT.md §6.2
--
-- `fn_proximo_codigo` era `count(*) + 1` sobre os pedidos da semana. Duas
-- formas de quebrar, e as duas acontecem:
--
--   · APAGAR um pedido devolve a contagem. A semana tinha W40-0001 e W40-0002,
--     apagaram o primeiro, sobrou um — e o próximo pedido nasce W40-0002 de
--     novo, batendo na unique de `orders.code`. O pedido simplesmente não
--     entra, e a mensagem que chega na tela é
--     `duplicate key value violates unique constraint "orders_code_key"`,
--     que não diz nada a quem está atendendo.
--
--   · DOIS pedidos ao mesmo tempo contam a mesma coisa antes de qualquer um
--     gravar, pegam o mesmo número, e um dos dois morre. Na segunda de manhã,
--     com o link aberto no WhatsApp, isso não é hipótese.
--
-- Foi encontrado pelo e2e depois de um pedido real ficar na semana e um de
-- teste ser apagado — exatamente o cenário da primeira forma.
--
-- A correção é um contador por semana, que só sobe. Não é derivado dos pedidos,
-- então apagar não o move; e o `on conflict do update` trava a linha, então
-- dois pedidos simultâneos pegam números diferentes.

create table if not exists week_order_counters (
  week_id  uuid primary key references weeks(id) on delete cascade,
  last_seq int  not null default 0
);

comment on table week_order_counters is
  'Último número de pedido usado na semana. Só sobe: apagar pedido não '
  'devolve o número, senão o próximo colide com um código que já existiu.';

-- Ninguém alcança esta tabela: quem escreve é a função abaixo, que é
-- `security definer`. RLS ligada sem policy nenhuma é o que o §9.7 cobra de
-- toda tabela de `public` — tabela nova sem RLS nasce aberta para o anon.
alter table week_order_counters enable row level security;

/** Próximo código da semana ('W40-0003'), reservando o número.
 *
 *  VOLÁTIL e `security definer` de propósito: ela ESCREVE. Assim `fn_create_order`
 *  não muda — continua chamando e recebendo o texto — e quem lança pedido não
 *  precisa de permissão nenhuma na tabela do contador. */
create or replace function fn_proximo_codigo(p_week uuid) returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare v_seq int; v_iso text;
begin
  select substring(iso_code from 6) into v_iso from weeks where id = p_week;
  if v_iso is null then
    raise exception 'Semana não encontrada.' using errcode = 'LB409';
  end if;

  -- A primeira vez numa semana parte do MAIOR número já usado, não da
  -- contagem: a semana pode já ter pedidos de antes desta migration, e algum
  -- deles pode ter sido apagado.
  insert into week_order_counters (week_id, last_seq)
  values (p_week,
          coalesce((select max(right(o.code, 4)::int) from orders o
                     where o.week_id = p_week and o.code ~ '-[0-9]{4}$'), 0) + 1)
      on conflict (week_id) do update
         set last_seq = week_order_counters.last_seq + 1
   returning last_seq into v_seq;

  return v_iso || '-' || lpad(v_seq::text, 4, '0');
end $fn$;

revoke execute on function fn_proximo_codigo(uuid) from public, anon;
grant  execute on function fn_proximo_codigo(uuid) to authenticated, service_role;
