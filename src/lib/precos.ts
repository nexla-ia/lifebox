import type { PricingSettings } from './types'

/* Espelho do cálculo de fn_price_order, SÓ para exibição (§5.6).
 *
 * A fonte da verdade é o servidor: o front nunca envia valor, e o total de um
 * pedido sempre vem do banco (§2). Isto aqui existe para a tela de Catálogo
 * mostrar "base $56.00 → cliente paga $69.92" enquanto a pessoa digita. */

/** round half-up, igual ao round() do Postgres sobre centavos. */
export const taxCents = (baseCents: number, taxRate: number) =>
  Math.round(baseCents * taxRate)

/** Preço final de um plano: base + tax + delivery.
 *  `comDelivery` é false no pick-up, que por padrão não cobra entrega (§6.6). */
export function finalPriceCents(
  baseCents: number,
  s: PricingSettings,
  comDelivery = true,
): number {
  return baseCents + taxCents(baseCents, s.tax_rate) +
    (comDelivery ? s.delivery_fee_cents : 0)
}

/** Caminho inverso, para quem prefere digitar o preço de anúncio.
 *  Fica com o centavo do arredondamento quando a divisão não fecha exata —
 *  por isso a base é o campo canônico e este é o atalho. */
export function baseFromFinalCents(
  finalCents: number,
  s: PricingSettings,
  comDelivery = true,
): number {
  const semEntrega = finalCents - (comDelivery ? s.delivery_fee_cents : 0)
  return Math.round(semEntrega / (1 + s.tax_rate))
}

/** "56", "56.00", "$56.00", "56,00" → 5600 centavos. null se não for número. */
export function parseMoney(input: string): number | null {
  const limpo = input.replace(/[^\d.,-]/g, '').replace(',', '.')
  if (!limpo || !/^-?\d*\.?\d*$/.test(limpo)) return null
  const n = Number(limpo)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** 5600 → "56.00", para preencher input de edição (sem cifrão). */
export const moneyInput = (cents: number) => (cents / 100).toFixed(2)
