import { useState } from 'react'
import { money } from '../../lib/supabase'
import { finalPriceCents, moneyInput, parseMoney } from '../../lib/precos'
import type { ExtraKind, Plan, Size } from '../../lib/types'
import { saveCustomPrice, saveExtraPrice, savePlan, savePlanPrice, type Catalogo } from './api'
import { EmptyState } from '../../ui/states'

/* Preços do catálogo. Ref: protótipo 5a (Administrador) e 5b (Operação).
 *
 * O campo canônico é o preço BASE, pré-tax. O final é derivado e mostrado ao
 * lado, ao vivo, porque ele muda com o fulfillment e com a taxa — se a base
 * fosse derivada do final, mexer nos 7% alteraria o preço de todos os planos
 * sem ninguém perceber. Ver docs/DECISOES-ABERTAS.md item 4: se a LifeBox
 * preferir digitar o preço de anúncio, `baseFromFinalCents` já faz a volta e
 * só esta tela muda. */

type Props = { catalogo: Catalogo; podeEditar: boolean; onSaved: () => void }

export function PlanosPrecos({ catalogo, podeEditar, onSaved }: Props) {
  const { sizes, plans, planPrices, extraPrices, customPrices, settings } = catalogo
  const [criandoPlano, setCriandoPlano] = useState(false)

  const precoDe = (plan: string, size: string) =>
    planPrices.find((p) => p.plan_id === plan && p.size_id === size)?.base_price_cents ?? null
  const extraDe = (plan: string, size: string, kind: ExtraKind) =>
    extraPrices.find(
      (e) => e.plan_id === plan && e.size_id === size && e.item_kind === kind,
    )?.unit_price_cents ?? null
  const customDe = (size: string) =>
    customPrices.find((c) => c.size_id === size)?.unit_price_cents ?? null

  return (
    <div className="flex flex-col gap-4">
      <Card
        titulo="🍽️ Fresh Plans — preço por tamanho"
        nota={`Preço base, com o service de ${money(settings.service_fee_cents)} embutido. O cliente paga base + ${
          (settings.tax_rate * 100).toFixed(0)
        }% + ${money(settings.delivery_fee_cents)} de entrega.`}
        acao={podeEditar && (
          <button
            onClick={() => setCriandoPlano(true)}
            className="text-[12px] text-brand-mid hover:underline whitespace-nowrap"
          >
            ＋ Novo plano
          </button>
        )}
      >
        {criandoPlano && (
          <FormPlano
            onCancelar={() => setCriandoPlano(false)}
            onSalvo={() => { setCriandoPlano(false); onSaved() }}
          />
        )}

        {plans.length === 0 && !criandoPlano ? (
          <EmptyState
            icon="🍽️"
            title="Nenhum plano cadastrado"
            body="O catálogo começa vazio. Os planos que a equipe criar aqui aparecem no link público de pedido."
            action={podeEditar ? (
              <button
                onClick={() => setCriandoPlano(true)}
                className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Criar o primeiro plano
              </button>
            ) : undefined}
          />
        ) : plans.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th className="text-left">Plano</Th>
              {sizes.map((s) => <Th key={s.id} className="text-right w-48">{s.name}</Th>)}
              {podeEditar && <Th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <LinhaPlano
                key={plan.id}
                plan={plan}
                sizes={sizes}
                precoDe={precoDe}
                settings={settings}
                podeEditar={podeEditar}
                onSaved={onSaved}
              />
            ))}
          </tbody>
        </table>
        )}
      </Card>

      {plans.length > 0 && (
      <Card
        titulo="Refeição e breakfast extras"
        nota="Cobrados quando o pedido passa do limite do plano (§5.2). O unitário muda por faixa: um extra no plano de 10 custa menos que no de 5."
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th className="text-left">Plano</Th>
              {(['meal', 'breakfast'] as ExtraKind[]).flatMap((k) =>
                sizes.map((s) => (
                  <Th key={`${k}-${s.id}`} className="text-right">
                    {k === 'meal' ? 'Refeição' : 'Breakfast'} {s.code}
                  </Th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="hover:bg-cream/60">
                <Td className="font-semibold text-ink">{plan.name_pt}</Td>
                {(['meal', 'breakfast'] as ExtraKind[]).flatMap((k) =>
                  sizes.map((s) => (
                    <CelulaValor
                      key={`${k}-${s.id}`}
                      valor={extraDe(plan.id, s.id, k)}
                      podeEditar={podeEditar}
                      onSalvar={(c) => saveExtraPrice(plan.id, s.id, k, c)}
                      onSaved={onSaved}
                    />
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      )}

      <Card
        titulo="✎ Pedido Personalizado"
        nota="Unitário por tamanho, para pedidos fora da estrutura dos planos — 4, 8, 16 refeições, ou tamanhos misturados (§5.3). Cobra tax e delivery."
      >
        <table className="w-full text-[13px]">
          <tbody>
            <tr>
              <Td className="font-semibold text-ink">Preço por refeição</Td>
              {sizes.map((s) => (
                <CelulaValor
                  key={s.id}
                  rotulo={s.name}
                  valor={customDe(s.id)}
                  podeEditar={podeEditar}
                  onSalvar={(c) => saveCustomPrice(s.id, c)}
                  onSaved={onSaved}
                />
              ))}
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function LinhaPlano({
  plan, sizes, precoDe, settings, podeEditar, onSaved,
}: {
  plan: Plan
  sizes: Size[]
  precoDe: (p: string, s: string) => number | null
  settings: Catalogo['settings']
  podeEditar: boolean
  onSaved: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function abrir() {
    setValores(
      Object.fromEntries(
        sizes.map((s) => [s.id, precoDe(plan.id, s.id) !== null ? moneyInput(precoDe(plan.id, s.id)!) : '']),
      ),
    )
    setErro(null)
    setEditando(true)
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    for (const s of sizes) {
      const bruto = valores[s.id]?.trim()
      if (!bruto) continue
      const cents = parseMoney(bruto)
      if (cents === null) {
        setErro(`Valor inválido em ${s.name}: "${bruto}"`)
        setSalvando(false)
        return
      }
      const { error } = await savePlanPrice(plan.id, s.id, cents)
      if (error) {
        // a RLS recusa quem não é Administrador (§3)
        setErro(error.message)
        setSalvando(false)
        return
      }
    }
    setSalvando(false)
    setEditando(false)
    onSaved()
  }

  return (
    <>
      <tr className="hover:bg-cream/60">
        <Td className="font-semibold text-ink">
          {plan.name_pt}
          <div className="text-[11px] font-normal text-ink-muted">
            {plan.meals_qty} refeições
            {plan.breakfasts_qty > 0 && ` + ${plan.breakfasts_qty} breakfasts`}
          </div>
        </Td>

        {sizes.map((s) => {
          const base = precoDe(plan.id, s.id)
          return (
            <Td key={s.id} className="text-right">
              {editando ? (
                <div className="flex items-center justify-end gap-1">
                  <span className="text-ink-muted">$</span>
                  <input
                    aria-label={`${plan.name_pt} ${s.name}`}
                    value={valores[s.id] ?? ''}
                    onChange={(e) => setValores({ ...valores, [s.id]: e.target.value })}
                    className="w-24 border border-line-strong rounded-md px-2 py-1 text-right bg-surface-alt outline-none focus:border-brand tnum"
                  />
                </div>
              ) : base === null ? (
                <span className="text-ink-muted">—</span>
              ) : (
                <>
                  <div className="font-semibold text-brand-mid tnum">{money(base)}</div>
                  <div className="text-[11px] text-ink-muted tnum">
                    cliente paga {money(finalPriceCents(base, settings))}
                  </div>
                </>
              )}
            </Td>
          )
        })}

        {podeEditar && (
          <Td className="text-right whitespace-nowrap">
            {editando ? (
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditando(false)}
                  className="text-[12px] text-ink-3 hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-md px-3 py-1 text-[12px] font-semibold"
                >
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            ) : (
              <button onClick={abrir} className="text-[12px] text-brand-mid hover:underline">
                Editar
              </button>
            )}
          </Td>
        )}
      </tr>

      {erro && (
        <tr>
          <td colSpan={sizes.length + 2} className="px-3 pb-2">
            <div className="bg-danger-bg border border-danger-line text-danger rounded-md px-3 py-2 text-[12px]">
              {erro}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function CelulaValor({
  valor, podeEditar, onSalvar, onSaved, rotulo,
}: {
  valor: number | null
  podeEditar: boolean
  onSalvar: (cents: number) => PromiseLike<{ error: { message: string } | null }>
  onSaved: () => void
  rotulo?: string
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState(false)

  async function salvar() {
    const cents = parseMoney(texto)
    if (cents === null) {
      setErro(true)
      return
    }
    const { error } = await onSalvar(cents)
    setEditando(false)
    if (!error) onSaved()
  }

  return (
    <Td className="text-right">
      {rotulo && <div className="text-[10px] uppercase tracking-wide text-ink-muted">{rotulo}</div>}
      {editando ? (
        <input
          autoFocus
          aria-label={rotulo ?? 'valor'}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setErro(false) }}
          onBlur={salvar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') salvar()
            if (e.key === 'Escape') setEditando(false)
          }}
          className={`w-20 border rounded-md px-2 py-1 text-right bg-surface-alt outline-none tnum ${
            erro ? 'border-danger' : 'border-line-strong focus:border-brand'
          }`}
        />
      ) : podeEditar ? (
        <button
          onClick={() => { setTexto(valor !== null ? moneyInput(valor) : ''); setEditando(true) }}
          className="tnum text-ink hover:text-brand hover:underline"
          title="Clique para editar"
        >
          {valor === null ? '—' : money(valor)}
        </button>
      ) : (
        <span className="tnum text-ink">{valor === null ? '—' : money(valor)}</span>
      )}
    </Td>
  )
}

function Card({
  titulo, nota, acao, children,
}: { titulo: string; nota?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-[13.5px] font-bold text-brand">{titulo}</h2>
        {nota && <p className="text-[11.5px] text-ink-muted max-w-2xl flex-1">{nota}</p>}
        {acao}
      </header>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

const Th = ({ className = '', children }: { className?: string; children?: React.ReactNode }) => (
  <th className={`px-3 py-2 text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold border-b border-line-soft ${className}`}>
    {children}
  </th>
)

const Td = ({ className = '', children }: { className?: string; children?: React.ReactNode }) => (
  <td className={`px-3 py-2.5 border-b border-line-soft align-top ${className}`}>{children}</td>
)

/* Sem isto a tela é um beco sem saída no catálogo vazio: dá para editar preço
 * de plano existente, mas não para criar o primeiro. E vazio é exatamente como
 * o ambiente da LifeBox começa (§1). */
function FormPlano({ onCancelar, onSalvo }: { onCancelar: () => void; onSalvo: () => void }) {
  const [nomePt, setNomePt] = useState('')
  const [nomeEn, setNomeEn] = useState('')
  const [refeicoes, setRefeicoes] = useState('')
  const [breakfasts, setBreakfasts] = useState('0')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const campo =
    'w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand'

  async function submeter(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    const meals = Number(refeicoes)
    const bkf = Number(breakfasts || 0)
    if (!nomePt.trim() || !nomeEn.trim()) {
      setErro('Nome em português e em inglês são obrigatórios: o link público mostra o EN.')
      return
    }
    if (!Number.isInteger(meals) || meals < 0) {
      setErro('Quantidade de refeições inválida.')
      return
    }
    if (!Number.isInteger(bkf) || bkf < 0) {
      setErro('Quantidade de breakfasts inválida.')
      return
    }
    setSalvando(true)
    const { error } = await savePlan({
      name_pt: nomePt.trim(), name_en: nomeEn.trim(),
      meals_qty: meals, breakfasts_qty: bkf, active: true,
    })
    setSalvando(false)
    if (error) setErro(error.message)
    else onSalvo()
  }

  return (
    <form onSubmit={submeter} className="px-4 py-4 bg-cream/60 border-b border-line flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Nome (PT) *</span>
          <input className={campo} value={nomePt} onChange={(e) => setNomePt(e.target.value)}
                 placeholder="10 Refeições + 5 Breakfasts" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Nome (EN) *</span>
          <input className={campo} value={nomeEn} onChange={(e) => setNomeEn(e.target.value)}
                 placeholder="10 Meals + 5 Breakfasts" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Refeições no plano *</span>
          <input className={`${campo} tnum`} value={refeicoes} inputMode="numeric"
                 onChange={(e) => setRefeicoes(e.target.value)} placeholder="10" />
          <span className="text-[10.5px] text-ink-muted">
            É o limite: o que passar disso vira extra, cobrado pelo unitário da faixa.
          </span>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink-2">Breakfasts no plano</span>
          <input className={`${campo} tnum`} value={breakfasts} inputMode="numeric"
                 onChange={(e) => setBreakfasts(e.target.value)} placeholder="5" />
        </label>
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
          {salvando ? 'Salvando…' : 'Salvar plano'}
        </button>
      </div>
      <p className="text-[11px] text-ink-muted">
        Depois de salvar, defina o preço de cada tamanho na linha do plano.
      </p>
    </form>
  )
}
