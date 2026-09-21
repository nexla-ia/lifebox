import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/** Sem as variáveis o app não tem o que fazer, mas NÃO pode explodir no import:
 *  exceção em escopo de módulo mata o bundle antes do React montar e o usuário
 *  vê tela branca. Quem checa isto é o main.tsx, que troca o app pela tela de
 *  configuração. Nenhuma tela branca (§8, tela 9f). */
export const isConfigured = Boolean(url && anon)

// Os valores de fallback existem só para o construtor não reclamar de URL
// inválida; quando isConfigured é false este client nunca chega a ser usado.
export const supabase = createClient(
  url || 'http://localhost',
  anon || 'sem-chave',
)

/** Centavos → "$1,005.47". Todo valor no banco é integer em centavos (§2). */
export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
