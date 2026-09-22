/* Link público em EN e PT (§9.7).
 *
 * Duas línguas de verdade, não um toggle decorativo: a LifeBox atende
 * brasileiros em Boston, e a mesma pessoa manda o link para quem lê inglês.
 *
 * O padrão é EN porque é o idioma do site e dos pratos — `dishes.name_en`
 * existe justamente para isto (§5.5). O seletor troca na hora, sem ida ao
 * servidor: fn_link_catalogo devolve os dois idiomas de uma vez.
 *
 * Só texto de interface mora aqui. Nome de prato, plano e adicional vem do
 * catálogo da LifeBox, que é quem edita — nada de cardápio hardcoded. */

export type Idioma = 'en' | 'pt'

export const T = {
  en: {
    // cabeçalho
    semana: 'Week',
    menu: 'Menu',
    ateQuinta: 'order by',
    entregaDomingo: 'delivery Sunday',
    idioma: 'Português',

    // passo 1 · telas 6e, 6g
    p1Titulo: "Let's start with your details",
    whatsapp: 'WhatsApp',
    whatsappAjuda:
      'We use your number to find your account and send the order confirmation. US number, or Brazilian with 55 in front.',
    ola: 'Hi',
    encontramos: 'We found your account.',
    entregaEm: 'Delivery address:',
    alterarEndereco: 'Change address',
    primeiraVez: 'First time here?',
    primeiraVezAjuda: 'We need your address to check if we deliver to your area.',
    nome: 'First name',
    sobrenome: 'Last name',
    endereco: 'Delivery address',
    zip: 'ZIP code',
    cidade: 'City',
    notas: 'Delivery notes',
    opcional: 'optional',
    comoReceber: 'How do you want it?',
    entrega: '🚚 Delivery',
    retirada: '🏠 Pick-up at the kitchen',
    retiradaAjuda: 'No delivery fee. You pick it up on Sunday.',
    entregaAjuda: 'Delivered on Sunday at your address.',
    janelaRetirada: 'Pick-up window',
    formaPagamento: 'Payment method',
    escolherPlano: 'Choose your plan',
    entregamos: 'Delivery available',
    naoEntregamos: 'We do not deliver to this ZIP yet.',
    naoEntregamosAjuda:
      'Message us on WhatsApp — we will let you know as soon as we open your area.',
    pedidoBloqueado: 'Order blocked',
    verificando: 'Checking…',

    // tela 6m
    jaTemPedido: 'You already have an order this week',
    jaTemPedidoAjuda: 'You can place another one — it goes as a separate order.',
    verPedido: 'View order',
    outroPedido: 'Place another order',

    // passo 2 · telas 6a, 6c
    p2Titulo: 'Choose your plan',
    refeicoes: 'meals',
    breakfasts: 'breakfasts',
    aEscolher: 'to choose',
    personalizado: 'Custom',
    personalizadoAjuda: 'Pick quantity per size, charged per unit',
    personalizadoNota:
      'Outside the plan structure — each meal is charged per unit, at the price the team sets in the catalog.',
    tamanho: 'Size',
    tamanhoNota: 'The size applies to the whole plan.',
    escolherPratos: 'Choose your meals',
    verAdicionais: 'See add-ons',
    subtotal: 'Subtotal',
    unidades: 'units',

    // passo 3 · telas 6b, 6d
    todos: 'All',
    de: 'of',
    semPreco: 'No prices here — everything is included in your plan.',
    contains: 'Contains:',
    limiteAtingido: 'You have already picked all the meals in your plan.',
    extraAviso: 'Over the plan. The next meal is charged as an extra of',
    extraUnitario: 'unit price for this tier',
    adicionarExtra: 'Add as extra',
    manter: 'Keep',

    // passo 4 · tela 6h
    adicionais: 'Add-ons',
    adicionaisAjuda: 'Items from the LifeBox catalog. Add as many as you like.',
    semTax: 'Juices and Detox have no tax and no delivery fee.',
    revisar: 'Review order',

    // passo 5 · tela 6i
    revisarTitulo: 'Review your order',
    plano: 'Plan',
    pratos: 'Meals',
    entregaE: 'Add-ons · Delivery',
    editar: 'Edit',
    extras: 'extra',
    refeicaoExtra: 'Extra meal',
    breakfastExtra: 'Extra breakfast',
    tax: 'Tax',
    delivery: 'Delivery',
    semTaxDelivery: 'no tax/delivery',
    total: 'Total',
    confirmar: 'Place order',
    enviando: 'Sending…',

    // passo 6 · tela 6j
    confirmado: 'Order placed!',
    pedidoNum: 'Order',
    entregaDom: 'delivery Sunday',
    receberaWhats: 'You will get the confirmation on WhatsApp with the payment instructions.',
    envieComprovante:
      'After paying, send the receipt in that chat — the order is confirmed when it arrives.',
    abrirWhats: 'Open WhatsApp',

    // tela 6k
    fechadoTitulo: 'Orders for this week are closed',
    fechadoCorpo1: 'closed at the cutoff on',
    fechadoCorpo2: 'The next window opens',
    falarWhats: 'Talk to us on WhatsApp',

    // erros
    erroTelefone: 'Enter the number with area code — US, or Brazilian with 55 in front.',
    erroGenerico: 'Something went wrong. Please try again.',
    erroLimite: 'Too many attempts. Please wait a few minutes.',
    erroFechado: 'Orders for this week just closed.',
    voltar: 'Back',
  },

  pt: {
    semana: 'Semana',
    menu: 'Menu',
    ateQuinta: 'pedidos até',
    entregaDomingo: 'entrega domingo',
    idioma: 'English',

    p1Titulo: 'Vamos começar pelos seus dados',
    whatsapp: 'WhatsApp',
    whatsappAjuda:
      'Usamos seu número para achar seu cadastro e enviar a confirmação do pedido. Número dos EUA, ou do Brasil com o 55 na frente.',
    ola: 'Olá',
    encontramos: 'Encontramos seu cadastro.',
    entregaEm: 'Entrega no endereço:',
    alterarEndereco: 'Alterar endereço',
    primeiraVez: 'Primeira vez por aqui?',
    primeiraVezAjuda: 'Precisamos do seu endereço para conferir se entregamos na sua região.',
    nome: 'Nome',
    sobrenome: 'Sobrenome',
    endereco: 'Endereço de entrega',
    zip: 'ZIP code',
    cidade: 'Cidade',
    notas: 'Observações da entrega',
    opcional: 'opcional',
    comoReceber: 'Como você quer receber?',
    entrega: '🚚 Entrega',
    retirada: '🏠 Retirar na cozinha',
    retiradaAjuda: 'Sem taxa de entrega. Você busca no domingo.',
    entregaAjuda: 'Entregamos no domingo, no seu endereço.',
    janelaRetirada: 'Horário de retirada',
    formaPagamento: 'Forma de pagamento',
    escolherPlano: 'Escolher plano',
    entregamos: 'Entregamos na sua região',
    naoEntregamos: 'Ainda não entregamos nesse ZIP.',
    naoEntregamosAjuda:
      'Fale com a gente pelo WhatsApp — avisamos assim que abrirmos sua região.',
    pedidoBloqueado: 'Pedido bloqueado',
    verificando: 'Conferindo…',

    jaTemPedido: 'Você já tem um pedido nesta semana',
    jaTemPedidoAjuda: 'Dá para fazer outro — ele entra como um pedido separado.',
    verPedido: 'Ver pedido',
    outroPedido: 'Fazer outro pedido',

    p2Titulo: 'Escolha seu plano',
    refeicoes: 'refeições',
    breakfasts: 'breakfasts',
    aEscolher: 'à escolha',
    personalizado: 'Personalizado',
    personalizadoAjuda: 'Monte quantidade por tamanho, cobrado por unidade',
    personalizadoNota:
      'Fora da estrutura dos planos — cada prato é cobrado por unidade, no preço unitário que a equipe cadastra no catálogo.',
    tamanho: 'Tamanho',
    tamanhoNota: 'O tamanho vale para o plano inteiro.',
    escolherPratos: 'Escolher pratos',
    verAdicionais: 'Ver adicionais',
    subtotal: 'Subtotal',
    unidades: 'unidades',

    todos: 'Todos',
    de: 'de',
    semPreco: 'Sem preço nos pratos — tudo incluso no plano.',
    contains: 'Contém:',
    limiteAtingido: 'Você já escolheu todas as refeições do plano.',
    extraAviso: 'Passou do plano. A próxima refeição entra como extra de',
    extraUnitario: 'unitário da faixa',
    adicionarExtra: 'Adicionar como extra',
    manter: 'Manter',

    adicionais: 'Adicionais',
    adicionaisAjuda: 'Itens cadastrados pela equipe. Adicione quantos quiser.',
    semTax: 'Sucos e Detox não têm tax nem delivery.',
    revisar: 'Revisar pedido',

    revisarTitulo: 'Revisar pedido',
    plano: 'Plano',
    pratos: 'Pratos',
    entregaE: 'Adicionais · Entrega',
    editar: 'Editar',
    extras: 'extra',
    refeicaoExtra: 'Refeição extra',
    breakfastExtra: 'Breakfast extra',
    tax: 'Tax',
    delivery: 'Delivery',
    semTaxDelivery: 'sem tax/delivery',
    total: 'Total',
    confirmar: 'Confirmar pedido',
    enviando: 'Enviando…',

    confirmado: 'Pedido confirmado!',
    pedidoNum: 'Pedido',
    entregaDom: 'entrega domingo',
    receberaWhats: 'Você vai receber a confirmação no WhatsApp com as instruções de pagamento.',
    envieComprovante:
      'Depois de pagar, envie o comprovante na conversa — o pedido é confirmado quando ele chega.',
    abrirWhats: 'Abrir WhatsApp',

    fechadoTitulo: 'Pedidos desta semana encerrados',
    fechadoCorpo1: 'fechou no cutoff de',
    fechadoCorpo2: 'A próxima janela abre',
    falarWhats: 'Falar no WhatsApp',

    erroTelefone: 'Digite o número com DDD — dos EUA, ou do Brasil com o 55 na frente.',
    erroGenerico: 'Algo deu errado. Tente de novo.',
    erroLimite: 'Muitas tentativas. Aguarde alguns minutos.',
    erroFechado: 'Os pedidos desta semana acabaram de fechar.',
    voltar: 'Voltar',
  },
} satisfies Record<Idioma, Record<string, string>>

