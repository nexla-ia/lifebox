# n8n · confirmação de pagamento pelo comprovante

Referência para montar o fluxo que recebe o comprovante no WhatsApp e atualiza
o pedido. Companheiro de [`n8n-confirma-pedido.md`](n8n-confirma-pedido.md):
aquele **manda** a confirmação do pedido, este **recebe** o pagamento.

Regra de §9.3 que guia tudo aqui: **confirmar pagamento que não entrou é o erro
caro deste sistema** — o pedido sai para produção, a bag vai para a rua e
ninguém cobra. Por isso as regras ficam no banco, não no fluxo do n8n.

---

## As três respostas curtas

**Onde fica o pedido:** tabela `orders`.

**Onde fica o telefone:** **não** está em `orders`. Ele mora em
`customers.phone_e164`, em E.164 (`+15085550164`, `+5569992695898`) — é a chave
que cruza cliente e conversa do WhatsApp (§2). O pedido chega no cliente por
`orders.customer_id`.

**Os status de pagamento** (`orders.payment_status`):

| status | quando |
|---|---|
| `aguardando_pagamento` | nasce assim |
| `comprovante_recebido` | chegou comprovante, a equipe ainda confere |
| `confirmado` | pagamento reconhecido — é o que entra no faturado |
| `parcial` | pagou menos que o total |
| `recusado` | comprovante não valeu |

Só `confirmado` conta como faturado no Painel da Semana e no Overview.

---

## Não faça UPDATE direto em `orders`

Tem duas razões, e as duas já custaram caro em outros sistemas:

1. **`payment_status` é uma consequência, não um campo.** Confirmar mexe também
   em `paid_amount_cents`, `confirmed_by_kind`, `confirmed_at`, grava o
   comprovante em `payment_receipts` e deixa linha no `audit_log`. Escrever só o
   status deixa o pedido "pago" sem nenhum rastro de por quê.
2. **Desde 22/09/2026 o mesmo cliente pode ter mais de um pedido na semana.**
   Um `update ... where customer_id = X` credita nos dois.

O caminho é uma função, que faz tudo numa transação só.

---

## 1) Achar o pedido pelo número

```
POST  {SUPABASE_URL}/rest/v1/rpc/fn_pedidos_do_telefone
      apikey: {SERVICE_ROLE_KEY}
      Authorization: Bearer {SERVICE_ROLE_KEY}
      Content-Type: application/json

{ "p_phone": "+5569992695898" }
```

Resposta:

```json
{
  "encontrado": true,
  "customer_id": "uuid",
  "nome": "Alisson",
  "pedidos": [
    { "order_id": "uuid", "code": "W39-0003", "semana": "2026-W39",
      "total_cents": 2070, "pago_cents": 0, "em_aberto_cents": 2070,
      "payment_status": "aguardando_pagamento", "aberto": true,
      "criado_em": "2026-09-22T14:02:11-04:00" }
  ]
}
```

`pedidos` é **lista** e traz só a semana corrente. Número fora do cadastro
devolve `encontrado: false` com a lista vazia — não é erro.

## 2) Registrar o comprovante

```
POST  {SUPABASE_URL}/rest/v1/rpc/fn_registrar_comprovante

{
  "p": {
    "phone": "+5569992695898",
    "valor_cents": 2070,
    "storage_path": "comprovantes/2026-W39/abc.jpg",
    "destinatario": "pagamentos@lifebox.com",
    "transaction_id": "TX-88213",
    "sha256": "…",
    "pago_em": "2026-09-22T15:40:00-04:00",
    "confianca": 0.97,
    "extracted": { "pagador": "Alisson A", "banco": "Zelle" }
  }
}
```

Só `storage_path` e (`phone` ou `order_id`) são obrigatórios. `valor_cents` em
**centavos**, inteiro — `$20.70` é `2070`.

Mandar `sha256` e `transaction_id` sempre que der: é com eles que o mesmo
comprovante reenviado é reconhecido em vez de pagar duas vezes.

Resposta:

```json
{
  "decisao": "conferir",
  "motivo": "ok",
  "teria_confirmado": true,
  "modo_sombra": true,
  "receipt_id": "uuid",
  "order_id": "uuid",
  "code": "W39-0003",
  "payment_status": "comprovante_recebido"
}
```

`decisao` é o que o n8n olha: `confirmado` ou `conferir`. Nada mais.

### Os motivos, e o que o fluxo faz com cada um

| `motivo` | o que houve |
|---|---|
| `ok` | passou em tudo |
| `duplicado` | `transaction_id` ou imagem já recebidos |
| `valor_divergente` | valor ≠ o que está em aberto, ou pagamento anterior ao pedido |
| `destinatario_nao_reconhecido` | chave fora de Configurações › Formas de pagamento |
| `baixa_confianca` | a extração leu mal |
| `sem_pedido` | número fora do cadastro, nenhum pedido aberto, **ou mais de um** |

**O motivo nunca vai para o cliente** (§9.3.5). Quem não confirma recebe
"recebemos seu comprovante, estamos conferindo" e a equipe abre a fila. Dizer
"valor divergente" no WhatsApp ensina a testar o sistema.

`sem_pedido` com `pedidos_abertos: 2` é de propósito: a função **não escolhe**
em qual dos dois creditar. Se o fluxo souber qual é (por resposta do cliente,
por exemplo), mande `order_id` no lugar de `phone`.

## 3) Modo sombra

Hoje `receipt_auto_confirm` está **desligado** nas configurações. Enquanto
estiver, nenhum comprovante confirma sozinho: o campo `teria_confirmado` diz o
que o sistema **teria** feito, e fica gravado em `payment_receipts`.

É esse número que a LifeBox compara antes de ligar o automático. Ligar é trocar
um `setting` — o fluxo do n8n não muda.

---

## Credencial

Estas duas funções **não** abrem para o `anon`, e `fn_registrar_comprovante`
nem para usuário comum da equipe: é escrita de dinheiro. O n8n entra com a
**`service_role`**.

Essa chave ignora a RLS inteira. Ela vive na credencial do n8n e **em lugar
nenhum mais** — nunca no front, nunca em repositório, nunca colada numa
conversa. A `anon key` do front é pública por desenho e protegida pela RLS; a
`service_role` não tem nada protegendo.

## Storage

A imagem vai para o bucket antes da chamada, e `storage_path` é o caminho dela.
Comprovante sem arquivo guardado é recusado (`LB400`): sem a imagem a equipe não
tem como conferir o que o sistema decidiu.
