import { describe, expect, it } from 'vitest'
import { baseFromFinalCents, finalPriceCents, moneyInput, parseMoney, taxCents } from './precos'

// mesmos parâmetros do seed base (§5.6)
const s = { tax_rate: 0.07, delivery_fee_cents: 1000, service_fee_cents: 175 }

describe('espelho do cálculo do servidor', () => {
  it('bate com os casos do fn_price_order', () => {
    // §5.6: 13935 tributável → tax 975 (13935 * 0.07 = 975.45, half-up)
    expect(taxCents(13935, 0.07)).toBe(975)
    // tela 6i: 16974 → 1188.18 → 1188
    expect(taxCents(16974, 0.07)).toBe(1188)
    // plano 10+5 Small exato: 12860 + 900 + 1000 = 14760
    expect(finalPriceCents(12860, s)).toBe(14760)
  })

  it('pick-up não soma delivery (§6.6)', () => {
    expect(finalPriceCents(12860, s, false)).toBe(13760)
  })

  it('reproduz a tabela de preço final do §5.1', () => {
    // base do documento → total exibido
    expect(finalPriceCents(5600, s)).toBe(6992)   // 5 Meals Small  → $69.92
    expect(finalPriceCents(12860, s)).toBe(14760) // 10+5 Small     → $147.60
    expect(finalPriceCents(15715, s)).toBe(17815) // 10+5 Large     → $178.15
  })
})

describe('caminho inverso, para quem digita o preço de anúncio', () => {
  it('volta à base nos valores do catálogo', () => {
    for (const base of [5600, 6505, 10745, 12585, 7750, 9635, 12860, 15715]) {
      expect(baseFromFinalCents(finalPriceCents(base, s), s)).toBe(base)
    }
  })
})

describe('entrada de dinheiro', () => {
  it('aceita os formatos que alguém realmente digita', () => {
    expect(parseMoney('56')).toBe(5600)
    expect(parseMoney('56.00')).toBe(5600)
    expect(parseMoney('$56.00')).toBe(5600)
    expect(parseMoney('56,50')).toBe(5650)
    expect(parseMoney('  128.60 ')).toBe(12860)
  })

  it('recusa o que não é valor', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney('1.2.3')).toBeNull()
  })

  it('formata para o input sem cifrão', () => {
    expect(moneyInput(12860)).toBe('128.60')
    expect(moneyInput(5600)).toBe('56.00')
  })
})
