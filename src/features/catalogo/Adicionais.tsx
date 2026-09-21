import { useState } from 'react'
import { money } from '../../lib/supabase'
import { apenasDecimal, apenasDigitos } from '../../lib/numero'
import { moneyInput, parseMoney } from '../../lib/precos'
import type { Addon, AddonCategory, AddonVariant } from '../../lib/types'
import { fetchAddons, saveAddon, setAddonActive } from './api'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'

/* Produtos adicionais. Ref: protótipo 6n (cadastro), 6o (lista vazia), 11e
 * (variações). Sucos e Detox saem do estoque e NÃO entram na folha da cozinha
 * (§5.4) — a exceção são kits que incluem refeições do menu, que ganham
 * `includes_meals_qty`. */

const CATEGORIAS: { valor: AddonCategory; rotulo: string }[] = [
  { valor: 'juice', rotulo: 'Suco' },
  { valor: 'detox', rotulo: 'Detox' },
  { valor: 'other', rotulo: 'Outros' },
]

export function Adicionais({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchAddons, [])
  const [editando, setEditando] = useState<Partial<Addon> | null>(null)

  if (loading) return <Loading shape="rows" label="Carregando adicionais…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const addons = data?.addons ?? []
  const variants = data?.variants ?? []

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-center justify-between">
        <h2 className="text-[13.5px] font-bold text-accent">🧃 Produtos adicionais</h2>
        {podeEditar && (
          <button
            onClick={() => setEditando({ category: 'juice', charges_tax: false,
              charges_delivery: false, requires_plan: false, includes_meals_qty: 0, active: true })}
            className="text-[12px] text-brand-mid hover:underline"
          >
            ＋ Adicionar
          </button>
        )}
      </header>

      {editando && (
        <FormAdicional
          inicial={editando}
          onCancelar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); reload() }}
        />
      )}

      {addons.length === 0 && !editando ? (
        <EmptyState
          icon="🧃"
          title="Nenhum adicional cadastrado"
          body="O catálogo começa vazio — os adicionais que a equipe criar aqui aparecem no link público de pedido."
          action={podeEditar ? (
            <button
              onClick={() => setEditando({ category: 'juice', charges_tax: false,
                charges_delivery: false, requires_plan: false, includes_meals_qty: 0, active: true })}
              className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Adicionar o primeiro
            </button>
          ) : undefined}
        />
      ) : (
        <ul className="divide-y divide-line-soft">
          {addons.map((a) => (
            <ItemAdicional
              key={a.id}
              addon={a}
              variantes={variants.filter((v) => v.addon_id === a.id)}
              podeEditar={podeEditar}
              onEditar={() => setEditando(a)}
              onToggle={async () => { await setAddonActive(a.id, !a.active); reload() }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ItemAdicional({
  addon, variantes, podeEditar, onEditar, onToggle,
}: {
  addon: Addon
  variantes: AddonVariant[]
  podeEditar: boolean
  onEditar: () => void
  onToggle: () => void
}) {
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${addon.active ? '' : 'opacity-55'}`}>
      <div className="w-11 h-11 rounded-lg bg-muted-bg border border-line grid place-items-center text-lg shrink-0">
        {addon.category === 'juice' ? '🧃' : addon.category === 'detox' ? '🥤' : '📦'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-ink">{addon.name_pt}</div>
        {addon.desc_pt && <div className="text-[11.5px] text-ink-3">{addon.desc_pt}</div>}

        <div className="flex gap-1.5 flex-wrap mt-1.5">
          <Selo tom="accent">{money(addon.price_cents)}</Selo>
          {addon.charges_tax && <Selo tom="warn">cobra tax</Selo>}
          {addon.charges_delivery && <Selo tom="warn">cobra delivery</Selo>}
          {!addon.charges_tax && !addon.charges_delivery && <Selo tom="muted">sem tax · sem delivery</Selo>}
          {addon.requires_plan && <Selo tom="leaf">só com plano</Selo>}
          {addon.includes_meals_qty > 0 && (
            <Selo tom="ok">{addon.includes_meals_qty} refeições do menu</Selo>
          )}
          {!addon.active && <Selo tom="muted">inativo</Selo>}
        </div>

        {variantes.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {variantes.map((v) => (
              <span key={v.id} className="bg-leaf-bg border border-leaf-line text-leaf rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                {v.name_pt}
              </span>
            ))}
            <span className="text-[11px] text-ink-muted self-center">
              · composição do kit, sem preço próprio
            </span>
          </div>
        )}
      </div>

      {podeEditar && (
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button onClick={onEditar} className="text-[12px] text-brand-mid hover:underline">Editar</button>
          <button onClick={onToggle} className="text-[11.5px] text-ink-3 hover:text-ink">
            {addon.active ? 'Desativar' : 'Reativar'}
          </button>
        </div>
      )}
    </li>
  )
}

function FormAdicional({
  inicial, onCancelar, onSalvo,
}: { inicial: Partial<Addon>; onCancelar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState<Partial<Addon>>(inicial)
  const [preco, setPreco] = useState(
    inicial.price_cents !== undefined ? moneyInput(inicial.price_cents) : '',
  )
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function submeter(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    const cents = parseMoney(preco)
    if (!f.name_pt?.trim() || !f.name_en?.trim()) {
      setErro('Nome em português e em inglês são obrigatórios: o link público mostra o EN.')
      return
    }
    if (cents === null) {
      setErro(`Preço inválido: "${preco}"`)
      return
    }
    setSalvando(true)
    const { error } = await saveAddon({ ...f, price_cents: cents })
    setSalvando(false)
    if (error) setErro(error.message)
    else onSalvo()
  }

  const campo = 'w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand'

  return (
    <form onSubmit={submeter} className="px-4 py-4 bg-cream/60 border-b border-line flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Nome (PT) *</span>
          <input className={campo} value={f.name_pt ?? ''}
            onChange={(e) => setF({ ...f, name_pt: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Nome (EN) *</span>
          <input className={campo} value={f.name_en ?? ''}
            onChange={(e) => setF({ ...f, name_en: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Descrição (PT)</span>
          <input className={campo} value={f.desc_pt ?? ''}
            onChange={(e) => setF({ ...f, desc_pt: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Descrição (EN)</span>
          <input className={campo} value={f.desc_en ?? ''}
            onChange={(e) => setF({ ...f, desc_en: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Preço *</span>
          <input className={`${campo} tnum`} value={preco} placeholder="29.90" inputMode="decimal"
            onChange={(e) => setPreco(apenasDecimal(e.target.value))} />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Categoria</span>
          <select className={campo} value={f.category ?? 'juice'}
            onChange={(e) => setF({ ...f, category: e.target.value as AddonCategory })}>
            {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Refeições do menu inclusas</span>
          <input className={`${campo} tnum`} inputMode="numeric"
            value={String(f.includes_meals_qty ?? 0)}
            onChange={(e) => setF({
              ...f, includes_meals_qty: Number(apenasDigitos(e.target.value) || 0),
            })} />
          <span className="text-[10.5px] text-ink-muted">
            Acima de 0, o cliente escolhe esses pratos e eles entram na folha da cozinha.
          </span>
        </label>
      </div>

      <div className="flex gap-4 flex-wrap">
        <Chave marcado={!!f.charges_tax} onChange={(v) => setF({ ...f, charges_tax: v })}>
          Cobra tax
        </Chave>
        <Chave marcado={!!f.charges_delivery} onChange={(v) => setF({ ...f, charges_delivery: v })}>
          Cobra delivery
        </Chave>
        <Chave marcado={!!f.requires_plan} onChange={(v) => setF({ ...f, requires_plan: v })}>
          Só pode ser vendido junto com um plano
        </Chave>
      </div>

      {erro && (
        <div role="alert" className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2 text-[12.5px]">
          {erro}
        </div>
      )}

      <div className="flex justify-end gap-3 items-center">
        <button type="button" onClick={onCancelar} className="text-[12.5px] text-ink-3 hover:text-ink">
          Cancelar
        </button>
        <button type="submit" disabled={salvando}
          className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          {salvando ? 'Salvando…' : 'Salvar adicional'}
        </button>
      </div>
    </form>
  )
}

function Chave({
  marcado, onChange, children,
}: { marcado: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer">
      <input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--color-brand)] w-4 h-4" />
      {children}
    </label>
  )
}

function Selo({ tom, children }: { tom: 'accent' | 'warn' | 'muted' | 'leaf' | 'ok'; children: React.ReactNode }) {
  const cls = {
    accent: 'bg-accent-bg border-accent-line text-accent',
    warn: 'bg-warn-bg border-warn-line text-warn',
    muted: 'bg-muted-bg border-line text-ink-3',
    leaf: 'bg-leaf-bg border-leaf-line text-leaf',
    ok: 'bg-ok-bg border-ok-line text-ok',
  }[tom]
  return (
    <span className={`border rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  )
}
