# n8n · webhook `confirma-pedido`

Referência para montar o fluxo que envia a confirmação do pedido pelo WhatsApp.

O LifeBox chama este webhook **no momento em que o cliente confirma o pedido no
link público**. O disparo sai do banco (pg_net), não do navegador — então não
depende de a pessoa deixar a aba aberta.

URL configurada em **Configurações › (settings)** `webhook_order_confirmation`.
Deixar em branco desliga o aviso, sem quebrar nada.

---

## O que chega no webhook

```json
{
  "evento": "pedido_confirmado",
  "order_id": "uuid",
  "code": "W39-0001",
  "week": "2026-W39",
  "telefone": "+5569992695898",
  "nome": "Alisson",
  "idioma": "pt",
  "total_cents": 2070,
  "entrega": "2026-09-27",
  "origem": "public_link",
  "mensagem": "Olá, Alisson!\n\n✅ Recebemos seu pedido #W39-0001 da W39...",
  "variaveis": {
    "nome": "Alisson",
    "numero_pedido": "#W39-0001",
    "semana": "W39",
    "plano": "10 Meals + 5 Breakfasts",
    "tamanho": "Large",
    "lista_pratos": "Grilled Chicken ×3, Salmon ×2",
    "adicionais": "5 Juices ×1",
    "total": "$20.70",
    "forma_pagamento": "Zelle",
    "status_pagamento": "aguardando pagamento",
    "instrucoes_pagamento": "Envie para ...",
    "link_pagamento": "https://.../pay/W39-0001",
    "data_entrega": "domingo 27/09"
  }
}
```

**Use o campo `mensagem`.** Ele já vem montado com o template que a LifeBox
escreve em *Configurações › Mensagens*, no idioma em que o cliente fechou o
pedido. Assim, mudar o texto na tela muda o que o cliente recebe, sem mexer no
n8n. As `variaveis` vão junto só para quem quiser montar outro formato.

---

## Telefone → JID do WhatsApp

`telefone` vem em **E.164, com o `+`** (`+5569992695898`), que é o padrão do
banco. O JID do WhatsApp não leva o `+`.

### Na própria expressão do campo

```
{{ $json.telefone.replace(/\D/g, '') }}@s.whatsapp.net
```

`\D` tira tudo que não é dígito — não só o `+`. Se algum dia chegar espaço,
parêntese ou traço, continua funcionando.

### Em um nó Code (antes do envio)

```js
// Telefone do LifeBox (E.164) → JID do WhatsApp
for (const item of $input.all()) {
  const digitos = String(item.json.telefone ?? '').replace(/\D/g, '')
  item.json.jid = `${digitos}@s.whatsapp.net`
}
return $input.all()
```

---

## ⚠️ O nono dígito dos celulares brasileiros

Número brasileiro tem **duas formas possíveis de JID**, e nem sempre é a que
está no cadastro:

| | |
|---|---|
| Como o LifeBox manda | `5562986366866` (13 dígitos, com o 9) |
| Como o JID pode estar | `556286366866` (12 dígitos, sem o 9) |

Contas antigas de DDD 31 em diante costumam ter o JID **sem** o nono dígito. Se
a mensagem não chegar, é quase sempre isto.

**O jeito certo de resolver não é adivinhar:** pergunte à Evolution qual é o
JID, com o endpoint de verificação de número
(`/chat/whatsappNumbers`), e use o que ela devolver. Ela consulta o WhatsApp e
responde a forma real.

Se precisar de um paliativo enquanto isso, tentar as duas formas é melhor do
que escolher uma:

```js
// Gera as duas formas possíveis para número do Brasil.
// Passe as duas para a verificação da Evolution e use a que existir —
// escolher no chute manda mensagem para número que não existe.
for (const item of $input.all()) {
  const d = String(item.json.telefone ?? '').replace(/\D/g, '')
  const formas = [d]

  // 55 + DDD(2) + 9 + 8 dígitos → também tenta sem o 9
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') {
    formas.push(d.slice(0, 4) + d.slice(5))
  }
  // 55 + DDD(2) + 8 dígitos → também tenta com o 9
  if (d.startsWith('55') && d.length === 12) {
    formas.push(d.slice(0, 4) + '9' + d.slice(4))
  }

  item.json.candidatos = formas
  item.json.jid = `${formas[0]}@s.whatsapp.net`
}
return $input.all()
```

Número dos EUA não tem esse problema: `+16175550142` → `16175550142`.

---

## Depois do envio

A mensagem sempre pede o comprovante — é ele que alimenta a fila
"Comprovantes para conferir" (§9.3). O retorno do webhook não é lido pelo
LifeBox: se der erro no n8n, o pedido continua de pé, e a falha fica
registrada no `audit_log` com o `request_id` da chamada.
