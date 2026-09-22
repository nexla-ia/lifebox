import { supabase } from '../../lib/supabase'
import type { DishCategory } from '../../lib/types'

/* Produção da cozinha. Ref: protótipo 3a, 3b, 3c, 3d.
 *
 * A Cozinha só alcança v_production e v_kitchen_notes (§3) — são views que
 * rodam como dona e devolvem contagem agregada e restrições, sem valor,
 * contato ou endereço. A MATRIZ mostra nome de cliente, então é consulta
 * direta a order_items e só Admin e Operação conseguem lê-la: para a Cozinha
 * a RLS devolve vazio. */

export type LinhaProducao = {
  week_id: string
  dish_id: string | null
  dish_name_pt: string
  category: DishCategory | null
  size_code: string | null
  qty: number
  has_post_cutoff: boolean
  qty_post_cutoff: number | null
  /** posição do prato no menu da semana. 999999 = não está no menu deste
   *  ciclo (pedido pós-cutoff com prato de outro menu) e vai para o fim */
  menu_position: number
}

export type NotaCozinha = {
  week_id: string
  order_id: string
  customer_label: string
  kitchen_notes: string
}

export type Producao = {
  linhas: LinhaProducao[]
  notas: NotaCozinha[]
  /** códigos na ordem do catálogo (S, M, L), não alfabética */
  tamanhos: string[]
}

export type SemanaLeve = {
  id: string; iso_code: string; starts_on: string; ends_on: string
  menu_id: string | null; cutoff_at: string
}

/** A semana corrente, SEM criar. A Produção não abre semana: ela lê a que
 *  existe. Criar é escrita, e o perfil Cozinha não escreve em weeks (§3). */
export async function fetchSemanaCorrente() {
  const { data, error } = await supabase
    .from('weeks')
    .select('id, iso_code, starts_on, ends_on, menu_id, cutoff_at')
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { data: null, error: { message: error.message } }
  return { data: (data as SemanaLeve | null), error: null }
}

export async function fetchProducao(weekId: string) {
  const [linhas, notas, tamanhos] = await Promise.all([
    supabase.from('v_production').select('*').eq('week_id', weekId),
    supabase.from('v_kitchen_notes').select('*').eq('week_id', weekId),
    // a ordem das colunas vem do catálogo, não de sort alfabético: Small antes
    // de Large é ordem de negócio, e alfabética inverteria ("L" < "S")
    supabase.from('sizes').select('code').eq('active', true).order('position'),
  ])
  if (linhas.error) return { data: null, error: { message: linhas.error.message } }
  if (notas.error) return { data: null, error: { message: notas.error.message } }
  return {
    error: null,
    data: {
      linhas: (linhas.data ?? []) as LinhaProducao[],
      notas: (notas.data ?? []) as NotaCozinha[],
      tamanhos: ((tamanhos.data ?? []) as { code: string }[]).map((t) => t.code),
    } satisfies Producao,
  }
}

export type CelulaMatriz = {
  cliente: string
  prato: string
  category: DishCategory | null
  size_code: string | null
  qty: number
  post_cutoff: boolean
}

/** Matriz prato × cliente (tela 3b). Reproduz a aba MENU ## da planilha, para
 *  conferência item a item. Devolve vazio para a Cozinha, por RLS. */
export async function fetchMatriz(weekId: string) {
  const { data, error } = await supabase
    .from('order_items')
    .select(`
      qty, name_snapshot, category_snapshot,
      sizes(code),
      orders!inner(post_cutoff, week_id, customers!inner(first_name, last_name))
    `)
    .eq('item_type', 'dish')
    .eq('orders.week_id', weekId)

  if (error) return { data: null, error: { message: error.message } }

  type Bruto = {
    qty: number
    name_snapshot: string
    category_snapshot: DishCategory | null
    sizes: { code: string } | null
    orders: {
      post_cutoff: boolean
      customers: { first_name: string; last_name: string | null }
    }
  }

  return {
    error: null,
    data: (data as unknown as Bruto[]).map((l) => ({
      cliente: `${l.orders.customers.first_name} ${
        l.orders.customers.last_name?.[0] ? l.orders.customers.last_name[0] + '.' : ''
      }`.trim(),
      prato: l.name_snapshot,
      category: l.category_snapshot,
      size_code: l.sizes?.code ?? null,
      qty: l.qty,
      post_cutoff: l.orders.post_cutoff,
    })) satisfies CelulaMatriz[],
  }
}

/** Agrupa por categoria e prato, somando por tamanho. É o que vai para a
 *  bancada: a cozinha lê "quantos de cada prato, em cada tamanho".
 *
 *  A ordem dentro da categoria é a DO MENU, não alfabética (reunião de
 *  22/09/2026): a cozinha monta olhando o menu, e duas ordens diferentes
 *  transformam cada prato numa busca. */
export function agrupar(linhas: LinhaProducao[], tamanhos: string[]) {
  const porCategoria = new Map<string, Map<string, Record<string, number>>>()
  const posicao = new Map<string, number>()

  for (const l of linhas) {
    const cat = l.category ?? 'classico'
    if (!porCategoria.has(cat)) porCategoria.set(cat, new Map())
    const pratos = porCategoria.get(cat)!
    if (!pratos.has(l.dish_name_pt)) pratos.set(l.dish_name_pt, {})
    const linha = pratos.get(l.dish_name_pt)!
    const size = l.size_code ?? '—'
    linha[size] = (linha[size] ?? 0) + l.qty
    posicao.set(l.dish_name_pt, Math.min(
      posicao.get(l.dish_name_pt) ?? Number.MAX_SAFE_INTEGER,
      l.menu_position ?? Number.MAX_SAFE_INTEGER))
  }

  return [...porCategoria.entries()].map(([categoria, pratos]) => {
    const itens = [...pratos.entries()]
      .map(([prato, porTamanho]) => ({
        prato,
        porTamanho,
        total: tamanhos.reduce((s, t) => s + (porTamanho[t] ?? 0), 0),
      }))
      .sort((a, b) => {
        const pa = posicao.get(a.prato) ?? Number.MAX_SAFE_INTEGER
        const pb = posicao.get(b.prato) ?? Number.MAX_SAFE_INTEGER
        // empate (fora do menu, ou menu sem ordem definida) cai no alfabético,
        // que ao menos é estável entre as impressões
        return pa !== pb ? pa - pb : a.prato.localeCompare(b.prato)
      })
    return {
      categoria,
      itens,
      totais: Object.fromEntries(
        tamanhos.map((t) => [t, itens.reduce((s, i) => s + (i.porTamanho[t] ?? 0), 0)]),
      ) as Record<string, number>,
      total: itens.reduce((s, i) => s + i.total, 0),
    }
  })
}
