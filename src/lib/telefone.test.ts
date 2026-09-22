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

  // brasileiro recém-chegado em Boston costuma manter o número do Brasil no
  // WhatsApp — e é o WhatsApp que cruza cliente e pedido (§2)
  it('aceita número do Brasil, com ou sem o +', () => {
    expect(normalizarTelefone('+55 69 99269-5898')).toBe('+5569992695898')
    expect(normalizarTelefone('5569992695898')).toBe('+5569992695898')
    expect(normalizarTelefone('55 11 3456-7890')).toBe('+551134567890')  // fixo
  })

  it('não chuta +55 em número curto: 10 dígitos continuam sendo dos EUA', () => {
    // 551 é código de área de New Jersey; tratar como Brasil criaria cliente
    // duplicado e sumiria com ele na automação
    expect(normalizarTelefone('5512345678')).toBe('+15512345678')
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

  it('mostra o do Brasil no formato de lá', () => {
    expect(formatarTelefone('+5569992695898')).toBe('+55 (69) 99269-5898')
    expect(formatarTelefone('+551134567890')).toBe('+55 (11) 3456-7890')
  })

  it('deixa outro país intacto', () => {
    expect(formatarTelefone('+351912345678')).toBe('+351912345678')
  })
})

describe('linkWhatsApp', () => {
  it('monta o link da conversa', () => {
    expect(linkWhatsApp('+15085550164')).toBe('https://wa.me/15085550164')
  })
})
