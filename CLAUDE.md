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

O e2e roda **serial** (`workers: 1`, `fullyParallel: false`): há um banco só,
compartilhado por todos os specs. Um teste cria ZIP enquanto outro exige a
lista vazia — em paralelo isso falha sem existir bug.

`e2e/env.ts` carrega `.env.local` antes dos specs: sem isso, esquecer de
exportar `E2E_EMAIL` faz os testes **pularem em silêncio** e a saída fica
verde. Pelo mesmo motivo, `scripts/db.sh test` aborta com exit 1 se não
conseguir conectar — runner que reporta "0 falhas" sem ter rodado é o pior
resultado possível.

Os testes que gravam no Supabase limpam em **hook `afterAll`**, nunca em
`try/finally`: quando um teste estoura o timeout o Playwright aborta o corpo e
o `finally` não chega a rodar, deixando lixo no banco da cliente. Marcam tudo
com sufixo `zzt-<timestamp>` para nunca colidir com o catálogo real.

`supabase/tests/00_local_stub.sql` só existe porque o Postgres puro não tem o
schema `auth` nem os roles `authenticated`/`anon`. **Não é migration.**

## Usuários

O perfil operacional vive em `public.profiles`; quem cria a linha é o gatilho
`on_auth_user_created`, lendo `full_name` e `role` do metadata do Auth. Assim
não existe usuário autenticado sem perfil.

Primeiro Administrador (não tem quem o convide):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1   -v email=... -v senha=... -v nome='...' -v papel=admin   -f supabase/tools/criar_usuario.sql
```

**Armadilha, já paga:** `auth.users` tem quatro colunas sem DEFAULT —
`confirmation_token`, `recovery_token`, `email_change_token_new` e
`email_change`. O GoTrue as lê como string não-nula, então deixá-las NULL faz
o login devolver `500 Database error querying schema`. O erro não menciona
senha nem credencial, e acontece **antes** de conferir a senha — parece
problema de schema. O `criar_usuario.sql` preenche com `''` e tem um guard que
falha se sobrar algum nulo.

Sinal para diagnosticar: se login com e-mail **inexistente** devolve 400
`invalid_credentials` mas o e-mail real devolve 500, o schema está são e o
problema é a linha daquele usuário.

## Pedidos

`fn_create_order` faz preço, código, itens com snapshot e a linha de
`customer_weeks` **numa transação só** — meio caminho deixaria pedido sem valor
ou semana sem status. `rpc_precificar` dá a prévia sem gravar.

O front **não sabe somar preço**, e é de propósito: manda itens, recebe total
(§2). `src/lib/precos.ts` existe só para a tela de Catálogo mostrar o preço
final derivado enquanto alguém digita a base.

Semana: `fn_ensure_week` é idempotente e o cutoff sai no fuso operacional, não
no do servidor. Cuidado — `fn_passou_cutoff` é STABLE e enxerga o snapshot do
início do statement, então criar a semana e consultá-la na mesma linha não
funciona.

Ao apagar dado de teste, **apague pedidos antes do cliente**:
`orders.customer_id` não tem `ON DELETE CASCADE` e o DELETE falha em silêncio.

## Produção

A Cozinha alcança só `v_production` e `v_kitchen_notes` (§3). A **matriz**
mostra nome de cliente, então é consulta direta a `order_items` e nem aparece
para ela — se aparecesse, a RLS devolveria vazio.

A Produção **não cria semana**: `fetchSemanaCorrente` só lê. Criar é escrita, e
a Cozinha não escreve em `weeks`. A migration 1100 abriu leitura de `weeks`,
`menus` e `sizes` a qualquer autenticado — a folha precisa do código da semana
e das colunas S/L, e nada disso é sensível.

Ordem das colunas de tamanho vem de `sizes.position`, **nunca** de sort
alfabético: "L" < "S" inverteria Large e Small.

## Painel da Semana

`v_week_summary` já aplica o §6.4: Total Pedidos = Novo + Renovação; Skip,
Cancelamento e Parceria ficam fora; faturado conta só `confirmado`.

**Embed de `sizes` precisa nomear a FK**: `orders` tem duas chaves para `sizes`
(`size_id` e `breakfast_size_id`), e sem `sizes!orders_size_id_fkey(...)` o
PostgREST recusa com "more than one relationship was found".

Valores sem rótulo visível (Faturado, A receber) levam `aria-label` — melhora
leitor de tela e evita que o teste tenha que caçar o rótulo pela estrutura do
DOM.

## Telefone

`src/lib/telefone.ts` normaliza para **E.164** — é o identificador que cruza
cliente e conversa do WhatsApp (§2). Errar aqui não dá erro visível: cria
cliente duplicado e faz a automação do n8n não achar o pedido de quem mandou o
comprovante.

`normalizarTelefone` **recusa** o que é ambíguo (7 ou 9 dígitos, 11 sem começar
em 1) em vez de chutar código de país. A planilha real tem `(781) 518-6457`,
`774-239-8922` e `7819291049` na mesma coluna — todos viram `+17815186457`.

Ao apagar cliente pela API REST nos testes, **encode o telefone**: o `+` vira
espaço numa query string e o filtro não casa.

## ZIP codes

Duas coisas que NÃO podem se misturar:

- **"que cidade é esse ZIP"** — conveniência. `src/lib/zip.ts` consulta
  api.zippopotam.us (pública, sem chave). Pode falhar, pode estar fora do ar:
  toda função devolve `null` em vez de lançar, e o formulário segue com a
  pessoa digitando à mão.
- **"nós entregamos nesse ZIP"** — regra de negócio (§6.1). Quem responde é
  SEMPRE a tabela `zip_codes`. Nenhuma API externa decide se um pedido fecha.

O caminho principal de cadastro é **por cidade**: a equipe sabe as cidades que
atende, não os CEPs. `zipsDaCidade('Framingham')` traz os 5 ZIPs de uma vez —
as 27 cidades da W37 rendem ~84 ZIPs. A rota segue editável por ZIP, porque não
é estritamente geográfica (Ashland é South Shore).

## Menus do ciclo

4 menus em rotação automática (§4). A trava do menu em execução **só vale
quando a semana já tem pedido** — menu sem pedido nenhum segue editável, senão
a equipe ficaria presa à toa. Sem semanas cadastradas, nada trava.

Tirar um prato que está em pedido abre confirmação listando os afetados
(`pedidosUsandoPrato`, tela 5d). Tirar do menu **não apaga o prato**: ele volta
noutro ciclo.

Fotos vão para o bucket `dish-photos` (migration 0800): leitura pública, porque
o link público é sem sessão; escrita só para a equipe. O upload acontece
**depois** de o prato ter id, para o caminho no Storage nunca colidir.

## Preço na tela de Catálogo

O campo canônico é o preço **base**, pré-tax; o final é derivado e mostrado ao
lado ao vivo (`src/lib/precos.ts`). Motivo: o final muda com o fulfillment
(pick-up não cobra entrega) e com a taxa, então se a base fosse derivada do
final, mexer nos 7% alteraria o preço de todos os planos em silêncio.

`baseFromFinalCents` já faz o caminho inverso — se a LifeBox preferir digitar o
preço de anúncio, só esta tela muda. Ver `docs/DECISOES-ABERTAS.md` item 4.

`precos.ts` é **espelho de exibição** do `fn_price_order`, não a fonte: o total
de um pedido sempre vem do servidor (§2). `src/lib/precos.test.ts` prende os
dois juntos nos casos do §5.1 e §5.6.

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
