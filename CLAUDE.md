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
- **Campo numérico filtra na digitação**, por `apenasDigitos`/`apenasDecimal`
  (`src/lib/numero.ts`). `inputMode="numeric"` só escolhe o teclado do celular:
  no computador a letra entra igual e só aparece o erro no "Salvar", quando a
  pessoa já esqueceu o que digitou. `type="number"` traz as setinhas, o scroll
  que muda o valor sem querer e vírgula dependente do idioma do navegador.
- **`§` é marcador de código, nunca de tela.** Serve para achar a regra no
  documento-mestre; a equipe da LifeBox não tem esse documento, e "(§5.4)" numa
  nota de rodapé só some com a frase que explica a regra. Em texto visível,
  escreva a regra; deixe o `§` no comentário ao lado.

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

**O banco do e2e é o da cliente, e ela já usa o sistema.** Três regras que
vieram de quebrar de verdade:

- **Limpe pelo que o teste CRIOU**, filtrando pela marca. `zips.spec.ts`
  recolhia todos os ZIPs visíveis na tela para apagar no fim e teria apagado os
  que a LifeBox cadastrou.
- **Meça diferença, nunca total absoluto.** A cliente lançou um pedido pelo
  link e três specs quebraram de uma vez — faturamento da semana, contagem da
  produção e "Total Pedidos" — sem haver bug nenhum. `lerOverviewSemana()` e
  `lerItensProducao()` dão a linha de base no `beforeAll`.
- **Estado que exige tabela vazia não se força.** Confira o estado que existe:
  esvaziar seria apagar dado real.

**Não rode a suíte logo depois de aplicar DDL no Supabase.** O PostgREST
recarrega o cache de schema quando a estrutura muda, e requisições nessa janela
falham com "could not find the function in the schema cache" — um teste
qualquer quebra e não reproduz depois. Aconteceu duas vezes, em specs
diferentes, sempre logo após um deploy. Espere alguns segundos; não adicione
retry, que mascararia flake de verdade.

Os testes que gravam no Supabase limpam em **hook `afterAll`**, nunca em
`try/finally`: quando um teste estoura o timeout o Playwright aborta o corpo e
o `finally` não chega a rodar, deixando lixo no banco da cliente. Marcam tudo
com sufixo `zzt-<timestamp>` para nunca colidir com o catálogo real.

`supabase/tests/00_local_stub.sql` só existe porque o Postgres puro não tem o
schema `auth` nem os roles `authenticated`/`anon`. **Não é migration.**

**Aba e filtro moram na URL, não no estado.** Recarregar no meio de um
cadastro voltava para a primeira aba, e não havia como mandar "abre a aba de
ZIPs" para alguém. E o redirecionamento de login guarda `pathname` + `search` +
`hash`: só com o pathname, recarregar qualquer tela com parâmetro perdia o
parâmetro e parecia que o sistema ignorou o clique.

**`useQuery` não apaga a tela ao recarregar.** `loading` é só a primeira carga
e a troca de parâmetro; `reload()` depois de gravar devolve `refreshing` e
mantém o conteúdo. Trocar tudo por esqueleto some com o formulário, perde o
cursor e apaga a confirmação que acabou de aparecer — e quem guarda estado em
`useEffect([valorSalvo])` ainda vê o efeito zerar o próprio aviso. Aconteceu
duas vezes, em Mensagens e na meta do Overview: **efeito de formulário depende
do REGISTRO aberto, não do valor gravado.**

**Armadilha, já paga:** `getByRole('button', { name })` casa o nome por
**substring**, não por igualdade. Em par de rótulo que só ganha prefixo —
`Marcar X como montado` / `Desmarcar X como montado` — esperar o botão "voltar
para Marcar" passa na hora, com o estado ainda inalterado: o `Marcar…` está
inteiro dentro do `Desmarcar…`. O teste segue, navega antes de a RPC terminar,
e o erro aparece lá adiante como saldo que não fecha. Em toggle, use
`exact: true` (helper `botao()` em `e2e/montagem.spec.ts`).

## Usuários

O perfil operacional vive em `public.profiles`; quem cria a linha é o gatilho
`on_auth_user_created`, lendo `full_name` e `role` do metadata do Auth. Assim
não existe usuário autenticado sem perfil.

