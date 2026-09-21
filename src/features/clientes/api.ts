import { supabase } from '../../lib/supabase'
import type { Plan, Size } from '../../lib/types'
import type { Rota } from '../config/api'

export type LeadType = 'new' | 'old'
export type StatusCliente = 'ativo' | 'pausado' | 'cancelado' | 'lead'
export type Fulfillment = 'delivery' | 'pickup'

export type Cliente = {
  id: string
  first_name: string
  last_name: string | null
  phone_e164: string
  email: string | null
  street_address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  route_id: string | null
  source_id: string | null
  lead_type: LeadType
  status: StatusCliente
  fulfillment_preference: Fulfillment
  uses_thermal_bag: boolean
  default_plan_id: string | null
  default_size_id: string | null
  delivery_notes: string | null
  office_notes: string | null
  kitchen_notes: string | null
  created_at: string
}

export type Origem = { id: string; name: string; kind: 'channel' | 'influencer' }

export type DadosClientes = {
  clientes: Cliente[]
  rotas: Rota[]
  origens: Origem[]
  planos: Plan[]
  tamanhos: Size[]
}

export async function fetchClientes() {
  const [clientes, rotas, origens, planos, tamanhos] = await Promise.all([
    supabase.from('customers').select('*').order('first_name'),
    supabase.from('routes').select('*').eq('active', true).order('position'),
    supabase.from('sources').select('id, name, kind').eq('active', true).order('name'),
    supabase.from('plans').select('*').eq('active', true).order('position'),
    supabase.from('sizes').select('*').eq('active', true).order('position'),
  ])
  const falha = [clientes, rotas, origens, planos, tamanhos].find((r) => r.error)
  if (falha?.error) return { data: null, error: { message: falha.error.message } }

  return {
    error: null,
    data: {
      clientes: (clientes.data ?? []) as Cliente[],
      rotas: (rotas.data ?? []) as Rota[],
      origens: (origens.data ?? []) as Origem[],
      planos: (planos.data ?? []) as Plan[],
      tamanhos: (tamanhos.data ?? []) as Size[],
    } satisfies DadosClientes,
  }
}

export type LinhaHistorico = {
  week_iso: string
  week_starts: string
  order_code: string | null
  plano: string | null
  total_cents: number
  payment_status: string
  order_status: string
  post_cutoff: boolean
}

/** Histórico por semana (tela 4b). Vem de customer_weeks, não de orders: é lá
 *  que Skip, Follow-up e Cancelamento existem sem pedido (§6.3). */
export async function fetchHistorico(customerId: string) {
  const { data, error } = await supabase
    .from('customer_weeks')
    .select(`
      order_status,
      weeks!inner(iso_code, starts_on),
      orders(code, total_cents, payment_status, post_cutoff, plans(name_pt))
    `)
    .eq('customer_id', customerId)
    .order('starts_on', { referencedTable: 'weeks', ascending: false })

  if (error) return { data: null, error: { message: error.message } }

  type Bruto = {
    order_status: string
    weeks: { iso_code: string; starts_on: string }
    orders: {
      code: string; total_cents: number; payment_status: string
      post_cutoff: boolean; plans: { name_pt: string } | null
    } | null
  }

  return {
    error: null,
    data: (data as unknown as Bruto[]).map((l) => ({
      week_iso: l.weeks.iso_code,
      week_starts: l.weeks.starts_on,
      order_code: l.orders?.code ?? null,
      plano: l.orders?.plans?.name_pt ?? null,
      total_cents: l.orders?.total_cents ?? 0,
      payment_status: l.orders?.payment_status ?? '—',
      order_status: l.order_status,
      post_cutoff: l.orders?.post_cutoff ?? false,
    })) satisfies LinhaHistorico[],
  }
}

/** §6.1: o ZIP sugere a rota e diz se atendemos. Quem responde é a tabela —
 *  a consulta externa só preenche cidade (ver src/lib/zip.ts). */
export async function conferirZip(zip: string) {
  const { data, error } = await supabase
    .from('zip_codes')
    .select('zip, city, state, route_id, active')
    .eq('zip', zip)
    .maybeSingle()
  if (error) return { atendido: false, linha: null, error: { message: error.message } }
  return {
    atendido: Boolean(data?.active),
    linha: data as { zip: string; city: string; state: string; route_id: string } | null,
    error: null,
  }
}

export type ClienteParaSalvar = Omit<Cliente, 'id' | 'created_at' | 'lead_type'> & {
  id?: string
  /** só na criação: depois o trigger impede voltar para 'new' (§6.2) */
  lead_type?: LeadType
}

export const salvarCliente = (c: ClienteParaSalvar) =>
  c.id
    ? supabase.from('customers').update(c).eq('id', c.id).select('id').single()
    : supabase.from('customers').insert(c).select('id').single()
