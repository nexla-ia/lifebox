import { describe, expect, it } from 'vitest'
import { paraCSV, type LinhaPedido } from './semanaApi'

const linha = (over: Partial<LinhaPedido> = {}): LinhaPedido => ({
  customer_id: '1', order_status: 'novo_pedido', cliente: 'Ana Souza',
  telefone: '+16175550142', rota: 'Boston',
  order: {
    id: 'o1', code: 'W39-0001', total_cents: 14760, payment_status: 'confirmado',
    post_cutoff: false, plano: '10 Refeições', size: 'S', forma: 'Zelle',
  },
  ...over,
})

describe('paraCSV', () => {
  it('inclui cabeçalho e uma linha por registro', () => {
    const csv = paraCSV([linha(), linha({ cliente: 'Bruno' })])
    expect(csv.split('\n')).toHaveLength(3)
    expect(csv).toContain('"Cliente"')
  })

  it('exporta o valor em dólar, não em centavos', () => {
    expect(paraCSV([linha()])).toContain('"147.60"')
  })

  // nome com vírgula quebraria a coluna; com aspas, quebraria o campo
  it('escapa vírgula e aspas no conteúdo', () => {
    const csv = paraCSV([linha({ cliente: 'Souza, Ana "Aninha"' })])
    expect(csv).toContain('"Souza, Ana ""Aninha"""')
    // a linha continua com o mesmo número de campos
    expect(csv.split('\n')[1].match(/","/g)?.length).toBe(10)
  })

  it('deixa vazio quem não tem pedido — Skip existe sem pedido (§6.3)', () => {
    const csv = paraCSV([linha({ order_status: 'skip', order: null })])
    expect(csv).toContain('"skip"')
    expect(csv.split('\n')[1]).toContain('"","","","","",')
  })

  it('marca o pós-cutoff', () => {
    const l = linha()
    l.order!.post_cutoff = true
    expect(paraCSV([l])).toContain('"sim"')
  })
})
