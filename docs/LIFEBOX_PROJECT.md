# LifeBox — Especificação do Sistema (guia para desenvolvimento)

> Documento-mestre do projeto. Toda decisão de código deve respeitar as regras daqui.
> Quando algo não estiver definido aqui, **pergunte antes de inventar regra de negócio**.
> Itens marcados com ⚠️ são decisões ainda abertas e devem ser implementados como **configuráveis**.

---

## 1. Contexto

**Cliente:** LifeBox Foods — operação de meal prep (marmitas semanais) na região de Boston, Massachusetts (EUA). Equipe brasileira, clientes majoritariamente brasileiros morando nos EUA.
**Fornecedor:** Nexla Automação e IA.
**Objetivo:** substituir as planilhas (pedidos, produção, montagem, overview) e o site atual por um sistema integrado com link público de pedido, automação de WhatsApp e dashboard analítico.

**Escopo desta fase**
- **Módulo 1:** pedidos, clientes, catálogo e menus, produção da cozinha, montagem de domingo, bags, link público, configurações e automações de WhatsApp. Entrega em meados de outubro de 2026.
- **Módulo 2:** Overview (dashboard analítico). Entrega no fim de outubro de 2026.

**Fora do escopo agora:** CRM com funil (Módulo 3), atendimento com IA (Módulo 4), rota inteligente, migração completa das planilhas e treinamento. O modelo de dados **não pode impedir** o CRM futuro, ou seja: 1 cliente → N pedidos/oportunidades ao longo das semanas, sem cadastro duplicado.

**Princípio de produto:** o sistema **não fixa produtos**. A LifeBox cadastra planos, pratos, adicionais, preços, formas de pagamento, ZIPs, origens e templates. Nada disso vai hardcoded.

**Princípio de UX:** telas operacionais e analíticas, com cards, gráficos e listas de ação. Tabela estilo planilha é uma **visão secundária** ("Modo planilha"), sempre com **exportação** (CSV/XLSX).

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Banco / Auth / Storage | Supabase (Postgres, RLS, Storage para fotos e comprovantes) |
| Lógica sensível | Postgres functions (RPC) e/ou Supabase Edge Functions |
| Front-end | React + TypeScript (Vite), Tailwind, Recharts para gráficos |
| Automações | n8n |
| WhatsApp | Evolution API |
| Extração de comprovante | Modelo de visão (Anthropic/OpenAI) chamado pelo n8n |

**Convenções**
- Banco em `snake_case`, com identificadores de código em inglês.
- Textos da interface em português (admin), com i18n. O link público é **EN | PT**, com EN como padrão.
- Valores monetários em **centavos (integer)** no banco. Arredondamento half-up para 2 casas no cálculo de tax.
- Datas em `timestamptz`, com fuso operacional **America/New_York**. Toda regra de cutoff e de semana usa esse fuso.
- Semana ISO, começando na segunda. Código da semana: `2026-W38`, exibido como `W38`.
- Telefones normalizados em **E.164** (`+15085550164`). Esse é o identificador de cruzamento com o WhatsApp.
- **Preço sempre calculado no servidor.** O front nunca envia total, só itens.
- Todo pedido guarda um **snapshot** de nomes e preços dos itens. Alterar o catálogo não muda pedidos já lançados.

---

## 3. Perfis e permissões

| Perfil | Acessa |
|---|---|
| **Administrador** | Tudo: Overview, Semana, Clientes, Catálogo (edita preços), Produção, Montagem, Bags e Configurações |
| **Operação** | Semana, Pedidos, Clientes, Catálogo (**somente leitura de preços**), Produção, Montagem e Bags. **Sem** Overview e **sem** Configurações |
| **Cozinha** | Só Produção (folha da bancada com Kitchen Notes). **Sem** valores, contatos ou endereços |

Implemente com RLS no Supabase (`role` no perfil do usuário) e também no front (menu e rotas). A Cozinha lê de uma **view** que não expõe valores nem dados pessoais. Um acesso a URL não permitida mostra o estado "acesso negado" com um botão para a tela inicial do perfil.

**Tela inicial por perfil:** Administrador → Overview · Operação → Semana · Cozinha → Produção.