Primeiro Administrador (não tem quem o convide):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1   -v email=... -v senha=... -v nome='...' -v papel=admin   -f supabase/tools/criar_usuario.sql
```

**Convite é LINK, não e-mail** (`fn_convidar_usuario`): mandar e-mail exigiria
SMTP no projeto, e a equipe se fala por WhatsApp. O Administrador copia o link
e entrega. O que o §3 pede continua de pé — a pessoa define a própria senha,
vale 7 dias, serve uma vez. O acesso fica fechado até lá porque
`email_confirmed_at` é nulo e o GoTrue recusa o login; aceitar confirma o
e-mail, e o gatilho `on_auth_user_confirmed` é quem vira o perfil para `ativo`.

Quem nunca lançou nada sai por `fn_remover_usuario` — existe para o convite
mandado ao e-mail errado, que senão ocupa o endereço para sempre. Quem tem
histórico **não sai**: desativa, senão o pedido fica sem autor.

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

**O mesmo cliente pode ter mais de um pedido na semana** (reunião de
22/09/2026). Isso derrubou a trava do §6.1 e, junto com ela, um jeito de contar:
`v_week_summary` somava dinheiro atravessando `customer_weeks.order_id`, que
aponta para um pedido só — o segundo sumiria do faturamento sem dar erro. Agora
o dinheiro vem de `orders` direto.

`customer_weeks` continua com **uma linha por pessoa por semana**: é o status
dela (Novo, Renovação, Skip), não do pedido. Daí a consequência que a tela tem
de dizer: **Total Pedidos conta PEDIDOS, Novo e Renovação contam PESSOAS.**
Quando divergem, a tela mostra "de N clientes" em vez de deixar parecer erro de
conta. Desvio consciente do §6.4, em DECISOES-ABERTAS item 16.

A trava de verdade era `unique (customer_id, week_id)` em `orders` — a função
só levantava a mensagem bonita depois. Regra que existe em dois lugares sai dos
dois.

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

## Overview (§10)

**Semana é a unidade.** Mês e ano são conjuntos de semanas, e a semana entra no
mês da **entrega** (o domingo, `ends_on`). É o que faz o §10 fechar — "a visão
mensal precisa bater com a soma das semanas" — e o que o protótipo mostra
(setembro/2026 = W36 a W39). Por dia corrido, a semana virada de mês cairia nos
dois e nenhum fecharia. `overview_test.sql` prende isso.

Tudo é derivado dos pedidos. O único número digitado na tela é a **meta**,
porque é o único que ninguém consegue derivar.

Ticket médio segue o `.md`: **faturado ÷ pedidos pagos**. O protótipo (8f) usa
total ÷ pedidos e dá outro número — os dois saem de `fn_overview` com nomes
diferentes, e o card mostra a divisão embaixo. Ver DECISOES-ABERTAS item 9.

O bloco de leads fica zerado até o n8n alimentar `leads` (§9.1). A tela diz
isso: `conversao` vem **NULL**, não 0 — sem denominador não há percentual, e
"0%" se leria como desempenho ruim em vez de dado que não existe.

## Configurações (§9.8)

É aqui que o princípio do projeto se paga: ZIP, origem, cutoff, forma de
pagamento e mensagem são cadastro da LifeBox, editáveis em tela.

**Cutoff vai por `fn_salvar_cutoff`, não por update na tabela.** `weeks.cutoff_at`
é gravado na criação da semana, então mudar só `settings` não mexeria na semana
em andamento — a equipe salvaria quarta 16h e o link continuaria fechando quinta
18h, sem erro. A função realinha as semanas que ainda não terminaram e deixa as
fechadas intactas.

**RLS barra UPDATE devolvendo zero linhas, sem erro.** Toda ação de tela que
depende de papel precisa de guard explícito no servidor, senão a Operação
"salva" e nada muda. `fn_salvar_cutoff` levanta `LB403`.

`recipient_keys` da forma de pagamento é a lista contra a qual a conferência do
comprovante checa o destinatário (§9.3): chave faltando manda o comprovante
para a fila manual.

Template de mensagem **não faz reload depois de salvar**: `useQuery.reload`
volta a `loading` e a aba inteira vira skeleton — num formulário, o texto some,
o cursor se perde e a confirmação nem aparece.

## Link público (§9.7)

A única rota sem login: `/pedido`, fora do `AppLayout` e sem guarda. Quem chega
é o role `anon`, que passa apenas pelas funções `fn_link_*` da migration 1400 —
uma porta só, e é nela que se audita o que sai. Dado novo na tela nasce lá,
não numa consulta nova do front.

Nos dois ambientes o anon é barrado de formas diferentes e as duas valem: no
cluster local não há GRANT e vem `42501`; no Supabase o grant existe e quem
barra é a RLS, devolvendo **vazio**. `link_test.sql` cobra o resultado — não
sai dado — e exige RLS ligada em **toda** tabela de `public`: tabela nova sem
RLS no Supabase nasce aberta para o anon.

O endereço do link mora em **Configurações › Link público**, primeira aba: é
de lá que a equipe copia para mandar no WhatsApp. A mesma aba mostra o que
impede um pedido de fechar agora — sem ZIP, sem forma de pagamento ativa, sem
plano com preço ou sem prato no menu da semana, o link quebra de quatro jeitos
diferentes e todos em silêncio.

Tudo que a tela checa, o servidor checa de novo, porque a tela é do cliente:
cutoff (§4), ZIP atendido (§6.1), formato do telefone e pedido duplicado na
semana. Cada caso tem SQLSTATE próprio (`LB400`, `LB409`, `LB422`, `LB423`,
`LB429`) para a tela dizer o que fazer em vez de um erro genérico.

Rate limit: por **telefone** curto (6 consultas/10min, 3 pedidos/30min), por
**IP** folgado (30 e 12). Quem varre cadastro troca de número, então quem barra
é o IP — mas apertá-lo derruba cliente de verdade, que em rede de celular
divide IP com muita gente. Quando ainda assim barrar quem não deveria,
`fn_link_liberar_tentativas(chave)` solta um número e
`fn_link_limpar_tentativas()` solta tudo (depois de um disparo de campanha,
por exemplo). O e2e usa a segunda: uma rodada faz dezenas de identificações da
mesma máquina e estoura o teto por IP.

**O link é só de quem vai RECEBER ou RETIRAR, e as duas coisas seguem regras
diferentes.** Pick-up não cobra delivery (§6.6) e não passa pelo ZIP: exigir
área de entrega de quem se dispôs a buscar recusava pedido que a LifeBox
consegue atender. Em pick-up o endereço do cadastro também não é sobrescrito —
a pessoa pode retirar esta semana e receber na próxima.

**Tamanho antes do plano** (reunião de 22/09/2026): o preço de cada plano
depende do tamanho, então perguntar o plano primeiro era escolher no escuro.
Os planos só aparecem depois do tamanho, já com o preço daquela pessoa.

**Breakfast só para plano que tem breakfast**, e "Só Detox / adicionais" saiu
das opções: Detox virou adicional dentro de um plano.

**Grupo de botões não vai dentro de `<label>`** (`Grupo` em `link/ui.tsx`). O
label envolvendo botões cola o texto dela no nome acessível de CADA um —
"Como você quer receber? 🏠 Retirar…" — e aí dois botões diferentes casam com
o mesmo texto. Some no leitor de tela e quebra busca por nome.

`name_snapshot` é sempre português, porque é o que a cozinha lê (§5.5). Na
revisão do link o **rótulo** sai do catálogo no idioma da tela e só o **valor**
vem do servidor — senão aparece "Plano 10+5" no meio de uma tela em inglês.

**Armadilha, já paga:** `fn_semana_atual()` dentro do `WHERE` não roda quando
`weeks` está vazia. Função volátil só é avaliada por linha varrida; sem linha,
a semana nunca é criada. O link abriria em branco justamente na segunda de
manhã, no primeiro acesso da semana. Chame para uma variável antes.

## Aviso para a automação (§9.2)

Ao fechar pedido pelo link, `fn_link_criar_pedido` chama `fn_notificar_pedido`,
que faz `net.http_post` (pg_net) para a URL em
`settings.webhook_order_confirmation`. Vai o texto **já montado** pelo template
de Configurações mais as variáveis soltas: o n8n entrega, não reescreve.

**O disparo é do banco, não do navegador.** Fechar a aba logo depois de
confirmar perderia a mensagem, e um bloqueador ou rede ruim também — e do lado
do cliente qualquer um poderia mandar payload inventado para o webhook.

**Webhook nunca derruba pedido.** `pg_net` é assíncrono e `fn_notificar_pedido`
engole o próprio erro: URL vazia desliga o aviso, URL quebrada grava
`webhook_confirmacao_falhou` no `audit_log` e o pedido segue. Perder a mensagem
é ruim; perder o pedido porque o n8n caiu seria pior.

O e2e **desliga o webhook** no `beforeAll` e devolve no `afterAll`: sem isso,
cada rodada mandaria a automação tentar um WhatsApp para número de teste.

## Montagem e bags

Marcar **Montado** e registrar o envio da bag são a mesma operação
(`fn_marcar_montado`, §6.7): separar as duas faria o saldo mentir sem dar erro
nenhum — só aparece semanas depois, faltando bag na cozinha. A função é
idempotente: clicar de novo ou corrigir o número **ajusta** o movimento em vez
de empilhar outro.

Fora do controle de bag, com 0: quem não usa bag térmica e quem retira na
cozinha (pick-up).

Desmarcar é desfazer clique errado, não apagar história: com devolução já
registrada a função **recusa**, senão o saldo ficaria negativo — alguém teria
devolvido o que o sistema diz que nunca saiu. A mensagem é escrita para quem
está na folha, então a tela **tem** de mostrá-la; ação de tela que engole
`error` da RPC vira clique sem efeito e sem explicação.

Saldo e estoque são globais: `bag_stock_total` é `settings` e não tem dono.
Teste que mexe neles guarda o valor de antes e devolve no `afterAll`, e mede
**diferença**, nunca valor absoluto.

## Telefone

`src/lib/telefone.ts` normaliza para **E.164** — é o identificador que cruza
cliente e conversa do WhatsApp (§2). Errar aqui não dá erro visível: cria
cliente duplicado e faz a automação do n8n não achar o pedido de quem mandou o
comprovante.

Dois países, e só dois: **EUA** (`+1` + 10 dígitos) e **Brasil** (`+55` + DDD +
8 ou 9). O Brasil entrou porque quem chegou há pouco em Boston mantém o número
de lá no WhatsApp — recusá-lo fechava a porta para parte do público. Quem
valida no servidor é `fn_telefone_valido`; a entrega continua presa ao ZIP.

`normalizarTelefone` **recusa** o que é ambíguo (7 ou 9 dígitos, 11 sem começar
em 1) em vez de chutar código de país. A planilha real tem `(781) 518-6457`,
`774-239-8922` e `7819291049` na mesma coluna — todos viram `+17815186457`.
E **nunca se chuta `+55` em número curto**: 10 dígitos continuam sendo dos EUA,
mesmo começando em 55 (551 é código de área de New Jersey). O Brasil só é
reconhecido pelo tamanho, 12 ou 13 dígitos, que os EUA não têm.

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

**`is_admin()` e `is_staff()` devolvem `false`, nunca NULL.** `current_role_of()`
é nulo para quem não tem perfil ativo, e `NULL = 'admin'` é NULL — que o plpgsql
trata como falso em `if not is_admin() then raise`. O guard simplesmente não
disparava. Em policy isso nunca apareceu (`using (NULL)` já barra), mas em
função `security definer` o guard é a única barreira: sem ele, um chamador
anônimo criava Administrador. Reproduzido antes do conserto, coberto em
`usuarios_test.sql`.

**Função nova no Postgres nasce com EXECUTE para PUBLIC.** `grant ... to
authenticated` não fecha nada, só acrescenta. Toda função que escreve fora da
RLS precisa de `revoke execute ... from public` antes do grant.

**Trava de regra que a tela usa também tem de valer pela tabela.** A policy
`profiles_admin_all` deixa o Administrador editar qualquer linha de `profiles`
direto por PostgREST. Por isso "nunca ficar sem Administrador ativo" é
**gatilho** (`sobra_um_admin`), não checagem dentro de `fn_definir_papel`.

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
