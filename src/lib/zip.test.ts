import { afterEach, describe, expect, it, vi } from 'vitest'
import { consultarZip, normalizarZip, zipsDaCidade } from './zip'

afterEach(() => vi.unstubAllGlobals())

const responder = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))

describe('normalizarZip', () => {
  it('aceita o que uma pessoa realmente digita', () => {
    expect(normalizarZip('02151')).toBe('02151')
    expect(normalizarZip(' 02151 ')).toBe('02151')
    expect(normalizarZip('02151-1234')).toBe('02151') // ZIP+4
    expect(normalizarZip('02151 1234')).toBe('02151')
  })

  it('recusa o que não é ZIP', () => {
    expect(normalizarZip('')).toBeNull()
    expect(normalizarZip('021')).toBeNull()
    expect(normalizarZip('abcde')).toBeNull()
  })
})

describe('consultarZip', () => {
  it('traz cidade e estado', async () => {
    responder({
      'post code': '02151',
      places: [{ 'place name': 'Revere', 'state abbreviation': 'MA' }],
    })
    expect(await consultarZip('02151')).toEqual({ zip: '02151', city: 'Revere', state: 'MA' })
  })

  it('devolve null em ZIP inexistente, sem estourar', async () => {
    responder({}, false)
    expect(await consultarZip('00001')).toBeNull()
  })

  // o formulário do cliente não pode quebrar porque uma API de terceiro caiu
  it('devolve null quando a rede falha, sem lançar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(consultarZip('02472')).resolves.toBeNull()
  })

  it('não consulta duas vezes o mesmo ZIP', async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ places: [{ 'place name': 'Malden', 'state abbreviation': 'MA' }] }),
    }))
    vi.stubGlobal('fetch', f)
    await consultarZip('02148')
    await consultarZip('02148')
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('zipsDaCidade', () => {
  it('traz todos os ZIPs — é assim que a lista da LifeBox é montada', async () => {
    responder({
      'place name': 'Framingham',
      places: [
        { 'post code': '01701', 'place name': 'Framingham' },
        { 'post code': '01702', 'place name': 'Framingham' },
      ],
    })
    expect(await zipsDaCidade('framingham')).toEqual([
      { zip: '01701', city: 'Framingham', state: 'MA' },
      { zip: '01702', city: 'Framingham', state: 'MA' },
    ])
  })

  it('devolve null em cidade desconhecida', async () => {
    responder({ places: [] })
    expect(await zipsDaCidade('cidade que nao existe')).toBeNull()
  })

  it('ignora entrada vazia sem chamar a rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await zipsDaCidade('   ')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
