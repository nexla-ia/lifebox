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
