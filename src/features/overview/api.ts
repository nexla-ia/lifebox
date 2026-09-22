import { supabase } from '../../lib/supabase'

/* Overview · Módulo 2 (§10). Ref: protótipo 8a, 8b, 8c, 8d, 8f.
 *
 * Tudo é derivado no servidor. Nada aqui soma, acumula ou guarda: se um pedido
 * mudar de status, o número muda junto na próxima consulta — e o mesmo número
 * aparece igual na Semana, na Produção e aqui, porque sai do mesmo lugar. */

export type Tipo = 'week' | 'month' | 'year'

export type Periodo = {
  tipo: Tipo
  chave: string
  inicio: string | null
  fim: string | null
  semanas: string[]
  em_andamento: boolean
}

export type Overview = {
  periodo: Periodo
  meta_cents: number
  faturamento: {
    total_cents: number
    faturado_cents: number
    a_receber_cents: number
    pct_meta: number | null
  }
  pedidos: {
    /** conta PEDIDOS. `clientes` conta PESSOAS — divergem quando alguém pede
     *  duas vezes na semana (reunião de 22/09/2026) */
    total: number; clientes: number; novo: number; renovacao: number
    skip: number; cancelamento: number; parceria: number
    aguardando_selecao: number
  }
  ticket_medio_cents: number | null
  ticket_pagos: number
  ticket_por_pedido_cents: number | null
  renovacao: { base: number; renovou: number; taxa: number | null }
  leads: {
    novos: number; convertidos: number; follow_up: number
    conversao: number | null
    ads_leads: number; ads_convertidos: number; ads_conversao: number | null
    ads_revenue_cents: number
    origens: { nome: string; leads: number; convertidos: number; pct: number | null }[]
  }
  mix_planos: { plano: string; qtd: number }[]
  mix_tamanhos: { size: string; qtd: number }[]
  adicionais: { nome: string; qtd: number; valor_cents: number }[]
  parcerias: { qtd: number; valor_comercial_cents: number }
  top_pratos: { nome: string; qtd: number }[]
}

export type PontoSerie = {
  chave: string
  rotulo: string
  total_cents: number
  faturado_cents: number
  meta_cents: number
  ano_anterior_cents: number
  novo: number
  renovacao: number
  skip: number
  cancelamento: number
  em_andamento: boolean
}

export type LinhaLista = {
  customer_id: string
  cliente: string
  code: string | null
  plano: string | null
  tamanho: string | null
  rota: string | null
  total_cents: number | null
  pagamento: string | null
  status: string
}

const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as T, error: null }
}

export const fetchPeriodos = (tipo: Tipo) =>
  rpc<string[]>('fn_overview_periodos', { p_tipo: tipo })

export const fetchOverview = (tipo: Tipo, chave: string) =>
  rpc<Overview>('fn_overview', { p_tipo: tipo, p_chave: chave })

export const fetchSerie = (tipo: Tipo, chave: string, n = 5) =>
  rpc<PontoSerie[]>('fn_overview_serie', { p_tipo: tipo, p_chave: chave, p_n: n })

export const fetchLista = (tipo: Tipo, chave: string, recorte: string) =>
  rpc<LinhaLista[]>('fn_overview_lista', { p_tipo: tipo, p_chave: chave, p_recorte: recorte })

export const salvarMeta = (tipo: 'week' | 'month', chave: string, cents: number) =>
  supabase.from('goals').upsert(
    { period_type: tipo, period_key: chave, amount_cents: cents },
    { onConflict: 'period_type,period_key' },
  )

/** Rótulo curto do período: 'W38', 'set/2026', '2026'. O ISO completo
 *  ('2026-W38') só aparece onde precisa desambiguar o ano. */
export function rotulo(tipo: Tipo, chave: string): string {
  if (tipo === 'week') return chave.replace(/^\d+-/, '')
  if (tipo === 'year') return chave
  const [a, m] = chave.split('-').map(Number)
  // chave fora do formato do tipo devolve ela mesma, em vez de "Invalid Date":
  // rótulo errado se lê e se corrige, "Invalid Date" só assusta
  if (!Number.isFinite(a) || !Number.isFinite(m)) return chave
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

/** Variação percentual entre dois números, para os "▲ 4,3% vs W37".
 *  Devolve null quando não há base — crescer sobre zero não é percentual. */
export function variacao(agora: number, antes: number): number | null {
  if (!antes) return null
  return ((agora - antes) / antes) * 100
}
