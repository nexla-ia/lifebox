# LifeBox — decisões pendentes

Lista do que ainda precisa de uma definição da LifeBox para o sistema ficar
fiel à operação de vocês.

**Nada aqui está travando o desenvolvimento.** Cada item já tem um padrão
adotado, e todos eles são configuráveis: quando a resposta vier, muda no
cadastro, sem precisar de nova versão do sistema. O que importa é responder
antes de entrar em produção, para não começar com número errado.

Ordenado por urgência.

---

## 1. Lista oficial de ZIP codes atendidos ⚠️ mais urgente

**O que precisamos:** a lista completa dos CEPs que vocês atendem, e a rota de
cada um (Boston, Marlborough ou South Shore).

**Por quê:** é o ZIP que decide se o link público deixa a pessoa fechar o
pedido ou mostra "fora da área de entrega". Com a lista errada, o sistema
recusa cliente bom.

**Ficou mais fácil:** vocês não precisam mais levantar CEP por CEP. Na tela de
Configurações, basta digitar o **nome da cidade** e o sistema traz todos os CEPs
dela de uma vez — Framingham, por exemplo, tem 5. Depois dá para trocar a rota
de qualquer CEP individualmente, já que as rotas não são estritamente
geográficas.

Então o que precisamos de vocês é só a **lista de cidades** que atendem, e a
rota de cada uma. As 27 cidades que aparecem na planilha da W37 renderiam
cerca de 84 CEPs automaticamente.

**Como estamos agora:** o ambiente está com a lista vazia, o que significa que
o link público recusaria qualquer pedido. É o estado correto — melhor vazio do
que com CEP errado —, mas precisa ser preenchido antes de ir ao ar.

Cidades que apareceram na W37, por rota:

| Rota | Cidades |
|---|---|
| Boston | Revere, Watertown, Cambridge, Somerville, Malden, Everett, Peabody, Beverly, Woburn, Billerica, Lowell, Dracut |
| Marlborough | Framingham, Marlborough, Westborough, Northborough, Worcester, Milford, Medway |
| South Shore | Ashland, Hanover, Rockland, Weymouth, Whitman, Fall River |
| Pick-up | Holliston, Whitinsville |

Confiram se a lista de cidades está completa — a planilha mostra só quem
pediu naquela semana, então pode faltar cidade que vocês atendem e não teve
pedido na W37.

---

## 2. Preço do breakfast extra no tamanho Large

**O que precisamos:** confirmar se é **$6.26** ou **$5.15**.

**Por quê:** os dois materiais que recebemos discordam. O documento de regras
diz $6.26; a tela de catálogo aprovada mostra $5.15.

**Como estamos agora:** usando **$6.26**, o valor do documento de regras.

Para referência, os outros extras não têm conflito:

| Extra | Small (faixa 5) | Small (faixa 10) | Large (faixa 5) | Large (faixa 10) |
|---|---|---|---|---|
| Refeição | $11.20 | $10.75 | $13.01 | $12.59 |
| Breakfast | $4.30 | $4.23 | **a confirmar** | **a confirmar** |

---

## 3. As 5 refeições do Super Detox

**O que precisamos:** confirmar como funciona.

**Por quê:** o documento de regras dizia que ainda não estava definido. Na
planilha da W37 encontramos um caso real (South Shore, pedido 2) em que a
cliente do Super Detox **escolheu 5 pratos do cardápio da semana**, listados um
a um, junto das 20 juices e das 5 sopas.

**Como estamos agora:** seguindo o que a planilha mostra — o cliente escolhe as
5 refeições do menu da semana, e **elas entram na folha da cozinha**, porque
são pratos que precisam ser produzidos.

Isso é diferente do que o documento de regras sugeria (tratar tudo como item de
estoque). Se a leitura estiver certa, é só confirmar. Se o kit tiver refeições
fixas, nos digam quais.

---

## 4. O que aparece no campo de preço do catálogo

**O que precisamos:** decidir o que vocês preferem digitar ao editar o preço de
um plano.

