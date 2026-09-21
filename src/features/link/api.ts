import { supabase } from '../../lib/supabase'

/* Link público de pedido (§9.7 · telas 6e a 6m).
 *
 * Esta é a única parte do sistema que fala com o Supabase sem sessão. Do outro
 * lado não existe tabela aberta: tudo passa pelas funções fn_link_* da
 * migration 1400, que rodam como donas e decidem o que sai. Se um dado novo
 * precisar aparecer no link, ele nasce lá — não numa consulta nova daqui. */

export type SemanaLink = {
  week_id: string
  iso_code: string
  starts_on: string
  ends_on: string
  cutoff_at: string
  aberto: boolean
  entrega: string
  proxima_abertura: string
  proxima_iso: string
}

export type Tamanho = { id: string; code: string; name: string }

export type PlanoLink = {
  id: string
  name_pt: string
  name_en: string
  meals_qty: number
  breakfasts_qty: number
  prices: { size_id: string; base_price_cents: number }[]
  extras: { size_id: string; item_kind: 'meal' | 'breakfast'; unit_price_cents: number }[]
}

export type Rotulo = { code: string; label_pt: string; label_en: string; icon: string | null }

export type PratoLink = {
  id: string
  name_pt: string
  name_en: string
  desc_pt: string | null
  desc_en: string | null
  category: 'classico' | 'brasileiro' | 'breakfast'
  photo: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  sizes: string[]
  tags: Rotulo[]
  allergens: Rotulo[]
}

export type AdicionalLink = {
  id: string
  name_pt: string
  name_en: string
  desc_pt: string | null
  desc_en: string | null
  photo: string | null
  price_cents: number
  category: string
  requires_plan: boolean
  charges_tax: boolean
  charges_delivery: boolean
  variants: { id: string; name_pt: string; name_en: string }[]
}

export type CatalogoLink = {
  tax_rate: number
  delivery_fee_cents: number
  sizes: Tamanho[]
  plans: PlanoLink[]
  custom_prices: { size_id: string; unit_price_cents: number }[]
  dishes: PratoLink[]
  addons: AdicionalLink[]
  payment_methods: { id: string; name_pt: string; name_en: string }[]
}

export type Identificacao = {
  conhecido: boolean
  first_name?: string
  last_name?: string | null
  street_address?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  delivery_notes?: string | null
  default_plan_id?: string | null
  default_size_id?: string | null
  pedido?: { code: string; total_cents: number; plano: string | null; tamanho: string | null } | null
}

export type ItemPedido =
  | { type: 'dish'; dish_id: string; size_id?: string; qty: number }
  | { type: 'addon'; addon_id: string; variant_id?: string; qty: number }

export type Preco = {
  taxable_cents: number
  tax_cents: number
  delivery_cents: number
  non_taxable_cents: number
  total_cents: number
  // contagens que o servidor derivou dos itens — o front não soma nada (§2),
  // só mostra o que voltou
  meals_qty: number
  breakfasts_qty: number
  meals_extra: number
  breakfasts_extra: number
  lines: {
    item_type: 'plan_base' | 'dish' | 'extra' | 'addon'
    addon_id?: string | null
    name_snapshot: string
    qty: number
    unit_price_cents: number
    taxable: boolean
  }[]
}

/** Códigos que o banco devolve de propósito, para a tela saber o que dizer
 *  (migration 1400). Mensagem genérica em erro de regra é o que faz a pessoa
 *  desistir sem saber o que fazer. */
export const ERRO = {
  telefone: 'LB400',
  zipFora: 'LB422',
  fechado: 'LB423',
  jaTemPedido: 'LB409',
  muitasTentativas: 'LB429',
} as const

export type CodigoErro = (typeof ERRO)[keyof typeof ERRO] | 'desconhecido'

export function codigoDoErro(e: { code?: string } | null): CodigoErro {
  const c = e?.code ?? ''
  return (Object.values(ERRO) as string[]).includes(c) ? (c as CodigoErro) : 'desconhecido'
}

const rpc = async <T>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as T, error: null }
}

export const fetchSemanaLink = () => rpc<SemanaLink>('fn_link_semana')
export const fetchCatalogoLink = () => rpc<CatalogoLink>('fn_link_catalogo')
export const consultarZipAtendido = (zip: string) =>
  rpc<{ atende: boolean; city?: string; state?: string; rota?: string }>('fn_link_zip', { p_zip: zip })
export const identificar = (phone: string) =>
  rpc<Identificacao>('fn_link_identificar', { p_phone: phone })

export const precificarLink = (p: {
  kind: 'plan' | 'custom' | 'addons_only'
  plan_id?: string | null
  size_id?: string | null
  items: ItemPedido[]
}) => rpc<Preco>('fn_link_precificar', { p })

export const criarPedidoLink = (p: {
  phone: string
  first_name: string
  last_name?: string
  street_address?: string
  zip_code: string
  delivery_notes?: string
  payment_method_id?: string | null
  kind: 'plan' | 'custom' | 'addons_only'
  plan_id?: string | null
  size_id?: string | null
  items: ItemPedido[]
}) =>
  rpc<{
    code: string
    total_cents: number
    entrega: string
    iso_code: string
    first_name: string
  }>('fn_link_criar_pedido', { p })
