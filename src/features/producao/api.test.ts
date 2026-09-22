import { describe, expect, it } from 'vitest'
import { agrupar, type LinhaProducao } from './api'

const l = (
  prato: string, cat: string, size: string, qty: number, pos = 0,
): LinhaProducao => ({
  week_id: 'w', dish_id: prato, dish_name_pt: prato,
  category: cat as LinhaProducao['category'], size_code: size, qty,
  has_post_cutoff: false, qty_post_cutoff: 0, menu_position: pos,
})

describe('agrupar', () => {
  const TAM = ['S', 'L']

  // a cozinha monta olhando o menu: a folha em outra ordem vira busca item a
  // item, e quem monta doze sacolas seguidas não procura, erra
  it('ordena pela posição do menu, não pelo alfabeto', () => {
    const [g] = agrupar([
      l('Zuppa', 'classico', 'S', 1, 1),
      l('Arroz', 'classico', 'S', 1, 2),
      l('Moqueca', 'classico', 'S', 1, 3),
    ], TAM)
    expect(g.itens.map((i) => i.prato)).toEqual(['Zuppa', 'Arroz', 'Moqueca'])
  })

  it('prato fora do menu da semana vai para o fim, não some', () => {
    // pedido pós-cutoff com prato de outro ciclo: a view devolve 999999
    const [g] = agrupar([
      l('De outro menu', 'classico', 'S', 1, 999999),
      l('Do menu', 'classico', 'S', 1, 1),
    ], TAM)
    expect(g.itens.map((i) => i.prato)).toEqual(['Do menu', 'De outro menu'])
  })

  it('soma por prato e tamanho', () => {
    const [g] = agrupar([l('Moqueca', 'classico', 'S', 3), l('Moqueca', 'classico', 'L', 2)], TAM)
    expect(g.itens[0]).toMatchObject({ prato: 'Moqueca', total: 5 })
    expect(g.itens[0].porTamanho).toEqual({ S: 3, L: 2 })
  })

  // a view devolve uma linha por (prato, tamanho); pedidos diferentes com o
  // mesmo prato precisam somar, não sobrescrever
  it('acumula linhas repetidas do mesmo prato e tamanho', () => {
    const [g] = agrupar([l('Feijoada', 'classico', 'S', 2), l('Feijoada', 'classico', 'S', 3)], TAM)
    expect(g.itens[0].porTamanho.S).toBe(5)
  })

  it('separa por categoria e totaliza cada uma', () => {
    const gs = agrupar([
      l('Moqueca', 'classico', 'S', 3),
      l('Picadinho', 'brasileiro', 'S', 4),
      l('Bolo', 'breakfast', 'L', 2),
    ], TAM)
    expect(gs.map((g) => g.categoria).sort()).toEqual(['brasileiro', 'breakfast', 'classico'])
    expect(gs.find((g) => g.categoria === 'brasileiro')!.total).toBe(4)
  })

  it('totaliza a categoria por tamanho — é o número que vai para a bancada', () => {
    const [g] = agrupar([
      l('Moqueca', 'classico', 'S', 3), l('Moqueca', 'classico', 'L', 2),
      l('Salmão', 'classico', 'S', 1),
    ], TAM)
    expect(g.totais).toEqual({ S: 4, L: 2 })
    expect(g.total).toBe(6)
  })

  it('ordena os pratos por nome, para a folha sair sempre igual', () => {
    const [g] = agrupar([
      l('Zuppa', 'classico', 'S', 1), l('Almôndegas', 'classico', 'S', 1),
    ], TAM)
    expect(g.itens.map((i) => i.prato)).toEqual(['Almôndegas', 'Zuppa'])
  })

  it('não quebra com semana vazia', () => {
    expect(agrupar([], TAM)).toEqual([])
  })

  // a ordem das colunas vem do catálogo: alfabética poria Large antes de Small
  it('respeita a ordem de tamanhos que recebe', () => {
    const [g] = agrupar([l('Moqueca', 'classico', 'S', 3), l('Moqueca', 'classico', 'L', 2)], TAM)
    expect(Object.keys(g.totais)).toEqual(['S', 'L'])
  })
})