**Por quê:** existem dois números para o mesmo plano. O 5 Meals Small, por
exemplo, é **$56.00** antes dos impostos e **$69.92** no total que o cliente
paga (com os 7% e os $10 de entrega).

**Como estamos agora:** o sistema guarda o valor sem imposto.

Nossa sugestão é vocês digitarem **$56.00** e a tela mostrar, logo abaixo e
ao vivo, "cliente paga $69.92". O motivo: o valor final muda sozinho quando o
pedido é retirada em vez de entrega, e mudaria de novo se a taxa de 7% mudasse.
Se o sistema guardasse o valor final, mexer na taxa alteraria o preço de todos
os planos sem vocês perceberem.

Se for mais natural pensar pelo preço de anúncio, colocamos um botão "digitar
preço final" que faz a conta ao contrário. Só precisamos saber qual dos dois
vocês querem ver primeiro.

---

## 5. Preço unitário do Pedido Personalizado

**O que precisamos:** o valor de cada refeição avulsa, por tamanho.

**Por quê:** pedidos fora da estrutura dos planos são comuns — na W37 teve
gente pedindo 4, 6, 8, 12 e 16 refeições, e até tamanhos misturados no mesmo
pedido.

**Como estamos agora:** usando **Small $9.30** e **Large $11.50**, que são os
valores que apareciam na tela aprovada. Não temos confirmação de que são reais.

---

## 6. Retirada (pick-up) cobra a taxa de entrega?

**Como estamos agora:** **não cobra.** Quem retira na cozinha não paga os $10.

Se estiver errado, é um clique para inverter.

---

## 7. Quantidade padrão de bags térmicas por pedido

**Como estamos agora:** **1 bag por pedido**, editável pedido a pedido.

Na planilha da W37 a quantidade varia entre 1 e 2, sem uma regra visível — não
acompanha o tamanho do plano. Se existir uma regra (por exemplo, 2 bags acima
de 10 refeições), nos digam que o sistema passa a sugerir sozinho.

---

## 8. Tamanho Medium

**Como estamos agora:** **cadastrado e desativado.**

Ele não consta nas regras oficiais, mas aparece em pedido real da W37
(Marlborough, "10 MEALS MEDIUM"). Deixamos cadastrado para não perder o
histórico, e desativado para não aparecer como opção em pedido novo.

Se o Medium voltar a ser vendido, basta reativar.

---

## 9. Cálculo do ticket médio

**O que precisamos:** escolher a conta.

**Por quê:** os dois materiais usam fórmulas diferentes, e dão números bem
distintos. Na semana W38 do exemplo:

| Conta | Resultado |
|---|---|
| Valor total dos pedidos ÷ número de pedidos | $125.68 |
| Valor já recebido ÷ pedidos pagos | $143.51 |

**Como estamos agora:** ainda não implementado — essa tela é do Módulo 2. Dá
para responder mais para a frente.

---

## 10. Estoque total de bags térmicas

**O que precisamos:** quantas bags vocês têm no total.

**Como estamos agora:** zero. O sistema já calcula quantas estão na rua a partir
das entregas e devoluções; só falta o total para mostrar quantas estão em casa.

---

## 11. Confirmação automática de comprovante

**Como estamos agora:** **modo sombra ligado**, como o documento de regras pede.

O sistema analisa o comprovante e decide, mas **quem confirma é a equipe**.
Depois de algumas semanas comparando as duas decisões, vocês nos dizem se pode
passar a confirmar sozinho.

---

## Sobre o catálogo

Pratos, planos, preços, adicionais, formas de pagamento e origens **não vêm
prontos no sistema**: quem cadastra é a equipe da LifeBox, pela tela de
Catálogo. Nada disso está fixo no código, e tudo pode ser alterado a qualquer
momento.

Para desenvolver, estamos usando o cardápio real da W37 como exemplo. Ele será
apagado antes da entrega — o ambiente de vocês começa em branco, para ser
preenchido do jeito de vocês.

Alterar um preço **não muda pedido já lançado**: cada pedido guarda os valores
de quando foi feito.
