import { supabase } from '../../lib/supabase'
import type { Dish, DishCategory, Menu } from '../../lib/types'

export type Tag = { id: string; code: string; label_pt: string; icon: string | null; position: number }
export type Alergeno = { id: string; code: string; label_pt: string; icon: string | null }
export type MenuDish = { menu_id: string; dish_id: string; active: boolean }
export type Semana = {
  id: string
  iso_code: string
  starts_on: string
  ends_on: string
  menu_id: string | null
  status: 'open' | 'closed'
}

export type DadosMenus = {
  menus: Menu[]
  dishes: Dish[]
  menuDishes: MenuDish[]
  tags: Tag[]
  tagLinks: { dish_id: string; tag_id: string }[]
  alergenos: Alergeno[]
  dishAlergenos: { dish_id: string; allergen_id: string }[]
  semanas: Semana[]
  /** quantos pedidos cada semana já tem — decide a trava do menu (§4) */
  pedidosPorSemana: Record<string, number>
}

export async function fetchMenus() {
  const [menus, dishes, menuDishes, tags, tagLinks, alergenos, dishAlergenos, semanas, pedidos] =
    await Promise.all([
      supabase.from('menus').select('*').order('cycle_position'),
      supabase.from('dishes').select('*').order('name_pt'),
      supabase.from('menu_dishes').select('*'),
      supabase.from('dish_tags').select('id, code, label_pt, icon, position').eq('active', true).order('position'),
      supabase.from('dish_tag_links').select('dish_id, tag_id'),
      supabase.from('allergens').select('id, code, label_pt, icon').eq('active', true).order('label_pt'),
      supabase.from('dish_allergens').select('dish_id, allergen_id'),
      supabase.from('weeks').select('id, iso_code, starts_on, ends_on, menu_id, status').order('starts_on'),
      supabase.from('orders').select('week_id'),
    ])

  const falha = [menus, dishes, menuDishes, tags, tagLinks, alergenos, dishAlergenos, semanas, pedidos]
    .find((r) => r.error)
  if (falha?.error) return { data: null, error: { message: falha.error.message } }

  return {
    error: null,
    data: {
      menus: (menus.data ?? []) as Menu[],
      dishes: (dishes.data ?? []) as Dish[],
      menuDishes: (menuDishes.data ?? []) as MenuDish[],
      tags: (tags.data ?? []) as Tag[],
      tagLinks: (tagLinks.data ?? []) as { dish_id: string; tag_id: string }[],
      alergenos: (alergenos.data ?? []) as Alergeno[],
      dishAlergenos: (dishAlergenos.data ?? []) as { dish_id: string; allergen_id: string }[],
      semanas: (semanas.data ?? []) as Semana[],
      pedidosPorSemana: (pedidos.data ?? []).reduce<Record<string, number>>((acc, o) => {
        const id = (o as { week_id: string }).week_id
        acc[id] = (acc[id] ?? 0) + 1
        return acc
      }, {}),
    } satisfies DadosMenus,
  }
}

export type PratoParaSalvar = {
  id?: string
  name_pt: string
  name_en: string
  desc_pt: string | null
  desc_en: string | null
  category: DishCategory
  protein_tag: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  photos: string[]
}

/** Salva o prato e refaz os vínculos de tag e alérgeno.
 *  Sem transação no PostgREST: se um passo falhar, devolve o erro e a tela
 *  mostra — o prato fica salvo e os vínculos não, o que é recuperável
 *  reabrindo o formulário. Transação de verdade exigiria uma RPC, e não vale
 *  enquanto ninguém perdeu dado por isso. */
export async function salvarPrato(
  prato: PratoParaSalvar,
  tagIds: string[],
  alergenoIds: string[],
  menuId?: string,
) {
  const { data, error } = prato.id
    ? await supabase.from('dishes').update(prato).eq('id', prato.id).select('id').single()
    : await supabase.from('dishes').insert(prato).select('id').single()
  if (error) return { error: { message: error.message } }

  const dishId = (data as { id: string }).id

  await supabase.from('dish_tag_links').delete().eq('dish_id', dishId)
  if (tagIds.length) {
    const r = await supabase.from('dish_tag_links')
      .insert(tagIds.map((tag_id) => ({ dish_id: dishId, tag_id })))
    if (r.error) return { error: { message: r.error.message } }
  }

  await supabase.from('dish_allergens').delete().eq('dish_id', dishId)
  if (alergenoIds.length) {
    const r = await supabase.from('dish_allergens')
      .insert(alergenoIds.map((allergen_id) => ({ dish_id: dishId, allergen_id })))
    if (r.error) return { error: { message: r.error.message } }
  }

  // prato novo já entra disponível nos dois tamanhos ativos
  if (!prato.id) {
    const { data: sizes } = await supabase.from('sizes').select('id').eq('active', true)
    if (sizes?.length) {
      await supabase.from('dish_sizes')
        .insert(sizes.map((s) => ({ dish_id: dishId, size_id: (s as { id: string }).id })))
    }
  }

  if (menuId) {
    const r = await supabase.from('menu_dishes')
      .upsert({ menu_id: menuId, dish_id: dishId, active: true }, { onConflict: 'menu_id,dish_id' })
    if (r.error) return { error: { message: r.error.message } }
  }

  return { error: null, dishId }
}

export const alternarPratoNoMenu = (menu_id: string, dish_id: string, active: boolean) =>
  supabase.from('menu_dishes').upsert({ menu_id, dish_id, active }, { onConflict: 'menu_id,dish_id' })

/** §4: desativar prato em uso exige confirmação e lista os pedidos afetados.
 *  Só conta pedido das semanas que rodam este menu. */
export async function pedidosUsandoPrato(dishId: string, menuId: string) {
  const { data: semanas } = await supabase.from('weeks').select('id').eq('menu_id', menuId)
  const ids = (semanas ?? []).map((s) => (s as { id: string }).id)
  if (ids.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .from('order_items')
    .select('qty, orders!inner(code, week_id, customers!inner(first_name, last_name))')
    .eq('dish_id', dishId)
    .in('orders.week_id', ids)

  if (error) return { data: null, error: { message: error.message } }

  type Linha = {
    qty: number
    orders: { code: string; customers: { first_name: string; last_name: string | null } }
  }
  return {
    error: null,
    data: (data as unknown as Linha[]).map((l) => ({
      code: l.orders.code,
      cliente: `${l.orders.customers.first_name} ${l.orders.customers.last_name ?? ''}`.trim(),
      qty: l.qty,
    })),
  }
}

/** Upload da foto. Caminho inclui o id do prato para nunca colidir. */
export async function enviarFoto(file: File, dishId: string) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const caminho = `${dishId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('dish-photos').upload(caminho, file, { upsert: true })
  if (error) return { url: null, error: { message: error.message } }
  const { data } = supabase.storage.from('dish-photos').getPublicUrl(caminho)
  return { url: data.publicUrl, error: null }
}
