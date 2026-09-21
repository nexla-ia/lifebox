import { describe, expect, it } from 'vitest'
import { filtrarClientes } from './filtro'
import type { Cliente } from './api'

const base = {
  last_name: null, email: null, street_address: null, state: 'MA',
  source_id: null, lead_type: 'new', fulfillment_preference: 'delivery',
  uses_thermal_bag: true, default_plan_id: null, default_size_id: null,
  delivery_notes: null, office_notes: null, kitchen_notes: null,
  created_at: '2026-01-01',
} as const

const clientes = [
  { ...base, id: '1', first_name: 'Felipe', last_name: 'Cardoso', phone_e164: '+15085550164',
    zip_code: '01581', city: 'Westborough', route_id: 'r1', status: 'ativo' },
  { ...base, id: '2', first_name: 'Ana', last_name: 'Souza', phone_e164: '+16175550142',
    zip_code: '02151', city: 'Revere', route_id: 'r2', status: 'pausado' },
  { ...base, id: '3', first_name: 'Mariana', last_name: null, phone_e164: '+17815550288',
    zip_code: null, city: null, route_id: 'r1', status: 'lead' },
] as unknown as Cliente[]

const tudo = { busca: '', status: 'todos', rotaId: '' } as const
const nomes = (r: Cliente[]) => r.map((c) => c.first_name)

describe('filtrarClientes', () => {
  it('sem critério devolve todos', () => {
    expect(filtrarClientes(clientes, tudo)).toHaveLength(3)
  })

  // o bug: "zzz".replace(/\D/g,'') === '' e '+1508...'.includes('') é true,
  // então toda busca por nome casava com todo mundo
  it('busca sem resultado devolve vazio — não a lista inteira', () => {
    expect(filtrarClientes(clientes, { ...tudo, busca: 'zzz-nao-existe' })).toEqual([])
  })

  it('acha por nome e por sobrenome, sem diferenciar maiúscula', () => {
    expect(nomes(filtrarClientes(clientes, { ...tudo, busca: 'feli' }))).toEqual(['Felipe'])
    expect(nomes(filtrarClientes(clientes, { ...tudo, busca: 'SOUZA' }))).toEqual(['Ana'])
  })

  it('acha por telefone com ou sem formatação', () => {
    expect(nomes(filtrarClientes(clientes, { ...tudo, busca: '5085550164' }))).toEqual(['Felipe'])
    expect(nomes(filtrarClientes(clientes, { ...tudo, busca: '(617) 555-0142' }))).toEqual(['Ana'])
  })

  it('acha por ZIP', () => {
    expect(nomes(filtrarClientes(clientes, { ...tudo, busca: '02151' }))).toEqual(['Ana'])
  })

  it('não quebra com cliente sem sobrenome nem ZIP', () => {
    expect(nomes(filtrarClientes(clientes, { ...tudo, busca: 'mariana' }))).toEqual(['Mariana'])
  })

  it('filtra por status e por rota', () => {
    expect(nomes(filtrarClientes(clientes, { ...tudo, status: 'ativo' }))).toEqual(['Felipe'])
    expect(nomes(filtrarClientes(clientes, { ...tudo, rotaId: 'r1' }))).toEqual(['Felipe', 'Mariana'])
  })

  it('combina busca com filtro', () => {
    expect(filtrarClientes(clientes, { busca: 'a', status: 'ativo', rotaId: 'r2' })).toEqual([])
  })
})
