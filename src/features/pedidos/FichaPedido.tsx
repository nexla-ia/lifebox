import { useEffect, useMemo, useState } from 'react'
import { money } from '../../lib/supabase'
import { formatarTelefone } from '../../lib/telefone'
import type { DishCategory } from '../../lib/types'
import {
  criarPedido, precificar,
  type DadosPedido, type ItemPedido, type Precificacao, type Rascunho,
} from './api'

/* Ficha do pedido. Ref: protótipo 2a, 2b, 2c, 2d e 9b.
 *
 * O resumo da direita NUNCA é calculado aqui: cada mudança manda os itens ao
 * servidor e recebe o total de volta (§2). O front não sabe somar preço — e é
 * de propósito, porque o que ele soubesse somar o cliente poderia editar.
 *
 * A trava de quantidade não bloqueia em silêncio: passar do limite do plano
 * mostra o unitário da faixa e o novo total antes de confirmar (§9.2). */

const CATEGORIAS: { id: DishCategory; rotulo: string }[] = [
  { id: 'classico', rotulo: 'Clássico' },
  { id: 'brasileiro', rotulo: 'Brasileiro' },
  { id: 'breakfast', rotulo: 'Breakfast' },
]

type Props = {
  dados: DadosPedido
  onCancelar: () => void
  onCriado: (code: string) => void
}

