import { supabase } from '../../lib/supabase'

/* Primeiro acesso por convite (§3 · tela 9e).
 *
 * Quem abre este link ainda não tem sessão: as duas funções atendem o role
 * `anon` de propósito, e o token é a única credencial. Por isso ele é longo,
 * de uso único e expira em 7 dias (migration 1600). */

export type Convite =
  | { valido: false }
  | {
      valido: true
      nome: string
      email: string
      papel: 'admin' | 'operacao' | 'cozinha'
      convidou: string | null
      expira_em: string
    }

export const lerConvite = (token: string) =>
  supabase.rpc('fn_convite', { p_token: token })

export const aceitarConvite = (token: string, senha: string) =>
  supabase.rpc('fn_aceitar_convite', { p_token: token, p_senha: senha })
