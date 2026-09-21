# LifeBox

Sistema de pedidos e gestão para a LifeBox Foods (meal prep semanal, região de
Boston). Fornecedor: Nexla Automação e IA.

## Fontes de verdade, nesta ordem

1. **`docs/LIFEBOX_PROJECT.md`** — documento-mestre. Toda regra de negócio sai
   daqui. Se algo não estiver definido lá, **pergunte antes de inventar regra**.
2. **`docs/telas/LifeBox Telas.dc.html`** — protótipo **aprovado pela cliente**.
   É a referência de UI: layout, cores, estados, fluxo. Abra no navegador.
   Os cartões são referenciados pelo id (`6i`, `10a`, `5c`…) nos comentários do código.
3. **`docs/DECISOES-ABERTAS.md`** — o que ainda depende de resposta da LifeBox,
   com o padrão adotado enquanto isso.
4. `docs/referencia/` — briefing, contrato, brand (Redesign 2023), teardown.

Onde o `.md` e o protótipo discordam, o `.md` vence e o conflito entra em
`DECISOES-ABERTAS.md`.

## Princípio que não se quebra

**Nada de catálogo é hardcoded.** Prato, plano, preço, adicional, ZIP, origem,
forma de pagamento, taxa — tudo é cadastro da LifeBox, editável em tela. Nenhum
valor monetário pode aparecer em código TypeScript ou SQL de aplicação.

Corolários:
- **Preço é sempre calculado no servidor** (`fn_price_order`). O front manda
  itens e recebe o total; nunca envia valor.
- Todo pedido guarda **snapshot** de nome e preço em `order_items`. Alterar o
  catálogo não muda pedido já lançado.
- Os testes usam os valores do seed de exemplo. Se a LifeBox mudar um preço, o
  teste muda junto — o que se testa é a **fórmula**, não o número.

## Convenções

- Banco em `snake_case`, identificadores em inglês; interface em português.
- Dinheiro em **centavos (integer)**. `money()` em `src/lib/supabase.ts` formata.
- Datas `timestamptz`; fuso operacional **America/New_York** (vem de `settings`).
- Semana ISO começando na segunda: `2026-W38`, exibida como `W38`.
- Telefone em **E.164** (`+15085550164`) — é a chave de cruzamento com o WhatsApp.
- Arredondamento do tax: half-up para 2 casas (`round()` do Postgres sobre centavos).

## Estrutura

```
docs/            documentação e protótipo (ver acima)
supabase/
  migrations/    schema, RLS, funções — rodam em ordem de nome
  seed.sql       seed BASE, vai para produção (settings, rotas, tamanhos, tags)
  seeds/         seed de EXEMPLO, só dev (catálogo, menu real da W37)
  tests/         testes SQL de preço, classificação e RLS
src/
  app/           rotas, screens.ts (mapa de telas), páginas
  lib/           supabase client, auth
  ui/            layout, estados (vazio/carregando/erro/acesso negado)
  styles/        tokens da marca extraídos do protótipo
scripts/db.sh    sobe cluster local, reseta, roda testes
.private/        dados reais de clientes — NUNCA versionar
```

## Banco de desenvolvimento

Não tem Docker nesta máquina, então `supabase start` não roda. `scripts/db.sh`
sobe um **cluster Postgres próprio** na porta 5440, isolado, auth trust.

```bash
npm run db:up       # sobe o cluster
npm run db:reset    # recria: stub + migrations + seed base + seed de exemplo
npm run db:test     # preço, classificação e RLS
npm run db:down
```

Para rodar contra o Supabase: `export DATABASE_URL=...` e use `db:reset` /
`db:test` (o stub do schema `auth` é pulado sozinho).

## Testes de navegador

`npm run e2e` (Playwright) sobe o build e checa no Chromium de verdade.

Os testes de `e2e/smoke.spec.ts` rodam **sem** as variáveis do Supabase de
propósito: existem porque o primeiro deploy na Vercel veio em branco — o client
lançava exceção no import e matava o bundle antes do React montar. Regra que
eles guardam: **nenhuma tela pode vir em branco** (§8, tela 9f). Falta de
configuração tem que renderizar `ConfigMissing`, não body vazio.

`vercel.json` faz o rewrite de SPA; sem ele, atualizar em `/semana` dá 404.

`supabase/tests/00_local_stub.sql` só existe porque o Postgres puro não tem o
schema `auth` nem os roles `authenticated`/`anon`. **Não é migration.**

## Permissões (§3)

Três perfis, e a RLS é quem manda — o guarda de rota no front é só cortesia.

| Perfil | Alcance |
|---|---|
| **Administrador** | tudo, e é o único que edita preço, metas e mensagens |
| **Operação** | Semana, Clientes, Catálogo (lê preço, edita prato e menu), Produção, Montagem, Bags |
| **Cozinha** | só Produção, pelas views `v_production` e `v_kitchen_notes` — sem valor, contato ou endereço |

`src/app/screens.ts` é a fonte única do menu e do guarda: uma tela não tem como
aparecer no menu de quem não pode abri-la.

Ao mexer em RLS, rode `npm run db:test` — `supabase/tests/rls_test.sql` prova
que a Cozinha não alcança pedido, cliente nem preço.

## Desvios conscientes do §7

Documentados em comentário na migration correspondente:

- `extra_prices` é chaveada por `(plano, tamanho, tipo)` em vez de `tier_key`.
- `orders.breakfast_size_id` — breakfast tem tamanho próprio (caso real na W37).
- `dishes` ganhou nutrição e alérgenos; tags viraram tabela (a tela 5e permite
  criar tag nova).
- `customers` ganhou `default_plan_id`/`default_size_id` e `status`.
- `addons.includes_meals_qty` — as refeições do Super Detox entram na produção.
- `order_items`: linha `dish` é o que a cozinha faz; `extra` é só linha de preço;
  linha de `addon` **com variante** é composição do kit e não cobra.
