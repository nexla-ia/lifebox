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
        orders(id, code, total_cents, payment_status, post_cutoff,
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
      post_cutoff: boolean
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
        telefone: l.customers.phone_e164,
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
