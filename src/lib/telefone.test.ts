import { describe, expect, it } from 'vitest'
import { formatarTelefone, linkWhatsApp, normalizarTelefone } from './telefone'

describe('normalizarTelefone', () => {
  it('converte os formatos que aparecem na planilha real da W37', () => {
    expect(normalizarTelefone('(781) 518-6457')).toBe('+17815186457')
    expect(normalizarTelefone('774-239-8922')).toBe('+17742398922')
    expect(normalizarTelefone('7819291049')).toBe('+17819291049')
    expect(normalizarTelefone(' (508) 555-0164 ')).toBe('+15085550164')
  })

  it('aceita o que já vem com código do país', () => {
    expect(normalizarTelefone('1 508 555 0164')).toBe('+15085550164')
    expect(normalizarTelefone('+1 (508) 555-0164')).toBe('+15085550164')
    expect(normalizarTelefone('+15085550164')).toBe('+15085550164')
  })

  it('preserva número internacional com +', () => {
    expect(normalizarTelefone('+5511987654321')).toBe('+5511987654321')
  })

  it('é idempotente — normalizar duas vezes não muda', () => {
    const uma = normalizarTelefone('(617) 555-0142')!
    expect(normalizarTelefone(uma)).toBe(uma)
  })

  // recusar é mais seguro que chutar: número errado vira cliente duplicado e
  // some da automação do WhatsApp
  it('recusa o que é ambíguo ou incompleto', () => {
    expect(normalizarTelefone('')).toBeNull()
    expect(normalizarTelefone('555-0164')).toBeNull()      // 7 dígitos, sem DDD
    expect(normalizarTelefone('123456789')).toBeNull()     // 9 dígitos
    expect(normalizarTelefone('25085550164')).toBeNull()   // 11 sem começar em 1
    expect(normalizarTelefone('abc')).toBeNull()
  })
})

describe('formatarTelefone', () => {
  it('mostra no formato que a equipe lê', () => {
    expect(formatarTelefone('+15085550164')).toBe('(508) 555-0164')
  })

  it('deixa internacional intacto', () => {
    expect(formatarTelefone('+5511987654321')).toBe('+5511987654321')
  })
})

describe('linkWhatsApp', () => {
  it('monta o link da conversa', () => {
    expect(linkWhatsApp('+15085550164')).toBe('https://wa.me/15085550164')
  })
})
