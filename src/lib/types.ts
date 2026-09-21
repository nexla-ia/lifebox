/* Tipos do domínio.
 *
 * Escritos à mão de propósito: `supabase gen types` exige Docker, que não roda
 * nesta máquina. São poucas tabelas e o schema é nosso, então manter isto em dia
 * é barato. Quando houver Docker (ou um access token do Supabase), dá para
 * trocar por geração automática sem mexer em quem consome.
 *
 * Referência: supabase/migrations/. Dinheiro sempre em centavos (§2). */

export type Role = 'admin' | 'operacao' | 'cozinha'
export type DishCategory = 'classico' | 'brasileiro' | 'breakfast'
export type AddonCategory = 'juice' | 'detox' | 'other'
export type ExtraKind = 'meal' | 'breakfast'

export type Size = {
  id: string
  code: string
  name: string
  position: number
  active: boolean
}

export type Plan = {
  id: string
  name_pt: string
  name_en: string
  meals_qty: number
  breakfasts_qty: number
  position: number
  active: boolean
}

export type PlanPrice = {
  plan_id: string
  size_id: string
  /** pré-tax, com o service de $1.75 já embutido (§5.1) */
  base_price_cents: number
}

export type ExtraPrice = {
  plan_id: string
  size_id: string
  item_kind: ExtraKind
  unit_price_cents: number
}

export type CustomUnitPrice = {
  size_id: string
  unit_price_cents: number
}

export type Addon = {
  id: string
  name_pt: string
  name_en: string
  desc_pt: string | null
  desc_en: string | null
  photo: string | null
  category: AddonCategory
  price_cents: number
  charges_tax: boolean
  charges_delivery: boolean
  requires_plan: boolean
  includes_meals_qty: number
  position: number
  active: boolean
}

export type AddonVariant = {
  id: string
  addon_id: string
  name_pt: string
  name_en: string
  position: number
  active: boolean
}

export type Dish = {
  id: string
  name_pt: string
  name_en: string
  desc_pt: string | null
  desc_en: string | null
  category: DishCategory
  protein_tag: string | null
  photos: string[]
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  active: boolean
}

export type Menu = {
  id: string
  name: string
  cycle_position: number
}

/** settings guarda jsonb; estes são os que o catálogo usa (§5.6). */
export type PricingSettings = {
  tax_rate: number
  delivery_fee_cents: number
  service_fee_cents: number
}
