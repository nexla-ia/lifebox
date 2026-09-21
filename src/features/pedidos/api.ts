import { supabase } from '../../lib/supabase'
import type { Addon, AddonVariant, Dish, Plan, Size } from '../../lib/types'
import type { Cliente } from '../clientes/api'

export type Semana = {
  id: string
  iso_code: string
  starts_on: string
  ends_on: string
  menu_id: string | null
  cutoff_at: string
  status: 'open' | 'closed'
}

export type FormaPagamento = { id: string; name_pt: string; active: boolean }

export type DadosPedido = {
  semana: Semana
  pratos: Dish[]
  planos: Plan[]
  precos: { plan_id: string; size_id: string; base_price_cents: number }[]
  tamanhos: Size[]
  addons: Addon[]
  variantes: AddonVariant[]
  formas: FormaPagamento[]
  clientes: Cliente[]
  passouCutoff: boolean
}

/** Garante a semana corrente e traz tudo que a ficha precisa. */
export async function fetchDadosPedido(weekId?: string) {
  let id = weekId
  if (!id) {
    const { data, error } = await supabase.rpc('fn_semana_atual')
    if (error) return { data: null, error: { message: error.message } }
    id = data as string
  }

  const { data: semana, error: eSemana } = await supabase
    .from('weeks').select('*').eq('id', id).single()
  if (eSemana) return { data: null, error: { message: eSemana.message } }
  const s = semana as Semana

  const [pratos, planos, precos, tamanhos, addons, variantes, formas, clientes] =
    await Promise.all([
      // só os pratos ativos no menu da semana (§4)
      s.menu_id
        ? supabase.from('menu_dishes')
            .select('dishes!inner(*)')
            .eq('menu_id', s.menu_id).eq('active', true)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('plans').select('*').eq('active', true).order('position'),
      supabase.from('plan_prices').select('*'),
      supabase.from('sizes').select('*').eq('active', true).order('position'),
      supabase.from('addons').select('*').eq('active', true).order('position'),
      supabase.from('addon_variants').select('*').eq('active', true).order('position'),
      supabase.from('payment_methods').select('id, name_pt, active').eq('active', true).order('position'),
      supabase.from('customers').select('*').order('first_name'),
    ])

  const falha = [planos, precos, tamanhos, addons, variantes, formas, clientes]
    .find((r) => r.error)
  if (falha?.error) return { data: null, error: { message: falha.error.message } }

  return {
    error: null,
    data: {
      semana: s,
      pratos: ((pratos.data ?? []) as unknown as { dishes: Dish }[])
        .map((r) => r.dishes)
        .sort((a, b) => a.name_pt.localeCompare(b.name_pt)),
      planos: (planos.data ?? []) as Plan[],
      precos: (precos.data ?? []) as DadosPedido['precos'],
      tamanhos: (tamanhos.data ?? []) as Size[],
      addons: (addons.data ?? []) as Addon[],
      variantes: (variantes.data ?? []) as AddonVariant[],
      formas: (formas.data ?? []) as FormaPagamento[],
      clientes: (clientes.data ?? []) as Cliente[],
      passouCutoff: new Date(s.cutoff_at) < new Date(),
    } satisfies DadosPedido,
  }
}

export type ItemPedido =
  | { type: 'dish'; dish_id: string; size_id?: string; qty: number }
  | { type: 'addon'; addon_id: string; variant_id?: string; qty: number }

export type Precificacao = {
  lines: {
    item_type: string
    name_snapshot: string
    qty: number
    unit_price_cents: number
    taxable: boolean
  }[]
  taxable_cents: number
  tax_cents: number
  delivery_cents: number
  non_taxable_cents: number
  total_cents: number
  meals_qty: number
  breakfasts_qty: number
  meals_extra: number
  breakfasts_extra: number
  tax_rate: number
}

export type Rascunho = {
  kind: 'plan' | 'custom' | 'addons_only'
  plan_id?: string
  size_id?: string
  breakfast_size_id?: string
  fulfillment: 'delivery' | 'pickup'
  items: ItemPedido[]
}

/** Prévia do preço. §2: o front manda itens e recebe o total, nunca o envia. */
export async function precificar(r: Rascunho) {
  const { data, error } = await supabase.rpc('rpc_precificar', { p: r })
  if (error) return { data: null, error: { message: error.message } }
  return { data: data as Precificacao, error: null }
}

export async function criarPedido(p: Rascunho & {
  customer_id: string
  week_id: string
  payment_method_id?: string
  is_partnership?: boolean
  bag_qty?: number
}) {
  const { data, error } = await supabase.rpc('fn_create_order', { p })
  if (error) return { data: null, error: { message: error.message } }
  return { data: data as { order_id: string; code: string; order_status: string }, error: null }
}
