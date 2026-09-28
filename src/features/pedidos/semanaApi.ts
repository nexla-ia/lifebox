import { supabase } from '../../lib/supabase'

/* Dados do painel da Semana. Ref: protótipo 10a e 9a.
 *
 * O embed de `sizes` precisa nomear a FK: orders tem DUAS chaves para sizes
 * (size_id e breakfast_size_id, porque breakfast tem tamanho próprio), e sem
 * o nome o PostgREST recusa com "more than one relationship was found".
 *
 * O resumo agregado vem da view v_week_summary, que já aplica a regra do §6.4:
 * Total Pedidos = Novo Pedido + Renovação; Skip, Cancelamento e Parceria ficam
 * de fora. Faturado conta só pagamento confirmado. */

export type ResumoSemana = {
  week_id: string
  iso_code: string
  novo_pedido: number
  renovacao: number
  skip: number
  cancelamento: number
  parceria: number
  follow_up: number
  aguardando_selecao: number
  total_pedidos: number
  /** Total Pedidos conta PEDIDOS; Novo e Renovação contam PESSOAS. Os dois
   *  divergem quando alguém pede duas vezes na semana, o que passou a ser
   *  permitido (reunião de 22/09/2026). */
  clientes_com_pedido: number
  pedidos_cents: number
  faturado_cents: number
  a_receber_cents: number
  parceria_valor_comercial_cents: number
}

export type LinhaPedido = {
  customer_id: string
  order_status: string
  cliente: string
  telefone: string
  rota: string | null
  order: {
    id: string
    code: string
    total_cents: number
    payment_status: string
    post_cutoff: boolean
    plano: string | null
    size: string | null
    forma: string | null
  } | null
}

export type PainelSemana = {
  resumo: ResumoSemana
  linhas: LinhaPedido[]
  metaCents: number | null
}

const PERIODO_META = (iso: string) => iso   // '2026-W39'

export async function fetchPainel(weekId: string, isoCode: string) {
  const [resumo, linhas, meta] = await Promise.all([
    supabase.from('v_week_summary').select('*').eq('week_id', weekId).single(),
    supabase
      .from('customer_weeks')
      .select(`
        customer_id, order_status,
        customers!inner(first_name, last_name, phone_e164, routes(name)),
        orders(id, code, total_cents, payment_status, post_cutoff, phone_e164,
               plans(name_pt),
               sizes!orders_size_id_fkey(code),
               payment_methods(name_pt))
      `)
      .eq('week_id', weekId),
    supabase.from('goals').select('amount_cents')
      .eq('period_type', 'week').eq('period_key', PERIODO_META(isoCode)).maybeSingle(),
  ])

  if (resumo.error) return { data: null, error: { message: resumo.error.message } }
  if (linhas.error) return { data: null, error: { message: linhas.error.message } }

  type Bruto = {
    customer_id: string
    order_status: string
    customers: {
      first_name: string; last_name: string | null; phone_e164: string
      routes: { name: string } | null
    }
    orders: {
      id: string; code: string; total_cents: number; payment_status: string
      post_cutoff: boolean; phone_e164: string | null
      plans: { name_pt: string } | null
      sizes: { code: string } | null
      payment_methods: { name_pt: string } | null
    } | null
  }

  return {
    error: null,
    data: {
      resumo: resumo.data as ResumoSemana,
      metaCents: (meta.data as { amount_cents: number } | null)?.amount_cents ?? null,
      linhas: (linhas.data as unknown as Bruto[]).map((l) => ({
        customer_id: l.customer_id,
        order_status: l.order_status,
        cliente: `${l.customers.first_name} ${l.customers.last_name ?? ''}`.trim(),
        // o número PARA ONDE a confirmação daquele pedido foi. É nessa conversa
        // que o comprovante chega, e é ela que a equipe abre para conferir —
        // o cadastro pode ter mudado de número desde então.
        telefone: l.orders?.phone_e164 ?? l.customers.phone_e164,
        rota: l.customers.routes?.name ?? null,
        order: l.orders
          ? {
              id: l.orders.id,
              code: l.orders.code,
              total_cents: l.orders.total_cents,
              payment_status: l.orders.payment_status,
              post_cutoff: l.orders.post_cutoff,
              plano: l.orders.plans?.name_pt ?? null,
              size: l.orders.sizes?.code ?? null,
              forma: l.orders.payment_methods?.name_pt ?? null,
            }
          : null,
      })) satisfies LinhaPedido[],
    } satisfies PainelSemana,
  }
}

export const salvarMeta = (isoCode: string, amount_cents: number) =>
  supabase.from('goals').upsert(
    { period_type: 'week', period_key: PERIODO_META(isoCode), amount_cents },
    { onConflict: 'period_type,period_key' },
  )

/* ------------------------------------------------- ficha de um pedido (9b) */

export type ItemFicha = {
  item_type: string
  qty: number
  unit_price_cents: number
  name_snapshot: string
  category_snapshot: string | null
  taxable: boolean
  charges_delivery: boolean
  position: number | null
}

