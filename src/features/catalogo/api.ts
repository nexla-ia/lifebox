import { supabase } from '../../lib/supabase'
import type {
  Addon, AddonVariant, CustomUnitPrice, ExtraKind, ExtraPrice,
  Plan, PlanPrice, PricingSettings, Size,
} from '../../lib/types'

export type Catalogo = {
  sizes: Size[]
  plans: Plan[]
  planPrices: PlanPrice[]
  extraPrices: ExtraPrice[]
  customPrices: CustomUnitPrice[]
  settings: PricingSettings
}

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : fallback

export async function fetchCatalogo(): Promise<{ data: Catalogo | null; error: { message: string } | null }> {
  const [sizes, plans, planPrices, extraPrices, customPrices, settings] = await Promise.all([
    supabase.from('sizes').select('*').eq('active', true).order('position'),
    supabase.from('plans').select('*').eq('active', true).order('position'),
    supabase.from('plan_prices').select('*'),
    supabase.from('extra_prices').select('*'),
    supabase.from('custom_unit_prices').select('*'),
    supabase.from('settings').select('key, value')
      .in('key', ['tax_rate', 'delivery_fee_cents', 'service_fee_cents']),
  ])

  const first = [sizes, plans, planPrices, extraPrices, customPrices, settings].find((r) => r.error)
  if (first?.error) return { data: null, error: { message: first.error.message } }

  const cfg = Object.fromEntries((settings.data ?? []).map((s) => [s.key, s.value]))

  return {
    error: null,
    data: {
      sizes: (sizes.data ?? []) as Size[],
      plans: (plans.data ?? []) as Plan[],
      planPrices: (planPrices.data ?? []) as PlanPrice[],
      extraPrices: (extraPrices.data ?? []) as ExtraPrice[],
      customPrices: (customPrices.data ?? []) as CustomUnitPrice[],
      settings: {
        tax_rate: num(cfg.tax_rate, 0),
        delivery_fee_cents: num(cfg.delivery_fee_cents, 0),
        service_fee_cents: num(cfg.service_fee_cents, 0),
      },
    },
  }
}

export async function fetchAddons() {
  const [addons, variants] = await Promise.all([
    supabase.from('addons').select('*').order('position'),
    supabase.from('addon_variants').select('*').order('position'),
  ])
  if (addons.error) return { data: null, error: { message: addons.error.message } }
  if (variants.error) return { data: null, error: { message: variants.error.message } }
  return {
    error: null,
    data: {
      addons: (addons.data ?? []) as Addon[],
      variants: (variants.data ?? []) as AddonVariant[],
    },
  }
}

/* ------------------------------------------------------------------ escrita
 * Só o Administrador escreve preço — quem garante isso é a RLS (§3). A tela
 * esconde o campo, mas se alguém contornar, o banco recusa. */

export const savePlanPrice = (plan_id: string, size_id: string, base_price_cents: number) =>
  supabase.from('plan_prices').upsert(
    { plan_id, size_id, base_price_cents }, { onConflict: 'plan_id,size_id' })

export const saveExtraPrice = (
  plan_id: string, size_id: string, item_kind: ExtraKind, unit_price_cents: number,
) =>
  supabase.from('extra_prices').upsert(
    { plan_id, size_id, item_kind, unit_price_cents },
    { onConflict: 'plan_id,size_id,item_kind' })

export const saveCustomPrice = (size_id: string, unit_price_cents: number) =>
  supabase.from('custom_unit_prices').upsert(
    { size_id, unit_price_cents }, { onConflict: 'size_id' })

export const savePlan = (p: Partial<Plan>) =>
  p.id
    ? supabase.from('plans').update(p).eq('id', p.id)
    : supabase.from('plans').insert(p)

export const saveAddon = (a: Partial<Addon>) =>
  a.id
    ? supabase.from('addons').update(a).eq('id', a.id)
    : supabase.from('addons').insert(a)

export const setAddonActive = (id: string, active: boolean) =>
  supabase.from('addons').update({ active }).eq('id', id)