export function FichaPedido({ dados, onCancelar, onCriado }: Props) {
  const [kind, setKind] = useState<Rascunho['kind']>('plan')
  const [clienteId, setClienteId] = useState('')
  const [buscaCliente, setBuscaCliente] = useState('')
  const [planId, setPlanId] = useState('')
  const [sizeId, setSizeId] = useState(dados.tamanhos[0]?.id ?? '')
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery')
  const [qtds, setQtds] = useState<Record<string, number>>({})
  const [addonQtds, setAddonQtds] = useState<Record<string, number>>({})
  const [formaId, setFormaId] = useState('')
  const [parceria, setParceria] = useState(false)
  const [preco, setPreco] = useState<Precificacao | null>(null)
  const [erroPreco, setErroPreco] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const cliente = dados.clientes.find((c) => c.id === clienteId) ?? null
  const plano = dados.planos.find((p) => p.id === planId) ?? null

  const items: ItemPedido[] = useMemo(() => [
    ...Object.entries(qtds).filter(([, q]) => q > 0)
      .map(([dish_id, qty]) => ({ type: 'dish' as const, dish_id, qty })),
    ...Object.entries(addonQtds).filter(([, q]) => q > 0)
      .map(([addon_id, qty]) => ({ type: 'addon' as const, addon_id, qty })),
  ], [qtds, addonQtds])

  const rascunho: Rascunho = useMemo(() => ({
    kind,
    plan_id: kind === 'plan' ? planId || undefined : undefined,
    size_id: sizeId || undefined,
    breakfast_size_id: sizeId || undefined,
    fulfillment,
    items,
  }), [kind, planId, sizeId, fulfillment, items])

  // debounce: cada clique no ± não precisa virar uma ida ao servidor
  useEffect(() => {
    if (kind === 'plan' && !planId) { setPreco(null); return }
    if (items.length === 0 && kind !== 'plan') { setPreco(null); return }
    const t = setTimeout(async () => {
      const { data, error } = await precificar(rascunho)
      if (error) { setErroPreco(error.message); setPreco(null) }
      else { setPreco(data); setErroPreco(null) }
    }, 300)
    return () => clearTimeout(t)
  }, [rascunho, kind, planId, items.length])

  const clientesFiltrados = useMemo(() => {
    const q = buscaCliente.trim().toLowerCase()
    if (!q) return []
    const digitos = q.replace(/\D/g, '')
    return dados.clientes.filter((c) => {
      const nome = `${c.first_name} ${c.last_name ?? ''}`.toLowerCase()
      return nome.includes(q) || (digitos && c.phone_e164.includes(digitos))
    }).slice(0, 6)
  }, [buscaCliente, dados.clientes])

  const setQtd = (dishId: string, delta: number) =>
    setQtds((q) => ({ ...q, [dishId]: Math.max(0, (q[dishId] ?? 0) + delta) }))

  async function salvar() {
    setErro(null)
    if (!clienteId) { setErro('Escolha o cliente.'); return }
    if (kind === 'plan' && !planId) { setErro('Escolha o plano.'); return }
    if (items.length === 0) { setErro('O pedido está vazio.'); return }

    setSalvando(true)
    const { data, error } = await criarPedido({
      ...rascunho,
      customer_id: clienteId,
      week_id: dados.semana.id,
      payment_method_id: formaId || undefined,
      is_partnership: parceria,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onCriado(data!.code)
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-bold text-brand">Ficha do pedido</h2>
        <span className="bg-surface border border-line rounded-lg px-3 py-1 text-[12.5px] text-ink-2">
          <strong className="text-brand">{dados.semana.iso_code.replace(/^\d+-/, '')}</strong>
          {' · '}
          {new Date(dados.semana.starts_on).toLocaleDateString('pt-BR')} a{' '}
          {new Date(dados.semana.ends_on).toLocaleDateString('pt-BR')}
        </span>
        {dados.passouCutoff && (
          <span className="bg-late text-white rounded-full px-2.5 py-0.5 text-[10.5px] font-bold">
            APÓS CUTOFF · gera recontagem na produção
          </span>
        )}
        <div className="flex-1" />
        <button onClick={onCancelar} className="text-[12.5px] text-ink-3 hover:text-ink">
          Cancelar
        </button>
      </header>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <Cartao titulo="Tipo de pedido">
            <div className="flex gap-2 flex-wrap">
              {([
                ['plan', '🍽️ Meal Plan'],
                ['custom', '✎ Personalizado'],
                ['addons_only', '🧃 Só adicionais'],
              ] as const).map(([v, r]) => (
                <button key={v} onClick={() => setKind(v)}
                  className={`rounded-lg px-4 py-2 text-[12.5px] border ${
                    kind === v ? 'bg-leaf-bg border-brand text-brand font-semibold'
                               : 'bg-surface border-line-strong text-ink-2 hover:border-brand'}`}>
                  {r}
                </button>
              ))}
            </div>
            {kind === 'addons_only' && (
              <p className="text-[11.5px] text-ink-muted mt-2">
                Detox e sucos têm preço final: sem tax e sem delivery (§5.4).
              </p>
            )}
          </Cartao>

          <Cartao titulo="Cliente">
            {cliente ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-mid text-cream grid place-items-center text-[12px] font-semibold">
                  {cliente.first_name[0]}{cliente.last_name?.[0] ?? ''}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink">
                    {cliente.first_name} {cliente.last_name ?? ''}
                  </div>
                  <div className="text-[11.5px] text-ink-3 tnum">
                    {formatarTelefone(cliente.phone_e164)}
                    {cliente.city && ` · ${cliente.city}`}
                  </div>
                </div>
                <button onClick={() => { setClienteId(''); setBuscaCliente('') }}
                  className="text-[12px] text-brand-mid hover:underline">Trocar</button>
              </div>
            ) : (
              <>
                <input
                  aria-label="Buscar cliente"
                  placeholder="🔍 Buscar por nome ou telefone…"
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                  className="w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand"
                />
                {clientesFiltrados.length > 0 && (
                  <ul className="mt-2 border border-line rounded-lg overflow-hidden divide-y divide-line-soft">
                    {clientesFiltrados.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => setClienteId(c.id)}
                          className="w-full text-left px-3 py-2 hover:bg-cream text-[12.5px]">
                          <span className="font-semibold text-ink">
                            {c.first_name} {c.last_name ?? ''}
                          </span>
                          <span className="text-ink-muted tnum"> · {formatarTelefone(c.phone_e164)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-ink-muted mt-2">
                  Um cliente, muitos pedidos — nunca duplique o cadastro.
                </p>
              </>
            )}
          </Cartao>

          {kind === 'plan' && (
            <Cartao titulo="Plano e tamanho">
              {dados.planos.length === 0 ? (
                <p className="text-[12.5px] text-warn bg-warn-bg border border-warn-line rounded-lg px-3 py-2">
                  Nenhum plano cadastrado. Crie em Catálogo antes de lançar pedido.
                </p>
              ) : (
                <>
                  <div className="flex gap-1.5 mb-3">
                    {dados.tamanhos.map((t) => (
                      <button key={t.id} onClick={() => setSizeId(t.id)}
                        className={`px-4 py-1.5 rounded-lg text-[12.5px] border ${
                          sizeId === t.id ? 'bg-leaf-bg border-brand text-brand font-semibold'
                                          : 'bg-surface border-line-strong text-ink-2'}`}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {dados.planos.map((p) => {
                      const base = dados.precos.find(
                        (x) => x.plan_id === p.id && x.size_id === sizeId)?.base_price_cents
                      return (
                        <button key={p.id} onClick={() => setPlanId(p.id)}
                          className={`text-left rounded-lg px-3 py-2.5 border ${
                            planId === p.id ? 'bg-leaf-bg border-brand' : 'bg-surface border-line hover:border-brand'}`}>
                          <div className="text-[13px] font-semibold text-ink">{p.name_pt}</div>
                          <div className="text-[11px] text-ink-muted">
                            {p.meals_qty} refeições
                            {p.breakfasts_qty > 0 && ` + ${p.breakfasts_qty} breakfasts`}
                          </div>
                          <div className="text-[12px] font-semibold text-brand-mid tnum mt-0.5">
                            {base !== undefined ? money(base) : 'sem preço neste tamanho'}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </Cartao>
          )}

          {kind !== 'addons_only' && (
            <Cartao
              titulo={`Pratos${dados.semana.menu_id ? '' : ' — semana sem menu'}`}
              nota={plano ? `${plano.meals_qty} refeições + ${plano.breakfasts_qty} breakfasts no plano` : undefined}
            >
              {dados.pratos.length === 0 ? (
                <p className="text-[12.5px] text-warn bg-warn-bg border border-warn-line rounded-lg px-3 py-2">
                  Nenhum prato no menu desta semana. Ligue os pratos em Catálogo → Menus do ciclo.
                </p>
              ) : (
                <>
                  {plano && preco && <Progresso plano={plano} preco={preco} />}
                  {CATEGORIAS.map((cat) => {
                    const lista = dados.pratos.filter((d) => d.category === cat.id)
                    if (lista.length === 0) return null
                    return (
                      <div key={cat.id} className="mt-3 first:mt-0">
                        <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold mb-1">
                          {cat.rotulo}
                        </div>
                        <ul className="divide-y divide-line-soft">
                          {lista.map((d) => (
                            <li key={d.id} className="flex items-center gap-3 py-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-[12.5px] font-semibold text-ink">{d.name_pt}</div>
                                {d.protein_tag && (
                                  <span className="text-[10.5px] text-ink-muted">{d.protein_tag}</span>
                                )}
                              </div>
                              <Stepper
                                valor={qtds[d.id] ?? 0}
                                rotulo={d.name_pt}
                                onMudar={(delta) => setQtd(d.id, delta)}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </>
              )}
            </Cartao>
          )}

          {dados.addons.length > 0 && (
            <Cartao titulo="Adicionais" nota="preço final, fora do cálculo de tax e delivery">
              <ul className="divide-y divide-line-soft">
                {dados.addons.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-ink">{a.name_pt}</div>
                      <div className="text-[11.5px] text-accent font-semibold tnum">
                        {money(a.price_cents)}
                        {a.requires_plan && (
                          <span className="text-ink-muted font-normal"> · só com plano</span>
                        )}
                      </div>
                    </div>
                    <Stepper
                      valor={addonQtds[a.id] ?? 0}
                      rotulo={a.name_pt}
                      onMudar={(delta) =>
                        setAddonQtds((q) => ({ ...q, [a.id]: Math.max(0, (q[a.id] ?? 0) + delta) }))}
                    />
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <Resumo preco={preco} erro={erroPreco} parceria={parceria} />

          <Cartao titulo="Entrega e pagamento">
            <div className="flex gap-1.5 mb-3">
              {([['delivery', '🚚 Entrega'], ['pickup', '🏠 Pick-up']] as const).map(([v, r]) => (
                <button key={v} onClick={() => setFulfillment(v)}
                  className={`flex-1 rounded-lg py-2 text-[11.5px] border ${
                    fulfillment === v ? 'bg-leaf-bg border-brand text-brand font-semibold'
                                      : 'bg-surface border-line-strong text-ink-2'}`}>
                  {r}
                </button>
              ))}
            </div>
            {dados.formas.length === 0 ? (
              <p className="text-[11.5px] text-warn">
                Nenhuma forma de pagamento cadastrada em Configurações.
              </p>
            ) : (
              <select value={formaId} onChange={(e) => setFormaId(e.target.value)}
                aria-label="Forma de pagamento"
                className="w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand">
                <option value="">Forma de pagamento…</option>
                {dados.formas.map((f) => <option key={f.id} value={f.id}>{f.name_pt}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-[12.5px] text-ink mt-3 cursor-pointer">
              <input type="checkbox" checked={parceria} onChange={(e) => setParceria(e.target.checked)}
                className="accent-[var(--color-accent)] w-4 h-4" />
              🎁 Parceria — pedido gratuito
            </label>
            {parceria && (
              <p className="text-[11px] text-accent mt-1 leading-relaxed">
                Valor pago fica $0 e o valor comercial é registrado à parte. Não entra
                no Total Pedidos nem no faturamento (§6.4).
              </p>
            )}
          </Cartao>

          {erro && (
            <div role="alert" className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2 text-[12.5px]">
              {erro}
            </div>
          )}

          <button onClick={salvar} disabled={salvando || !preco}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-cream rounded-lg px-5 py-3 text-[13.5px] font-semibold">
            {salvando ? 'Salvando…'
              : preco ? `Salvar pedido · ${money(parceria ? 0 : preco.total_cents)}`
              : 'Salvar pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** §9.2: a trava não aceita em silêncio — mostra o extra e o novo total. */
function Progresso({
  plano, preco,
}: { plano: { meals_qty: number; breakfasts_qty: number }; preco: Precificacao }) {
  const passou = preco.meals_extra > 0 || preco.breakfasts_extra > 0
  return (
    <div className="mb-3">
      <div className="flex justify-between text-[12px] text-ink-2 mb-1">
        <span className={preco.meals_extra > 0 ? 'text-warn font-semibold' : ''}>
          {preco.meals_qty} de {plano.meals_qty} refeições
          {preco.meals_extra > 0 && ` · ${preco.meals_extra} extra`}
        </span>
        {plano.breakfasts_qty > 0 && (
          <span className={preco.breakfasts_extra > 0 ? 'text-warn font-semibold' : ''}>
            {preco.breakfasts_qty} de {plano.breakfasts_qty} breakfasts
            {preco.breakfasts_extra > 0 && ` · ${preco.breakfasts_extra} extra`}
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-muted-bg overflow-hidden flex">
        <div className="bg-brand-mid h-full"
          style={{ width: `${Math.min(100, (preco.meals_qty / Math.max(plano.meals_qty, 1)) * 100)}%` }} />
        {passou && <div className="bg-warn-strong h-full flex-1" />}
      </div>
      {passou && (
        <div className="bg-warn-bg border border-warn-line rounded-lg px-3 py-2 mt-2 text-[12px] text-warn leading-relaxed">
          ⏰ <strong>Passou do plano.</strong>{' '}
          {preco.meals_extra > 0 && `${preco.meals_extra} refeição(ões) `}
          {preco.breakfasts_extra > 0 && `${preco.breakfasts_extra} breakfast(s) `}
          entra(m) como extra, cobrado pelo unitário da faixa. O total ao lado já
          considera isso.
        </div>
      )}
    </div>
  )
}

function Resumo({
  preco, erro, parceria,
}: { preco: Precificacao | null; erro: string | null; parceria: boolean }) {
  return (
    <Cartao titulo="Resumo" nota="calculado no servidor">
      {erro ? (
        <p className="text-[12.5px] text-danger bg-danger-bg border border-danger-line rounded-lg px-3 py-2">
          {erro}
        </p>
      ) : !preco ? (
        <p className="text-[12.5px] text-ink-muted py-4 text-center">
          Escolha cliente, plano e pratos para ver o valor.
        </p>
      ) : (
        <>
          {preco.lines.filter((l) => l.unit_price_cents > 0 || l.item_type === 'plan_base')
            .map((l, i) => (
              <Linha key={i} rotulo={`${l.qty > 1 ? `${l.qty}× ` : ''}${l.name_snapshot}`}
                     valor={l.unit_price_cents * l.qty}
                     tom={l.item_type === 'extra' ? 'warn' : l.taxable ? undefined : 'accent'} />
            ))}
          <div className="border-t border-line-soft mt-2 pt-2">
            <Linha rotulo="Tributável" valor={preco.taxable_cents} forte />
            <Linha rotulo={`Tax ${(preco.tax_rate * 100).toFixed(0)}%`} valor={preco.tax_cents} />
            <Linha rotulo="Delivery" valor={preco.delivery_cents} />
            {preco.non_taxable_cents > 0 && (
              <Linha rotulo="Sem tax nem delivery" valor={preco.non_taxable_cents} tom="accent" />
            )}
          </div>
          <div className="border-t border-line-soft mt-2 pt-2.5 flex justify-between items-baseline">
            <span className="text-[14px] font-bold text-ink">Total</span>
            <span className="text-[19px] font-bold text-brand-mid tnum">
              {money(parceria ? 0 : preco.total_cents)}
            </span>
          </div>
          {parceria && (
            <p className="text-[11px] text-accent text-right tnum">
              valor comercial {money(preco.total_cents)}
            </p>
          )}
        </>
      )}
    </Cartao>
  )
}

function Linha({
  rotulo, valor, tom, forte,
}: { rotulo: string; valor: number; tom?: 'warn' | 'accent'; forte?: boolean }) {
  const cor = tom === 'warn' ? 'text-warn' : tom === 'accent' ? 'text-accent' : 'text-ink-2'
  return (
    <div className={`flex justify-between py-0.5 text-[12.5px] ${cor} ${forte ? 'font-semibold' : ''}`}>
      <span className="pr-2">{rotulo}</span>
      <span className="tnum whitespace-nowrap">{money(valor)}</span>
    </div>
  )
}

function Stepper({
  valor, rotulo, onMudar,
}: { valor: number; rotulo: string; onMudar: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={() => onMudar(-1)} disabled={valor === 0}
        aria-label={`Tirar um ${rotulo}`}
        className="w-7 h-7 rounded-lg border border-line-strong text-ink-3 disabled:opacity-40 hover:border-brand">
        −
      </button>
      <strong className="w-5 text-center text-[13px] tnum">{valor}</strong>
      <button onClick={() => onMudar(1)}
        aria-label={`Somar um ${rotulo}`}
        className="w-7 h-7 rounded-lg border border-brand text-brand hover:bg-leaf-bg">
        ＋
      </button>
    </div>
  )
}

function Cartao({
  titulo, nota, children,
}: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3.5">
      <div className="flex items-baseline gap-2 flex-wrap mb-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{titulo}</h3>
        {nota && <span className="text-[11px] text-ink-muted">· {nota}</span>}
      </div>
      {children}
    </section>
  )
}