export type ComprovanteFicha = {
  id: string
  storage_path: string
  transaction_id: string | null
  check_result: string
  check_detail: string | null
  status: string
  received_at: string
  extracted: Record<string, unknown> | null
}

export type DetalhePedido = {
  id: string
  code: string
  kind: string
  fulfillment: string
  post_cutoff: boolean
  is_partnership: boolean
  taxable_cents: number
  tax_cents: number
  delivery_cents: number
  non_taxable_cents: number
  total_cents: number
  paid_amount_cents: number
  payment_status: string
  confirmed_by_kind: string | null
  confirmed_at: string | null
  created_at: string
  phone_e164: string | null
  cliente: string
  telefone: string
  order_status: string | null
  semana: string
  plano: string | null
  tamanho: string | null
  forma: string | null
  itens: ItemFicha[]
  comprovantes: ComprovanteFicha[]
}

/** Tudo de um pedido, para a ficha (§9.2, protótipo 9b).
 *
 *  Os itens vêm de `order_items`, que guarda SNAPSHOT de nome e preço: a ficha
 *  mostra o pedido como ele foi fechado, não como o catálogo está hoje. É o que
 *  faz um pedido de três semanas atrás continuar explicável depois de a LifeBox
 *  mexer no cardápio. */
export async function fetchDetalhePedido(
  orderId: string,
): Promise<{ data: DetalhePedido | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, code, kind, fulfillment, post_cutoff, is_partnership,
      taxable_cents, tax_cents, delivery_cents, non_taxable_cents, total_cents,
      paid_amount_cents, payment_status, confirmed_by_kind, confirmed_at,
      created_at, phone_e164,
      customers ( first_name, last_name, phone_e164 ),
      weeks ( iso_code ),
      plans ( name_pt ),
      sizes!orders_size_id_fkey ( name ),
      payment_methods ( name_pt ),
      order_items ( item_type, qty, unit_price_cents, name_snapshot,
                    category_snapshot, taxable, charges_delivery, position ),
      payment_receipts ( id, storage_path, transaction_id, check_result,
                         check_detail, status, received_at, extracted )
    `)
    .eq('id', orderId)
    .single()
  if (error) return { data: null, error }

  const o = data as unknown as Record<string, any>
  const c = o.customers ?? {}

  // o status da SEMANA é da pessoa, não do pedido — por isso vem à parte
  const { data: cw } = await supabase
    .from('customer_weeks')
    .select('order_status, customer_id, week_id')
    .eq('order_id', orderId)
    .maybeSingle()

  const ficha = {
    ...(o as object),
    cliente: [c.first_name, c.last_name].filter(Boolean).join(' '),
    // o telefone do PEDIDO é o que a confirmação usou; o do cadastro pode ter
    // mudado desde então
    telefone: o.phone_e164 ?? c.phone_e164 ?? '',
    order_status: cw?.order_status ?? null,
    semana: o.weeks?.iso_code ?? '',
    plano: o.plans?.name_pt ?? null,
    tamanho: o.sizes?.name ?? null,
    forma: o.payment_methods?.name_pt ?? null,
    itens: (o.order_items ?? []).slice().sort(
      (a: ItemFicha, b: ItemFicha) => (a.position ?? 0) - (b.position ?? 0)),
    comprovantes: (o.payment_receipts ?? []).slice().sort(
      (a: ComprovanteFicha, b: ComprovanteFicha) =>
        b.received_at.localeCompare(a.received_at)),
  } as DetalhePedido

  return { data: ficha, error: null }
}

export const mudarPagamento = (orderId: string, payment_status: string) =>
  supabase.from('orders').update({
    payment_status,
    confirmed_at: payment_status === 'confirmado' ? new Date().toISOString() : null,
    confirmed_by_kind: payment_status === 'confirmado' ? 'user' : null,
  }).eq('id', orderId)

export const mudarStatusSemana = (customerId: string, weekId: string, status: string) =>
  supabase.rpc('fn_set_week_status', {
    p_customer: customerId, p_week: weekId, p_status: status,
  })

/** Linhas do modo planilha, no formato que a equipe exporta (§9.1). */
export function paraCSV(linhas: LinhaPedido[]): string {
  const cab = ['Cliente', 'Telefone', 'Situação', 'Pedido', 'Plano', 'Tamanho',
               'Valor', 'Pagamento', 'Forma', 'Rota', 'Pós-cutoff']
  const escapar = (v: string) => `"${v.replace(/"/g, '""')}"`
  const corpo = linhas.map((l) => [
    l.cliente, l.telefone, l.order_status,
    l.order?.code ?? '', l.order?.plano ?? '', l.order?.size ?? '',
    l.order ? (l.order.total_cents / 100).toFixed(2) : '',
    l.order?.payment_status ?? '', l.order?.forma ?? '',
    l.rota ?? '', l.order?.post_cutoff ? 'sim' : '',
  ].map((c) => escapar(String(c))).join(','))
  return [cab.map(escapar).join(','), ...corpo].join('\n')
}