**Usuários:** convite por e-mail (expira em 7 dias), definição de senha no primeiro acesso, troca de perfil e desativação.

---

## 4. Ciclo semanal (regras de tempo)

- **Segunda:** abertura da semana e do link público.
- **Quinta, 18:00 (NY):** cutoff oficial. O link público **fecha automaticamente, sem exceção**.
- **Sexta:** pré-preparo. A equipe ainda pode **lançar pedidos manualmente**, que recebem o selo `post_cutoff = true` e geram um aviso de **recontagem** na Produção.
- **Sexta (fim do dia):** rotina de pagamento. Pedidos sem pagamento aparecem para a equipe decidir entre cancelar ou dar prazo (ver 6.4).
- **Sábado:** produção principal.
- **Domingo:** montagem e entregas, entre 12:30 e 20:00.
- Horário administrativo: segunda a sexta, das 9h às 18h (NY).

O dia e a hora do cutoff ficam em `settings` e são editáveis.

**Ciclo de menus:** 4 menus em rotação automática (Menu 1 → 2 → 3 → 4 → 1...). Cada semana aponta para um menu. O menu da semana em execução fica **travado para edição** quando existem pedidos. Desativar um prato usado exige confirmação e lista os pedidos afetados.

---

## 5. Catálogo e preços

### 5.1 Planos (Fresh Plans)

A equipe cadastra cada plano com: nome, quantidade de refeições, quantidade de breakfasts e preço base por tamanho.

**Tamanhos:** Small e Large ativos. ⚠️ Medium aparece em pedidos antigos (planilha W37), mas não consta nas regras oficiais. Modele `sizes` como uma tabela com a flag `active`, e deixe o Medium **cadastrado e inativo**.

**Preço base** (pré-tax, já inclui o service de $1.75). Valores iniciais para seed:

| Plano | Small | Large |
|---|---|---|
| 5 Meals | $56.00 | $65.05 |
| 10 Meals | $107.45 | $125.85 |
| 5 Meals + 5 Breakfasts | $77.50 | $96.35 |
| 10 Meals + 5 Breakfasts | $128.60 | $157.15 |

**Total exibido** = base + 7% de tax + $10 de delivery. Exemplos: Small 5 = $69.92; Small 10+5 = $147.60; Large 10+5 = $178.15.

### 5.2 Extras (refeição ou breakfast além do limite do plano)

O preço unitário depende da **faixa do plano**. O extra é taxável.

| Extra | Small 5 | Small 10 | Large 5 | Large 10 |
|---|---|---|---|---|
| Refeição | $11.20 | $10.75 | $13.01 | $12.59 |

| Extra | Small 5+5 | Small 10+5 | Large |
|---|---|---|---|
| Breakfast | $4.30 | $4.23 | $6.26 |

### 5.3 Pedido Personalizado

O Personalizado é para pedidos fora da estrutura dos planos (ex.: 3 Small + 3 Large, 8 meals, 16 meals). Esse tipo de pedido é **comum** na operação real.

- O preço é **unitário por tamanho**, cadastrado no catálogo.
- As chaves `charges_tax` e `charges_delivery` do Personalizado também ficam no catálogo.

### 5.4 Produtos adicionais

Sucos, Detox, sopas e outros. A equipe cadastra cada adicional com:

