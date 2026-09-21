import { describe, expect, it } from 'vitest'
import { apenasDecimal, apenasDigitos } from './numero'

describe('apenasDigitos', () => {
  it('descarta letra na digitação', () => {
    // o caso que apareceu na tela: "10 ref" entrava e só reclamava no Salvar
    expect(apenasDigitos('10 ref')).toBe('10')
    expect(apenasDigitos('abc')).toBe('')
  })

  it('descarta sinal, ponto e espaço', () => {
    expect(apenasDigitos('-5')).toBe('5')
    expect(apenasDigitos('1.5')).toBe('15')
    expect(apenasDigitos(' 7 ')).toBe('7')
  })

  it('deixa o campo esvaziar', () => {
    // apagar tudo para redigitar é uso normal; forçar '0' faria o cursor
    // brigar com quem está corrigindo o número
    expect(apenasDigitos('')).toBe('')
  })
})

describe('apenasDecimal', () => {
  it('aceita vírgula e devolve ponto', () => {
    // teclado de celular em português dá vírgula; Number() só lê ponto
    expect(apenasDecimal('12,50')).toBe('12.50')
  })

  it('mantém um separador só', () => {
    expect(apenasDecimal('12.3.4')).toBe('12.34')
    expect(apenasDecimal('1,2,3')).toBe('1.23')
  })

  it('corta além das casas pedidas', () => {
    expect(apenasDecimal('9.999')).toBe('9.99')
  })

  it('descarta letra e símbolo', () => {
    expect(apenasDecimal('$ 12,50 cada')).toBe('12.50')
  })

  it('deixa digitar o separador antes do centavo', () => {
    // estado intermediário de quem está digitando "12.5": sem isso o ponto
    // some assim que é digitado e a pessoa não consegue passar dele
    expect(apenasDecimal('12.')).toBe('12.')
  })
})
