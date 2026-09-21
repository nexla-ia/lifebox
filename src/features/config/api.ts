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
