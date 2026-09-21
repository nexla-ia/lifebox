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
