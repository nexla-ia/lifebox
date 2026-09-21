import { readFileSync } from 'node:fs'

/** Limpeza do e2e via REST puro.
 *
 *  Usa fetch em vez de @supabase/supabase-js de propósito: o runner do
 *  Playwright resolve o pacote para os fontes .ts e quebra com
 *  "Unexpected module status 3". A API é simples o bastante para não
 *  valer a briga.
 *
 *  Lê .env.local (gitignored) para o teste rodar como `npm run dev` roda. */

function envLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=')
          return [l.slice(0, i), l.slice(i + 1)]
        }),
    )
  } catch {
    return {}
  }
}

type Conexao = { url: string; key: string; token: string }
let cache: Conexao | null = null

async function conectar(): Promise<Conexao | null> {
  if (cache) return cache
  const env = envLocal()
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_SENHA
  if (!url || !key || !email || !password) return null

  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) return null
  const { access_token } = (await r.json()) as { access_token?: string }
  if (!access_token) return null

  cache = { url, key, token: access_token }
  return cache
}

/** Apaga tudo que carrega a marca do teste. Preços e variações caem por
 *  cascade do plano / do adicional. */
export async function limparMarca(marca: string) {
  const c = await conectar()
  if (!c) return
  const headers = {
    apikey: c.key,
    Authorization: `Bearer ${c.token}`,
    Prefer: 'return=minimal',
  }
  for (const tabela of ['addons', 'plans']) {
    await fetch(
      `${c.url}/rest/v1/${tabela}?name_pt=like.${encodeURIComponent(`%${marca}%`)}`,
      { method: 'DELETE', headers },
    )
  }
}

/** Remove ZIPs específicos criados por um teste. */
export async function limparZips(zips: string[]) {
  const c = await conectar()
  if (!c || zips.length === 0) return
  await fetch(
    `${c.url}/rest/v1/zip_codes?zip=in.(${zips.join(',')})`,
    {
      method: 'DELETE',
      headers: { apikey: c.key, Authorization: `Bearer ${c.token}`, Prefer: 'return=minimal' },
    },
  )
}

/** Remove pratos do teste. Vínculos de menu, tag, alérgeno e tamanho caem por
 *  cascade; a foto no bucket é lixo inofensivo de 1 px. */
export async function limparPratos(marca: string) {
  const c = await conectar()
  if (!c) return
  await fetch(
    `${c.url}/rest/v1/dishes?name_pt=like.${encodeURIComponent(`%${marca}%`)}`,
    {
      method: 'DELETE',
      headers: { apikey: c.key, Authorization: `Bearer ${c.token}`, Prefer: 'return=minimal' },
    },
  )
}

async function rest(caminho: string, init: RequestInit = {}) {
  const c = await conectar()
  if (!c) return null
  return fetch(`${c.url}/rest/v1/${caminho}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
}

/** Cria um ZIP atendido para o teste, na primeira rota ativa. */
export async function criarZipTeste(zip: string, city: string) {
  const r = await rest('routes?select=id&active=eq.true&limit=1')
  if (!r) return
  const [rota] = (await r.json()) as { id: string }[]
  await rest('zip_codes', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ zip, city, state: 'MA', route_id: rota.id, active: true }),
  })
}

export async function limparZip(zip: string) {
  await rest(`zip_codes?zip=eq.${zip}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}

/** Remove clientes do teste pelo telefone, que é a chave única. */
export async function limparClientes(telefones: string[]) {
  if (!telefones.length) return
  // encodeURIComponent é obrigatório: o "+" do E.164 vira espaço numa query
  // string, o filtro não casa e o cliente de teste fica no banco da cliente.
  const lista = telefones.map((t) => encodeURIComponent(t)).join(',')
  await rest(`customers?phone_e164=in.(${lista})`, {
    method: 'DELETE', headers: { Prefer: 'return=minimal' },
  })
}

/** Massa para o teste de pedido: plano com preços, pratos no menu da semana
 *  corrente e um cliente. Devolve o que precisa ser apagado depois. */
export async function criarFixturePedido(marca: string) {
  const c = await conectar()
  if (!c) return null
  const post = async (t: string, body: unknown) => {
    const r = await rest(t, { method: 'POST', body: JSON.stringify(body) })
    return (await r!.json()) as Record<string, string>[]
  }
  const get = async (q: string) => {
    const r = await rest(q)
    return (await r!.json()) as Record<string, string>[]
  }

  const [small] = await get('sizes?select=id&code=eq.S')
  const [plano] = await post('plans', {
    name_pt: `Plano ${marca}`, name_en: `Plan ${marca}`,
    meals_qty: 10, breakfasts_qty: 5, active: true,
  })
  await post('plan_prices', { plan_id: plano.id, size_id: small.id, base_price_cents: 12860 })
  await post('extra_prices', [
    { plan_id: plano.id, size_id: small.id, item_kind: 'meal', unit_price_cents: 1075 },
    { plan_id: plano.id, size_id: small.id, item_kind: 'breakfast', unit_price_cents: 423 },
  ])

  const pratos = await post('dishes', [
    { name_pt: `Prato ${marca}`, name_en: `Dish ${marca}`, category: 'classico', active: true },
    { name_pt: `Bkf ${marca}`, name_en: `Bkf ${marca}`, category: 'breakfast', active: true },
  ])

  // liga os pratos no menu da semana corrente
  const r = await fetch(`${c.url}/rest/v1/rpc/fn_semana_atual`, {
    method: 'POST',
    headers: { apikey: c.key, Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const weekId = (await r.json()) as string
  const [semana] = await get(`weeks?select=menu_id,iso_code&id=eq.${weekId}`)
  await post('menu_dishes', pratos.map((p) => ({
    menu_id: semana.menu_id, dish_id: p.id, active: true,
  })))

  const telefone = `+1555${marca}`
  const [cliente] = await post('customers', {
    first_name: `Cliente ${marca}`, phone_e164: telefone, status: 'ativo',
  })

  return {
    planoId: plano.id, sizeId: small.id, pratoId: pratos[0].id, bkfId: pratos[1].id,
    clienteId: cliente.id, telefone, weekId, isoCode: semana.iso_code,
  }
}

export async function limparFixturePedido(marca: string, telefone: string) {
  // ORDEM IMPORTA: orders.customer_id NÃO tem ON DELETE CASCADE, então apagar
  // o cliente antes é recusado em silêncio e tudo fica no banco da cliente.
  const r = await rest(`customers?select=id&phone_e164=eq.${encodeURIComponent(telefone)}`)
  const [cli] = r ? ((await r.json()) as { id: string }[]) : []
  if (cli) {
    await rest(`orders?customer_id=eq.${cli.id}`,
               { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  }
  await limparClientes([telefone])
  await limparPratos(marca)
  await rest(`plans?name_pt=like.${encodeURIComponent(`%${marca}%`)}`,
             { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}

/** Remove a meta da semana criada por teste. */
export async function limparMeta(isoCode: string) {
  await rest(`goals?period_type=eq.week&period_key=eq.${encodeURIComponent(isoCode)}`,
             { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}
