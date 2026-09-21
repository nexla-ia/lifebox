import { useMemo, useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import type { Dish, DishCategory, Menu } from '../../lib/types'
import {
  alternarPratoNoMenu, fetchMenus, pedidosUsandoPrato,
  type DadosMenus, type Semana,
} from './menusApi'
import { FormPrato } from './FormPrato'

/* Menus do ciclo. Ref: protótipo 5c (ciclo e lista), 5d (modal de desativação).
 *
 * 4 menus em rotação automática (§4). O menu da semana em execução fica
 * travado para edição quando existem pedidos — mexer nele mudaria o que a
 * cozinha já está produzindo. A tela abre no próximo menu, que é o editável. */

const CATEGORIAS: { id: DishCategory; rotulo: string }[] = [
  { id: 'classico', rotulo: 'Menu Clássico' },
  { id: 'brasileiro', rotulo: 'Menu Brasileiro' },
  { id: 'breakfast', rotulo: 'Breakfast' },
]

export function MenusCiclo({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchMenus, [])
  const [menuAberto, setMenuAberto] = useState<string | null>(null)
  const [editandoPrato, setEditandoPrato] = useState<Dish | 'novo' | null>(null)
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null)

  const contexto = useMemo(() => (data ? analisarCiclo(data) : null), [data])

  if (loading) return <Loading shape="blocks" label="Carregando menus…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data || !contexto) return null

  const { menus, dishes, menuDishes, tags, tagLinks } = data
  const menuId = menuAberto ?? contexto.menuEditavelId ?? menus[0]?.id ?? null
  const menu = menus.find((m) => m.id === menuId) ?? null
  const travado = menuId === contexto.menuEmExecucaoId && contexto.temPedidos

  const noMenu = (dishId: string) =>
    menuDishes.find((md) => md.menu_id === menuId && md.dish_id === dishId)?.active ?? false

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {menus.map((m) => (
          <CartaoMenu
            key={m.id}
            menu={m}
            rotulo={contexto.rotuloPorMenu[m.id]}
            pratos={menuDishes.filter((md) => md.menu_id === m.id && md.active).length}
            selecionado={m.id === menuId}
            emExecucao={m.id === contexto.menuEmExecucaoId}
            editavel={m.id === contexto.menuEditavelId}
            onClick={() => setMenuAberto(m.id)}
          />
        ))}
      </section>

      {travado && (
        <div className="bg-warn-bg border border-warn-line text-warn rounded-lg px-4 py-2.5 text-[12.5px] flex gap-2">
          <span aria-hidden>🔒</span>
          <span>
            <strong>Menu em execução.</strong> Há pedidos usando estes pratos. Mexer agora
            mudaria o que a cozinha está produzindo — abra o próximo menu para preparar a
            semana que vem.
          </span>
        </div>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-center gap-3 flex-wrap">
          <h2 className="text-[13.5px] font-bold text-brand">
            {menu ? `Editando ${menu.name}` : 'Menus'}
          </h2>
          {contexto.rotuloPorMenu[menuId ?? ''] && (
            <span className="bg-leaf-bg border border-leaf-line text-leaf rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
              {contexto.rotuloPorMenu[menuId ?? '']}
            </span>
          )}
          <span className="text-[11.5px] text-ink-muted">
            O ciclo repete a cada 4 semanas — a rotação é automática
          </span>
          <div className="flex-1" />
          {podeEditar && !travado && (
            <button
              onClick={() => setEditandoPrato('novo')}
              className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold"
            >
              ＋ Adicionar prato
            </button>
          )}
        </header>

        {editandoPrato && menuId && (
          <FormPrato
            dados={data}
            prato={editandoPrato === 'novo' ? null : editandoPrato}
            menuId={menuId}
            menuNome={menu?.name ?? ''}
            onCancelar={() => setEditandoPrato(null)}
            onSalvo={() => { setEditandoPrato(null); reload() }}
          />
        )}

        {dishes.length === 0 && !editandoPrato ? (
          <EmptyState
            icon="🍽️"
            title="Nenhum prato cadastrado"
            body="Os pratos que a equipe criar aqui alimentam a seleção do link público, a folha da cozinha e a contagem de produção."
            action={podeEditar ? (
              <button
                onClick={() => setEditandoPrato('novo')}
                className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Adicionar o primeiro prato
              </button>
            ) : undefined}
          />
        ) : (
          <div className="grid md:grid-cols-3 gap-px bg-line-soft">
            {CATEGORIAS.map((cat) => (
              <ColunaCategoria
                key={cat.id}
                rotulo={cat.rotulo}
                pratos={dishes.filter((d) => d.category === cat.id)}
                noMenu={noMenu}
                tags={tags}
                tagLinks={tagLinks}
                podeEditar={podeEditar && !travado}
                onEditar={setEditandoPrato}
                onAlternar={async (prato, ativar) => {
                  if (!menuId) return
                  if (!ativar) {
                    const { data: afetados } = await pedidosUsandoPrato(prato.id, menuId)
                    if (afetados && afetados.length > 0) {
                      setConfirmacao({ prato, menuId, afetados })
                      return
                    }
                  }
                  await alternarPratoNoMenu(menuId, prato.id, ativar)
                  reload()
                }}
              />
            ))}
          </div>
        )}
      </section>

      <ModalDesativar
        estado={confirmacao}
        onFechar={() => setConfirmacao(null)}
        onConfirmar={async () => {
          if (!confirmacao) return
          await alternarPratoNoMenu(confirmacao.menuId, confirmacao.prato.id, false)
          setConfirmacao(null)
          reload()
        }}
      />
    </div>
  )
}

type Confirmacao = {
  prato: Dish
  menuId: string
  afetados: { code: string; cliente: string; qty: number }[]
}

function CartaoMenu({
  menu, rotulo, pratos, selecionado, emExecucao, editavel, onClick,
}: {
  menu: Menu; rotulo?: string; pratos: number; selecionado: boolean
  emExecucao: boolean; editavel: boolean; onClick: () => void
}) {
  const base = 'rounded-xl px-3.5 py-3 text-left border transition-colors'
  const estilo = selecionado
    ? 'bg-brand border-brand text-cream'
    : emExecucao
      ? 'bg-muted-bg border-line-strong text-ink-3'
      : 'bg-surface border-line hover:border-brand text-ink'

  return (
    <button onClick={onClick} className={`${base} ${estilo}`}>
      <div className="text-[15px] font-bold flex items-center gap-1.5">
        {menu.name}
        {emExecucao && <span title="Em execução">🔒</span>}
      </div>
      <div className={`text-[11.5px] font-semibold mt-0.5 ${selecionado ? 'text-lime' : 'text-ink-muted'}`}>
        {/* sem a contagem, um menu cheio e um vazio parecem iguais daqui */}
        {pratos} prato{pratos === 1 ? '' : 's'}
        {rotulo ? ` · ${rotulo}` : ''}
        {editavel && !selecionado && ' · editável'}
      </div>
    </button>
  )
}

function ColunaCategoria({
  rotulo, pratos, noMenu, tags, tagLinks, podeEditar, onEditar, onAlternar,
}: {
  rotulo: string
  pratos: Dish[]
  noMenu: (id: string) => boolean
  tags: DadosMenus['tags']
  tagLinks: DadosMenus['tagLinks']
  podeEditar: boolean
  onEditar: (d: Dish) => void
  onAlternar: (d: Dish, ativar: boolean) => void
}) {
  const ativos = pratos.filter((p) => noMenu(p.id)).length
  return (
    <div className="bg-surface">
      <div className="px-3.5 py-2.5 border-b border-line-soft bg-surface-alt flex items-center justify-between">
        <span className="text-[13px] font-bold text-brand">{rotulo}</span>
        <span className="bg-muted-bg text-ink-3 rounded-full px-2 py-0.5 text-[11px] font-semibold">
          {ativos} no menu
        </span>
      </div>

      {pratos.length === 0 ? (
        <p className="px-3.5 py-6 text-[12px] text-ink-muted text-center">
          Nenhum prato nesta categoria.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {pratos.map((p) => {
            const dentro = noMenu(p.id)
            const doPrato = tagLinks.filter((l) => l.dish_id === p.id)
              .map((l) => tags.find((t) => t.id === l.tag_id))
              .filter(Boolean)
            return (
              <li key={p.id} className={`px-3.5 py-2.5 flex gap-2.5 items-start ${dentro ? '' : 'opacity-55'}`}>
                <div className="w-9 h-9 rounded-lg bg-muted-bg border border-line grid place-items-center text-sm shrink-0 overflow-hidden">
                  {p.photos?.[0]
                    ? <img src={p.photos[0]} alt="" className="w-full h-full object-cover" />
                    : '📷'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink leading-tight">{p.name_pt}</div>
                  <div className="text-[10.5px] text-ink-muted">{p.name_en}</div>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {p.protein_tag && (
                      <span className="bg-muted-bg text-ink-3 rounded-full px-2 py-0.5 text-[10px]">
                        {p.protein_tag}
                      </span>
                    )}
                    {doPrato.map((t) => (
                      <span key={t!.id} className="bg-leaf-bg text-leaf rounded-full px-2 py-0.5 text-[10px] font-semibold">
                        {t!.icon} {t!.code}
                      </span>
                    ))}
                    {p.calories !== null && (
                      <span className="text-[10px] text-ink-muted self-center tnum">{p.calories} cal</span>
                    )}
                  </div>
                </div>
                {podeEditar && (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button onClick={() => onEditar(p)} className="text-[11.5px] text-brand-mid hover:underline">
                      Editar
                    </button>
                    <button
                      onClick={() => onAlternar(p, !dentro)}
                      aria-label={dentro ? `Tirar ${p.name_pt} do menu` : `Pôr ${p.name_pt} no menu`}
                      className={`w-9 h-5 rounded-full flex items-center px-0.5 ${
                        dentro ? 'bg-brand justify-end' : 'bg-line-strong justify-start'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white block" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** §4: desativar prato em uso lista os pedidos afetados antes de confirmar. */
function ModalDesativar({
  estado, onFechar, onConfirmar,
}: { estado: Confirmacao | null; onFechar: () => void; onConfirmar: () => void }) {
  if (!estado) return null
  return (
    <div className="fixed inset-0 bg-ink/40 grid place-items-center p-6 z-50" role="dialog" aria-modal="true">
      <div className="bg-surface rounded-xl max-w-md w-full overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-line-soft">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-warn-bg grid place-items-center">⚠️</div>
            <h3 className="text-[15px] font-bold text-ink">Tirar “{estado.prato.name_pt}” do menu?</h3>
          </div>
          <p className="text-[12.5px] text-ink-3 leading-relaxed mt-2.5">
            Este prato está em pedidos já lançados. Tirar agora afeta o que a cozinha vai
            produzir — a folha precisará ser reimpressa.
          </p>
        </div>

        <div className="px-5 py-3 bg-surface-alt max-h-52 overflow-y-auto">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold mb-1.5">
            {estado.afetados.length} pedido{estado.afetados.length > 1 ? 's' : ''} usa
            {estado.afetados.length > 1 ? 'm' : ''} este prato
          </div>
          {estado.afetados.map((a, i) => (
            <div key={i} className="flex justify-between text-[12.5px] text-ink py-1 border-b border-line-soft last:border-0">
              <span>{a.cliente} · {a.code}</span>
              <span className="text-ink-muted tnum">{a.qty}×</span>
            </div>
          ))}
        </div>

        <div className="px-5 py-3.5 border-t border-line-soft flex justify-end gap-3 items-center">
          <button onClick={onFechar} className="text-[13px] text-ink-3 hover:text-ink">Cancelar</button>
          <button
            onClick={onConfirmar}
            className="bg-danger text-white rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            Tirar mesmo assim
          </button>
        </div>
      </div>
    </div>
  )
}

/** Qual menu está rodando, qual é o próximo e o rótulo de semana de cada um. */
function analisarCiclo(d: DadosMenus) {
  const hoje = new Date().toISOString().slice(0, 10)
  const dentro = (s: Semana) => s.starts_on <= hoje && hoje <= s.ends_on

  const semanaAtual = d.semanas.find(dentro) ?? null
  const menuEmExecucaoId = semanaAtual?.menu_id ?? null

  // a próxima semana com menu definido é o que a equipe edita hoje
  const proxima = d.semanas.find((s) => s.starts_on > hoje && s.menu_id)
  const menuEditavelId =
    proxima?.menu_id ??
    (menuEmExecucaoId
      ? d.menus.find((m) => m.cycle_position === (posicao(d, menuEmExecucaoId) % d.menus.length) + 1)?.id
      : d.menus[0]?.id) ??
    null

  const rotuloPorMenu: Record<string, string> = {}
  for (const m of d.menus) {
    const semanas = d.semanas.filter((s) => s.menu_id === m.id)
    if (semanas.length === 0) continue
    const atual = semanas.find(dentro)
    if (atual) rotuloPorMenu[m.id] = `${atual.iso_code.replace(/^\d+-/, '')} · em execução`
    else {
      const futura = semanas.find((s) => s.starts_on > hoje)
      const ultima = [...semanas].reverse().find((s) => s.ends_on < hoje)
      if (futura) rotuloPorMenu[m.id] = `${futura.iso_code.replace(/^\d+-/, '')} · próximo`
      else if (ultima) rotuloPorMenu[m.id] = `${ultima.iso_code.replace(/^\d+-/, '')} · rodou`
    }
  }

  // §4: a trava só vale quando a semana em execução JÁ tem pedido. Menu sem
  // pedido nenhum continua editável, senão a equipe ficaria presa à toa.
  const temPedidos = semanaAtual ? (d.pedidosPorSemana[semanaAtual.id] ?? 0) > 0 : false

  return { menuEmExecucaoId, menuEditavelId, rotuloPorMenu, temPedidos }
}

const posicao = (d: DadosMenus, menuId: string) =>
  d.menus.find((m) => m.id === menuId)?.cycle_position ?? 0