- nome e descrição em EN e PT, foto, preço e categoria (`juice`, `detox`, `other`)
- `charges_tax` (bool) e `charges_delivery` (bool)
- `requires_plan` (bool): só pode ser vendido junto com um Fresh Plan
- **variações** (ex.: Detox Juice → Green #1, Green #3, Red, Orange; Detox Soup → Beterraba, Abóbora, Espinafre)

**Regras:**
- Adicionais **vêm de estoque** e **não entram na folha da cozinha**.
- Detox pode ser vendido sozinho. A exceção é o pacote **5 Juices ($29.90)**, que tem `requires_plan = true`.

Seed inicial, tudo sem tax e sem delivery:

| Adicional | Composição | Preço |
|---|---|---|
| 5 Juices | requires_plan | $29.90 |
| 1-Day Detox | 6 sucos | $59.90 |
| Health Booster | 10 sucos | $89.90 |
| 3-Day Detox | 18 sucos | $126.24 |
| 5-Day Detox | 20 sucos + 10 sopas | $179.74 |
| Super Detox | 20 sucos + 5 sopas + 5 refeições | $201.74 |

⚠️ As 5 refeições do Super Detox não estão definidas. Até a LifeBox definir, trate o Super Detox como um item de estoque.

### 5.5 Pratos

Cada prato tem: nome e descrição em PT e EN, fotos, categoria (Clássico, Brasileiro, Breakfast), tag de proteína, tags de dieta (GF, LF), disponibilidade por tamanho e o(s) menu(s) do ciclo em que roda.

A cozinha lê o nome em **PT**. O link público mostra o nome no idioma escolhido, com fallback para o outro idioma.

### 5.6 Cálculo do pedido (servidor)

```
taxable      = plano_base + extras + personalizado(se charges_tax) + adicionais(charges_tax)
tax          = round_half_up(taxable * 0.07, 2)
delivery     = 10.00 se fulfillment = delivery E algum item cobra delivery   ⚠️ pick-up: ver 6.6
non_taxable  = adicionais sem tax
total        = taxable + tax + delivery + non_taxable
```

**Caso de teste obrigatório:** plano 10+5 Small ($128.60) + 1 extra Small 10 ($10.75) + 5 Juices ($29.90).

| Linha | Valor |
|---|---|
| Taxable | $139.35 |
| Tax | $9.75 |
| Delivery | $10.00 |
| 5 Juices | $29.90 |
| **Total** | **$189.00** |

Taxa (7%), valor do delivery ($10) e service ($1.75, só informativo) ficam em `settings`.

---

## 6. Regras de negócio

### 6.1 Cliente × pedido

- **Dados fixos do cliente:** first_name, last_name, phone, email (opcional), street_address, city, state, zip_code, source, lead_type, delivery_notes, office_notes, kitchen_notes, route_id, fulfillment_preference (`delivery`/`pickup`), uses_thermal_bag.
- **Dados do pedido (mudam por semana):** plano, tamanho, itens, valor, forma de pagamento, status, semana. O histórico de pedidos é preservado.
- **Rota:** o ZIP sugere a rota, mas ela é **editável por cliente**. As rotas não são estritamente geográficas (ex.: Ashland está em South Shore).
- **ZIP atendido:** mostra ✅ Delivery Available ou ❌ Outside Delivery Area. Fora da área, o link público bloqueia o pedido.

### 6.2 Lead Type (fixo na pessoa)

- **🧲 New Lead:** primeiro contato. É criado **automaticamente quando um número desconhecido manda a primeira mensagem** no WhatsApp (webhook da Evolution).
- **♻️ Old Lead:** a pessoa já existe na base. **Nunca volta a ser New Lead.**

### 6.3 Order Status (por pessoa, por semana)

| Status | Significado |
|---|---|
| ✅ `novo_pedido` | Primeira compra, **ou** retorno depois de um Cancelamento. Um Old Lead pode ser Novo Pedido |
| 🔁 `renovacao` | Teve pedido na semana anterior, **ou** estava em Skip |
| 🟠 `follow_up` | Lead que entrou em contato e não fechou. Continua aparecendo nas semanas seguintes (padrão: 3 semanas, configurável) |
| 🕒 `skip` | Pausou a semana e pretende voltar |
| ❌ `cancelamento` | Encerrou, não pagou até sexta ou não respondeu às tentativas de contato |
| 🎁 `parceria` | Pedido gratuito (parceiro ou influenciador): valor pago $0, valor comercial = preço normal |
| `aguardando_selecao` | Estado operacional antes do cutoff: cliente ativo que ainda não pediu |

- A classificação entre `novo_pedido` e `renovacao` é **automática** na criação do pedido, com as regras acima.
- O sistema **nunca renova pedido automaticamente**.
- **Combinações válidas:** Old Lead + Novo Pedido; New Lead + Follow-up. O Lead Type não muda, e o Order Status muda a cada semana.

### 6.4 Conversão, pagamento e faturamento

- **Conversão:** conta na semana em que o **pedido foi feito**, mesmo antes do pagamento.
- **Faturamento:** só conta pedidos **pagos** (status de pagamento `confirmado`), na semana do pedido. Mostre **Faturado** e **A receber** separados.
- **Status de pagamento:** `aguardando_pagamento` → `comprovante_recebido` → `confirmado` (também `parcial`, `recusado`).
- **Rotina de sexta:** pedidos sem pagamento entram em "Precisa de ação" como "Sem pagamento, cancelar da semana?", com os botões **Cancelar** e **Dar mais prazo**. Ao cancelar, o status da semana vira `cancelamento` e o cliente entra em `follow_up` na semana seguinte.
- **Total Pedidos = Novo Pedido + Renovação.** Skip, Cancelamento e Parceria **não** entram.
- **Parceria:** registra `paid_amount = 0` e `commercial_value` = preço normal. No Overview aparece em uma métrica separada.

### 6.5 Formas de pagamento

A LifeBox cadastra as formas de pagamento com: nome (EN/PT), texto de instruções (EN/PT, ex.: chave Zelle ou link) e ativo/inativo. O link público mostra só as ativas. A forma de pagamento fica registrada **por pedido**.

### 6.6 Entrega e Pick-up

- `fulfillment`: `delivery` ou `pickup`. A Montagem tem uma aba própria de Pick-up.
- ⚠️ Não está definido se o Pick-up cobra delivery. Coloque em `settings` (`pickup_charges_delivery`, padrão `false`).
- Casos reais para suportar: um endereço recebendo o pedido de outra pessoa ("entregar junto com o pedido de X"), e cliente que **não usa bag térmica** (só bag de papel).

### 6.7 Bags térmicas

Cada entrega leva bag(s) térmica(s) retornável(is) e pack de gelo.

- **Envio:** ao marcar o pedido como **Montado** no domingo, o sistema registra o envio de N bags para aquele cliente. ⚠️ O padrão de N ainda não está definido: use 1, editável por pedido. Nos dados reais, N varia entre 1 e 2.
- **Devolução:** registrada na ficha do cliente (quantidade), com histórico de movimentações.
- **Saldo:** o saldo por cliente e o total na rua são calculados a partir das movimentações. O estoque total fica em `settings`.
- **Lista "Coletar"**, na ordem de prioridade:
  1. clientes em Skip ou Cancelamento com bag em posse
  2. clientes com bag há mais de 3 semanas
  3. demais saldos
- A coleta pode ser adicionada à rota de domingo (coluna **Coletar** na montagem).
- Clientes com `uses_thermal_bag = false` ficam fora do controle.

### 6.8 Kitchen Notes

Campo do cliente (restrições e alergias). Aparece no topo da folha da cozinha, e um ícone marca os pratos afetados.

---

## 7. Modelo de dados (base, ajustar na implementação)

```
profiles(id → auth.users, full_name, role[admin|operacao|cozinha], status, invited_at)

settings(key, value jsonb)
  -- tax_rate, delivery_fee, service_fee, cutoff_weekday, cutoff_time, timezone,
  -- follow_up_weeks, pickup_charges_delivery, bag_stock_total, weekly_goal, monthly_goal

routes(id, name)                      -- Boston, Marlborough, South Shore
zip_codes(zip, city, route_id, active)
sources(id, name, kind[channel|influencer], active)
sizes(id, code[S|M|L], name, active)

weeks(id, iso_code '2026-W38', starts_on, ends_on, menu_id, cutoff_at, status[open|closed])
goals(id, period_type[week|month], period_key, amount_cents)

menus(id, name, cycle_position 1..4)
dishes(id, name_pt, name_en, desc_pt, desc_en, category[classico|brasileiro|breakfast],
       protein_tag, diet_tags[], photos[], active)
dish_sizes(dish_id, size_id)                 -- disponibilidade por tamanho
menu_dishes(menu_id, dish_id, active)

plans(id, name_pt, name_en, meals_qty, breakfasts_qty, active)
plan_prices(plan_id, size_id, base_price_cents)
extra_prices(tier_key, item_type[meal|breakfast], size_id, unit_price_cents)
custom_unit_prices(size_id, unit_price_cents)   -- + flags em settings
addons(id, name_pt, name_en, desc_pt, desc_en, photo, category[juice|detox|other],
       price_cents, charges_tax, charges_delivery, requires_plan, active)
addon_variants(id, addon_id, name_pt, name_en, active)

customers(id, first_name, last_name, phone_e164 UNIQUE, email, street_address, city, state,
          zip_code, route_id, source_id, lead_type[new|old], fulfillment_preference,
          uses_thermal_bag, delivery_notes, office_notes, kitchen_notes, created_at)
leads(id, phone_e164, customer_id NULL, name, source_id, lead_type, first_contact_at,
      converted_at NULL, converted_week_id NULL)
customer_weeks(customer_id, week_id, order_status, order_id NULL, follow_up_week_n NULL)
  -- UMA linha por cliente por semana: é aqui que Skip, Follow-up e Cancelamento existem sem pedido

orders(id, code 'W39-0142', customer_id, week_id, kind[plan|custom|addons_only],
       plan_id NULL, size_id NULL, fulfillment, post_cutoff, is_partnership,
       taxable_cents, tax_cents, delivery_cents, non_taxable_cents, total_cents,
       commercial_value_cents, paid_amount_cents, payment_method_id,
       payment_status, confirmed_by[auto|user_id], confirmed_at,
       bag_qty, assembled_at, deliver_with_order_id NULL, source[public_link|manual],
       created_by, created_at)
order_items(id, order_id, item_type[dish|extra|addon|custom],
            dish_id/addon_id/variant_id, size_id, qty, unit_price_cents,
            name_snapshot, taxable, charges_delivery)

payment_methods(id, name_pt, name_en, instructions_pt, instructions_en, active)
payment_receipts(id, order_id, storage_path, sha256, phash, extracted jsonb,
                 transaction_id UNIQUE NULL, check_result[ok|valor_divergente|
                 destinatario_nao_reconhecido|duplicado|baixa_confianca|sem_pedido],
                 status[pendente|aprovado|recusado], received_at)

bag_movements(id, customer_id, week_id, order_id NULL, type[sent|returned|adjustment],
              qty, created_by, created_at)
bag_collections(id, customer_id, week_id, qty, status[planned|collected|failed])

message_templates(id, key 'order_confirmation', lang[en|pt], body)
audit_log(id, entity, entity_id, action, before jsonb, after jsonb, user_id, at)
```

**Views e funções:**
- `v_week_summary`: contagens por status, faturado, a receber, total de pedidos.
- `v_production`: agregado por prato e tamanho, **sem adicionais**, com as Kitchen Notes. É a view lida pela Cozinha.
- `v_bag_balance`: saldo por cliente, semanas em posse e status da semana.
- `v_overview_*`: views semanal, mensal e anual para o Módulo 2.
- `fn_price_order(items)`, `fn_classify_order(customer, week)`, `fn_create_order(...)`, `fn_close_week_payments(week)`.

---

## 8. Telas (aprovadas)

| # | Tela | Perfis | Destaques |
|---|---|---|---|
| — | Login | Todos | Login, esqueci a senha, primeiro acesso por convite |
| 9.1 | **Semana** | Admin, Operação | **Painel:** cards (faturado/meta, pedidos, seleção, pagamentos, fora do total), "Precisa de ação agora" e kanban por pagamento. **Modo planilha** com exportação. Filtros por status, rota e pagamento, e busca |
| 9.2 | Ficha do pedido | Admin, Operação | Lançar e editar, cálculo, trava de quantidade pelo plano, extras, adicionais à parte, comprovante e confirmação |
| 9.3 | Produção da cozinha | Todos (Cozinha só esta) | Visão agregada (prato × tamanho) e matriz (prato × cliente), recontagem pós-cutoff, Kitchen Notes, impressão |
| 9.4 | Clientes | Admin, Operação | Lista, ficha, histórico por semana, Lead Type, bags e notas |
| 9.5 | Catálogo e menus | Admin (edita), Operação (lê) | Planos, preços, extras, personalizado, adicionais com variações, pratos e ciclo de 4 menus |
| 9.6 | Overview | Admin | Dashboard com KPIs, gráficos e comparação entre períodos. Aba "Tabela" com exportação |
| 9.7 | Link público | Público | Fluxo de pedido, EN/PT |
| 9.8 | Configurações | Admin | ZIPs, origens, cutoff, formas de pagamento, mensagens (EN/PT), usuários e metas |
| 9.9 | Montagem de domingo | Admin, Operação | Abas por rota e Pick-up: montado, bags, gelo, coletar, notas. Impressão e exportação no formato da planilha atual |
| 9.10 | Bags | Admin, Operação | Estoque, bags na rua e a coletar, lista priorizada, evolução semanal |

Toda tela precisa ter os estados **vazio**, **carregando** (skeleton no formato do conteúdo), **erro** ("Tentar novamente") e **acesso negado**.

### 9.7 Link público (fluxo)

1. **Identificação:** o WhatsApp vem primeiro (normalizado em E.164).
   - Número já cadastrado: "Olá, {nome}", com o endereço salvo e a opção de alterar.
   - Número novo: nome e endereço, com validação de ZIP.
   - Também nesta etapa: Delivery Notes e forma de pagamento.
2. **Plano e tamanho:** planos do catálogo, **Personalizado** ou **"Só Detox / adicionais"**.
3. **Pratos:** cardápio do menu da semana. O contador de progresso trava no limite do plano, e passar do limite só como extra, com aviso do valor. **Os pratos não mostram preço**, exceto no Personalizado.
4. **Adicionais:** com preço. O 5 Juices só aparece se houver plano.
5. **Revisão:** resumo e valores (plano → extras → tax → delivery → adicionais sem tax → total).
6. **Confirmação:** tela de sucesso com o código do pedido. O WhatsApp envia a mensagem com as instruções de pagamento e pede o print do comprovante.

**Estados:** link fechado (após o cutoff, mostrando a data de abertura da próxima semana), número que já tem pedido na semana (ver ou alterar antes do cutoff) e ZIP fora da área.

**Segurança:** o pedido é criado por Edge Function ou RPC, com rate limit por IP e por telefone. O preço é recalculado no servidor.

---

## 9. Automações (n8n + Evolution)

1. **Criação de lead:** o webhook de mensagem recebida normaliza o número. Se o número não existe em `customers` nem em `leads`, cria um lead `new` com `first_contact_at`.
2. **Confirmação de pedido:** ao criar o pedido, o sistema envia o template (EN/PT, conforme o idioma do link). Variáveis: `{nome} {numero_pedido} {semana} {plano} {tamanho} {lista_pratos} {adicionais} {total} {forma_pagamento} {status_pagamento} {instrucoes_pagamento} {data_entrega}`.
3. **Comprovante:** quando chega uma imagem ou PDF de um número com pedido aberto:
   1. Salva no Storage e calcula o sha256 e o phash.
   2. Extrai os dados com o modelo de visão: plataforma, valor, data, destinatário, pagador, ID da transação e confiança.
   3. A **confirmação é automática só se todas as checagens passarem:**
      - valor **exatamente** igual ao total em aberto
      - destinatário reconhecido (chaves cadastradas)
      - data igual ou posterior à criação do pedido
      - `transaction_id` e hash inéditos
      - confiança acima do limite
      - **apenas 1 pedido aberto** para o número
   4. Se todas passam, marca `confirmado` com `confirmed_by = auto`. Se alguma falha, marca `comprovante_recebido` e vai para a fila "Comprovantes para conferir", com o motivo registrado.
   5. O cliente recebe só "recebemos seu comprovante, estamos conferindo". O motivo da falha nunca é enviado a ele.
   6. **O nome do pagador não bloqueia a confirmação** (outra pessoa pode pagar pelo cliente).
   7. Casos de valor divergente permitem **Registrar parcial** e **Cobrar diferença** (mensagem pré-preenchida).
   8. Toda confirmação automática é **reversível** e fica auditada.
   9. ⚠️ Na primeira fase, rode em **modo sombra**: o sistema decide, mas a equipe confirma. Compare os resultados antes de ativar a confirmação automática.
4. **Rotina de sexta:** lista os pedidos sem pagamento na fila de ação (ver 6.4).
5. **Follow-up:** leads sem pedido continuam em `follow_up` pelo número de semanas configurado.

---

## 10. Overview (Módulo 2)

- **Filtros e visões:** Semana, Mês ou Ano, e **"Comparar com"** (período anterior, mesmo período do ano passado ou um período escolhido).
- **KPIs (com variação e sparkline):** faturado (vs meta), Total Pedidos, ticket médio (faturado ÷ pedidos pagos), New Leads, % Conversão Total, taxa de renovação (renovações ÷ clientes com pedido na semana anterior).
- **Gráficos:**
  - receita por semana, com a meta e a linha do ano anterior (a semana em andamento aparece dividida em realizado e projeção)
  - entrada e saída de clientes (Novo e Renovação acima do eixo, Skip e Cancelamento abaixo)
  - mix de planos e tamanhos (**sem adicionais**), mais um card de adicionais vendidos
  - funil (New Leads → Follow-up → Convertidos, geral e só Ads)
  - ranking de origens, incluindo influenciadores
  - tendência de conversão
  - parcerias (quantidade e valor comercial)
  - top pratos
  - follow-up pendente
- **Fórmulas:**
  - % Conversão ADS = Convertidos ADS ÷ Total Leads ADS × 100
  - % Conversão Total = Convertidos TOTAL ÷ New Leads × 100
  - Ads Revenue = faturamento dos novos clientes vindos de Ads
- **Metas:** semanal e mensal, editáveis pelo Administrador.
- **Interação:** clicar em qualquer número, barra ou fatia abre a lista de clientes ou pedidos que o compõe.
- **Consistência:** a visão mensal **precisa bater** com a soma das semanas.

---

## 11. Ordem de implementação sugerida

1. **Fundação:** projeto Supabase, migrations, enums, seeds (settings, rotas, ZIPs, tamanhos, planos, preços, extras, adicionais, origens), auth e perfis, RLS, layout base e rotas protegidas.
2. **Catálogo e menus:** pratos (fotos no Storage), planos, preços, adicionais com variações e o ciclo de 4 menus.
3. **Clientes:** CRUD, validação de ZIP e rota, notas, Lead Type e histórico.
4. **Pedidos:** `fn_price_order` (com testes, incluindo o caso de $189.00), `fn_classify_order` e a ficha do pedido.
5. **Semana:** painel, kanban, "Precisa de ação", modo planilha e exportação.
6. **Link público:** fluxo completo, EN/PT e fechamento no cutoff.
7. **Produção:** views, recontagem e impressão.
8. **Montagem e Bags:** folhas por rota, movimentações e lista de coleta.
9. **n8n:** lead automático, confirmação, comprovante (modo sombra) e rotina de sexta.
10. **Configurações e usuários.**
11. **Módulo 2:** views do Overview e o dashboard.

**Testes obrigatórios (unitários no cálculo e na classificação):**
- Plano, extras, personalizado, adicionais com e sem tax, Pick-up e Parceria.
- Novo × Renovação: semana anterior com pedido, com Skip, com Cancelamento, e primeira compra.
- Fechamento no cutoff e pedido pós-cutoff.
- Saldo de bags.

---

## 12. Dados de teste

A planilha real `W37 2026.xlsx` (abas Boston, Marlborough, South Shore e Pick-up) serve de massa de teste. Ela contém casos que o sistema precisa suportar:

- pedidos de 4, 6, 8, 12 e 16 meals
- tamanhos misturados no mesmo pedido
- Medium
- kits Detox com sopas e sucos por sabor
- Pick-up
- notas de entrega e coleta de bags
- dois pedidos no mesmo endereço

Escreva um script de importação (CSV/XLSX → tabelas) só para ambiente de teste. **Não versione dados pessoais reais no repositório.**

---

## 13. Decisões em aberto (implementar como configurável)

| Tema | Padrão até a confirmação |
|---|---|
| Medium | Cadastrado e **inativo** |
| Pick-up cobra delivery? | `false` |
| Quantidade de bags por pedido | 1, editável por pedido |
| Semanas de follow-up | 3 |
| Pedido cancelado por falta de pagamento conta como convertido? | Sim (conversão = semana do pedido) |
| Refeições do Super Detox | Tratado como item de estoque |
| Confirmação automática de comprovante | Modo sombra ligado |
