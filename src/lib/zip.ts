/* Consulta de ZIP code — o equivalente americano do CEP.
 *
 * DUAS COISAS DIFERENTES, e misturá-las seria um erro grave:
 *
 *   1. "que cidade é esse ZIP"  → conveniência. Pode vir de fora, pode falhar,
 *      pode ficar fora do ar. O formulário continua funcionando: a pessoa
 *      digita a cidade à mão.
 *
 *   2. "nós entregamos nesse ZIP" → regra de negócio da LifeBox (§6.1). Quem
 *      responde é SEMPRE a tabela zip_codes. Nenhuma API externa decide se um
 *      pedido pode ser fechado.
 *
 * Este arquivo cuida só do item 1. O item 2 vive em zip_codes + RLS.
 *
 * Fonte: api.zippopotam.us — pública, sem chave, sem cadastro. Um ZIP sozinho
 * não identifica ninguém, então a consulta não expõe dado pessoal.
 */

export type LocalZip = { zip: string; city: string; state: string }

const TIMEOUT_MS = 4000
const cache = new Map<string, LocalZip | null>()

/** "02151-1234", " 02151 ", "2151" → "02151". null se não der 5 dígitos. */
export function normalizarZip(bruto: string): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '')
  if (digitos.length < 5) return null
  return digitos.slice(0, 5)
}

async function buscar(url: string): Promise<unknown | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json()
  } catch {
    // rede fora, timeout, CORS — nada disso pode derrubar o formulário
    return null
  } finally {
    clearTimeout(t)
  }
}

type RespostaZip = {
  'post code'?: string
  places?: { 'place name'?: string; 'state abbreviation'?: string; state?: string }[]
}

/** ZIP → cidade e estado. Devolve null quando não existe ou a consulta falha —
 *  quem chama trata os dois casos como "preenche à mão". */
export async function consultarZip(bruto: string): Promise<LocalZip | null> {
  const zip = normalizarZip(bruto)
  if (!zip) return null
  if (cache.has(zip)) return cache.get(zip) ?? null

  const json = (await buscar(`https://api.zippopotam.us/us/${zip}`)) as RespostaZip | null
  const lugar = json?.places?.[0]
  const resultado: LocalZip | null =
    lugar?.['place name'] && lugar['state abbreviation']
      ? { zip, city: lugar['place name']!, state: lugar['state abbreviation']! }
      : null

  cache.set(zip, resultado)
  return resultado
}

type RespostaCidade = {
  'place name'?: string
  places?: { 'post code'?: string; 'place name'?: string }[]
}

/** Cidade → todos os ZIPs dela.
 *
 *  É o caminho que a LifeBox realmente usa: a equipe sabe de cor as cidades que
 *  atende, não os 84 CEPs. Digitar "Framingham" traz os 5 ZIPs de uma vez. */
export async function zipsDaCidade(
  cidade: string,
  uf = 'MA',
): Promise<LocalZip[] | null> {
  const nome = (cidade ?? '').trim()
  if (!nome) return null

  const json = (await buscar(
    `https://api.zippopotam.us/us/${uf.toLowerCase()}/${encodeURIComponent(nome.toLowerCase())}`,
  )) as RespostaCidade | null
  if (!json?.places?.length) return null

  const oficial = json['place name'] ?? nome
  return json.places
    .map((p) => ({
      zip: normalizarZip(p['post code'] ?? '') ?? '',
      city: p['place name'] ?? oficial,
      state: uf.toUpperCase(),
    }))
    .filter((p) => p.zip !== '')
}