export type Textos = (typeof T)['en']

/** Nome do catálogo no idioma da tela. O conteúdo é da LifeBox; aqui só se
 *  escolhe a coluna. */
export const nome = (o: { name_pt: string; name_en: string }, l: Idioma) =>
  l === 'pt' ? o.name_pt : o.name_en

export const descr = (o: { desc_pt?: string | null; desc_en?: string | null }, l: Idioma) =>
  (l === 'pt' ? o.desc_pt : o.desc_en) ?? null

export const rotulo = (o: { label_pt: string; label_en: string }, l: Idioma) =>
  l === 'pt' ? o.label_pt : o.label_en

/** "quinta-feira, 18:00" / "Thursday, 6:00 PM".
 *
 *  O cutoff sai do banco em timestamptz e é mostrado no fuso OPERACIONAL, não
 *  no do navegador (§2): cliente viajando ou com o relógio em outro fuso leria
 *  uma hora que não é a que fecha o pedido.
 *
 *  O minuto vai sempre. Omitir quando é zero deixa o português em "quinta-feira,
 *  18" — que não é hora nenhuma. */
export function quandoCutoff(iso: string, l: Idioma): string {
  return new Date(iso).toLocaleString(l === 'pt' ? 'pt-BR' : 'en-US', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })
}

export function dataCurta(iso: string, l: Idioma): string {
  // 'YYYY-MM-DD' vindo de uma coluna date: sem hora, senão o fuso do navegador
  // puxa a data para o dia anterior.
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(a, m - 1, d).toLocaleDateString(l === 'pt' ? 'pt-BR' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
  })
}
