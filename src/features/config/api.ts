import { supabase } from '../../lib/supabase'

export type Rota = { id: string; name: string; position: number; active: boolean }
export type ZipRow = {
  zip: string
  city: string
  state: string
  route_id: string
  active: boolean
}

export async function fetchZipsERotas() {
  const [zips, rotas] = await Promise.all([
    supabase.from('zip_codes').select('*').order('zip'),
    supabase.from('routes').select('*').eq('active', true).order('position'),
  ])
  if (zips.error) return { data: null, error: { message: zips.error.message } }
  if (rotas.error) return { data: null, error: { message: rotas.error.message } }
  return {
    error: null,
    data: { zips: (zips.data ?? []) as ZipRow[], rotas: (rotas.data ?? []) as Rota[] },
  }
}

/** upsert em lote: reimportar uma cidade não duplica nem apaga a rota que a
 *  equipe já tinha corrigido à mão — apenas atualiza. */
export const salvarZips = (linhas: Omit<ZipRow, 'active'>[]) =>
  supabase.from('zip_codes').upsert(
    linhas.map((l) => ({ ...l, active: true })),
    { onConflict: 'zip' },
  )

export const removerZip = (zip: string) =>
  supabase.from('zip_codes').delete().eq('zip', zip)

export const alternarZip = (zip: string, active: boolean) =>
  supabase.from('zip_codes').update({ active }).eq('zip', zip)

// ------------------------------------------------------------- origens (9d)
export type Origem = { id: string; name: string; kind: 'channel' | 'influencer'; active: boolean }

export async function fetchOrigens() {
  const { data, error } = await supabase.from('sources').select('*').order('kind').order('name')
  if (error) return { data: null, error: { message: error.message } }
  return { error: null, data: (data ?? []) as Origem[] }
}

export const salvarOrigem = (o: Partial<Origem> & { name: string }) =>
  o.id
    ? supabase.from('sources').update({ name: o.name, kind: o.kind }).eq('id', o.id)
    : supabase.from('sources').insert({ name: o.name, kind: o.kind ?? 'channel' })

export const alternarOrigem = (id: string, active: boolean) =>
  supabase.from('sources').update({ active }).eq('id', id)

/** Origem não se apaga quando já classificou cliente: some do formulário mas
 *  o histórico do Overview continua explicável. Quem não tem cliente nenhum
 *  pode sair de vez — cadastro errado não precisa virar cicatriz. */
export async function clientesDaOrigem(id: string) {
  const { count } = await supabase
    .from('customers').select('id', { count: 'exact', head: true }).eq('source_id', id)
  return count ?? 0
}

export const removerOrigem = (id: string) => supabase.from('sources').delete().eq('id', id)

// -------------------------------------------------------------- cutoff (9d)
export async function fetchCutoff() {
  const { data, error } = await supabase
    .from('settings').select('key, value').in('key', ['cutoff_weekday', 'cutoff_time', 'timezone'])
  if (error) return { data: null, error: { message: error.message } }
  const m = new Map((data ?? []).map((r) => [r.key, r.value]))
  return {
    error: null,
    data: {
      weekday: Number(m.get('cutoff_weekday') ?? 4),
      hora: String(m.get('cutoff_time') ?? '18:00'),
      fuso: String(m.get('timezone') ?? 'America/New_York'),
    },
  }
}

/** Vai por RPC, não por update direto: mudar o cutoff também realinha as
 *  semanas que ainda não terminaram (migration 1500). Pela tabela, a equipe
 *  salvaria e a semana em andamento continuaria com o horário antigo. */
export const salvarCutoff = (weekday: number, hora: string) =>
  supabase.rpc('fn_salvar_cutoff', { p_weekday: weekday, p_hora: hora })

// ------------------------------------------------ formas de pagamento (9d)
export type FormaPagamento = {
  id: string
  name_pt: string
  name_en: string
  instructions_pt: string | null
  instructions_en: string | null
  pay_link: string | null
  recipient_keys: string[]
  position: number
  active: boolean
}

export async function fetchFormas() {
  const { data, error } = await supabase.from('payment_methods').select('*').order('position')
  if (error) return { data: null, error: { message: error.message } }
  return { error: null, data: (data ?? []) as FormaPagamento[] }
}

export const salvarForma = (f: Partial<FormaPagamento>) =>
  f.id
    ? supabase.from('payment_methods').update({
        name_pt: f.name_pt, name_en: f.name_en,
        instructions_pt: f.instructions_pt, instructions_en: f.instructions_en,
        pay_link: f.pay_link, recipient_keys: f.recipient_keys,
      }).eq('id', f.id)
    : supabase.from('payment_methods').insert({
        name_pt: f.name_pt, name_en: f.name_en,
        instructions_pt: f.instructions_pt, instructions_en: f.instructions_en,
        pay_link: f.pay_link, recipient_keys: f.recipient_keys ?? [],
        position: f.position ?? 0,
      })

export const alternarForma = (id: string, active: boolean) =>
  supabase.from('payment_methods').update({ active }).eq('id', id)

export const removerForma = (id: string) =>
  supabase.from('payment_methods').delete().eq('id', id)

// ------------------------------------------------------------ mensagens (6p)
export type Template = { key: string; language: 'pt' | 'en'; body: string }

export async function fetchTemplates() {
  const { data, error } = await supabase
    .from('message_templates').select('key, language, body').order('key')
  if (error) return { data: null, error: { message: error.message } }
  return { error: null, data: (data ?? []) as Template[] }
}

export const salvarTemplate = (t: Template) =>
  supabase.from('message_templates')
    .upsert({ ...t, updated_at: new Date().toISOString() }, { onConflict: 'key,language' })

// -------------------------------------------------------- usuários (9d, 9e)
export type Usuario = {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'operacao' | 'cozinha'
  status: 'ativo' | 'convite_pendente' | 'desativado'
  invited_at: string | null
  created_at: string
}

export async function fetchUsuarios() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, status, invited_at, created_at')
    .order('full_name')
  if (error) return { data: null, error: { message: error.message } }
  return { error: null, data: (data ?? []) as Usuario[] }
}

/** Devolve o TOKEN, não manda e-mail: o convite é um link que o Administrador
 *  entrega pelo WhatsApp. Mandar e-mail exigiria SMTP no projeto, e a regra do
 *  §3 que importa — senha definida pela pessoa, expira em 7 dias, serve uma
 *  vez — não depende do meio. */
export const convidarUsuario = (email: string, nome: string, papel: Usuario['role']) =>
  supabase.rpc('fn_convidar_usuario', { p_email: email, p_nome: nome, p_papel: papel })

export const reenviarConvite = (id: string) =>
  supabase.rpc('fn_reenviar_convite', { p_user: id })

// Ambas por RPC, não por update na tabela: é lá que moram as travas de não
// mexer em si mesmo e de não deixar o sistema sem Administrador (migration 1600).
export const definirPapel = (id: string, papel: Usuario['role']) =>
  supabase.rpc('fn_definir_papel', { p_user: id, p_papel: papel })

export const definirStatus = (id: string, status: Usuario['status']) =>
  supabase.rpc('fn_definir_status', { p_user: id, p_status: status })
