import { supabase } from '../../lib/supabase'

/* Montagem de domingo e bags térmicas.
 * Ref: LIFEBOX_PROJECT.md §6.7, §9.9, §9.10 · telas 11a, 11b, 11c, 11f. */

/** Um prato da sacola, com o que a folha da cozinha precisa para COLORIR.
 *
 *  Large sai alaranjado e Small preto (reunião de 22/09/2026): quem monta
 *  separa por tamanho, e a cor evita trocar a marmita na hora de fechar. E
 *  quando o pedido mistura clássico com brasileiro, o brasileiro fica verde —
 *  é a confusão que mais acontece, porque os dois vão na mesma sacola. */
export type PratoMontagem = {
  nome: string
  qty: number
  size: string | null
  categoria: string | null
}

export type ParadaMontagem = {
  order_id: string
  code: string
  cliente: string
  telefone: string
  endereco: string | null
  cidade: string | null
  rota: string | null
  rota_id: string | null
  fulfillment: 'delivery' | 'pickup'
  plano: string | null
  size: string | null
  pratos: PratoMontagem[]
  /** mistura clássico e brasileiro — é o que liga o verde */
  misto: boolean
  adicionais: string
  bag_qty: number
  montado: boolean
  gelo: boolean
  post_cutoff: boolean
  delivery_notes: string | null
  office_notes: string | null
  entregar_com: string | null
  delivery_seq: number | null
}

export async function fetchMontagem(weekId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, code, bag_qty, assembled_at, ice_packed, post_cutoff, fulfillment,
      deliver_with_order_id, delivery_seq,
      plans(name_pt), sizes!orders_size_id_fkey(code),
      customers!inner(first_name, last_name, phone_e164, street_address, city,
                      delivery_notes, office_notes,
                      routes(id, name)),
      order_items(item_type, name_snapshot, qty, position, category_snapshot,
                  sizes(code))
    `)
    .eq('week_id', weekId)
    // quem ainda não foi classificado vai para o FIM, na ordem do código:
    // parada nova não pode cair no meio de um trajeto já organizado
    .order('delivery_seq', { ascending: true, nullsFirst: false })
    .order('code')

  if (error) return { data: null, error: { message: error.message } }

  type Bruto = {
    id: string; code: string; bag_qty: number; assembled_at: string | null
    ice_packed: boolean
    post_cutoff: boolean; fulfillment: 'delivery' | 'pickup'
    deliver_with_order_id: string | null; delivery_seq: number | null
    plans: { name_pt: string } | null
    sizes: { code: string } | null
    customers: {
      first_name: string; last_name: string | null; phone_e164: string
      street_address: string | null; city: string | null
      delivery_notes: string | null; office_notes: string | null
      routes: { id: string; name: string } | null
    }
    order_items: {
      item_type: string; name_snapshot: string; qty: number
      position: number | null; category_snapshot: string | null
      sizes: { code: string } | null
    }[]
  }

  const brutos = data as unknown as Bruto[]
  const porId = new Map(brutos.map((o) => [o.id, o]))

  return {
    error: null,
    data: brutos.map((o) => {
      // `position` é a ordem em que os itens entraram no pedido, e o front
      // agora lista o menu na ordem do menu — então a sacola sai na mesma
      // sequência que a cozinha montou (reunião de 22/09/2026)
      const pratos = o.order_items
        .filter((i) => i.item_type === 'dish')
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      const addons = o.order_items.filter((i) => i.item_type === 'addon')
      const comp = o.deliver_with_order_id ? porId.get(o.deliver_with_order_id) : null
      return {
        order_id: o.id,
        code: o.code,
        cliente: `${o.customers.first_name} ${o.customers.last_name ?? ''}`.trim(),
        telefone: o.customers.phone_e164,
        endereco: o.customers.street_address,
        cidade: o.customers.city,
        rota: o.customers.routes?.name ?? null,
        rota_id: o.customers.routes?.id ?? null,
        fulfillment: o.fulfillment,
        plano: o.plans?.name_pt ?? null,
        size: o.sizes?.code ?? null,
        // estruturado, não texto: a folha da cozinha colore prato a prato
        pratos: pratos.map((i) => ({
          nome: i.name_snapshot,
          qty: i.qty,
          size: i.sizes?.code ?? o.sizes?.code ?? null,
          categoria: i.category_snapshot,
        })),
        misto: pratos.some((i) => i.category_snapshot === 'brasileiro')
            && pratos.some((i) => i.category_snapshot === 'classico'),
        adicionais: addons.map((i) => `${i.name_snapshot} ×${i.qty}`).join(' · '),
        bag_qty: o.bag_qty,
        montado: o.assembled_at !== null,
        gelo: o.ice_packed,
        post_cutoff: o.post_cutoff,
        delivery_notes: o.customers.delivery_notes,
        office_notes: o.customers.office_notes,
        entregar_com: comp
          ? `${comp.customers.first_name} ${comp.customers.last_name ?? ''}`.trim()
          : null,
        delivery_seq: o.delivery_seq,
      }
    }) satisfies ParadaMontagem[],
  }
}

/** Grava a ordem da rota inteira numa chamada. Ver fn_ordenar_entrega. */
export const ordenarEntrega = (ids: string[]) =>
  supabase.rpc('fn_ordenar_entrega', { p_ids: ids })

export const marcarGelo = (orderId: string, ice_packed: boolean) =>
  supabase.from('orders').update({ ice_packed }).eq('id', orderId)

export const marcarMontado = (orderId: string, bags: number | null, montado: boolean) =>
  supabase.rpc('fn_marcar_montado', {
    p_order: orderId, p_bags: bags, p_montado: montado,
  })

// ---------------------------------------------------------------- bags §9.10
export type SaldoBag = {
  customer_id: string
  first_name: string
  last_name: string | null
  route_id: string | null
  balance: number
  semanas: number
  order_status: string | null
  prioridade: number
  motivo: string
}

export type EstoqueBag = {
  total: number
  na_rua: number
  clientes_com_bag: number
  a_coletar: number
}

export async function fetchBags() {
  const [coleta, estoque, rotas] = await Promise.all([
    supabase.from('v_bag_collect').select('*').order('prioridade').order('semanas', { ascending: false }),
    supabase.from('v_bag_estoque').select('*').single(),
    supabase.from('routes').select('id, name').eq('active', true).order('position'),
  ])
  if (coleta.error) return { data: null, error: { message: coleta.error.message } }
  if (estoque.error) return { data: null, error: { message: estoque.error.message } }
  return {
    error: null,
    data: {
      coleta: (coleta.data ?? []) as SaldoBag[],
      estoque: estoque.data as EstoqueBag,
      rotas: (rotas.data ?? []) as { id: string; name: string }[],
    },
  }
}

export const registrarDevolucao = (customerId: string, qtd: number) =>
  supabase.rpc('fn_registrar_devolucao', { p_customer: customerId, p_qtd: qtd })

export const salvarEstoqueTotal = (total: number) =>
  supabase.from('settings').update({ value: total }).eq('key', 'bag_stock_total')
