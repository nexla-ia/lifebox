import { useState } from 'react'
import { apenasDigitos } from '../../lib/numero'
import { useAuth } from '../../lib/auth'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { fetchBags, registrarDevolucao, salvarEstoqueTotal, type SaldoBag } from './api'

/* Tela 9.10 · Bags térmicas. Ref: protótipo 11b e 11c.
 *
 * §6.7: o saldo por cliente e o total na rua saem das MOVIMENTAÇÕES, não de
 * um contador — assim o número sempre tem de onde ser explicado. O estoque
 * total fica em settings, porque é o único dado que ninguém consegue derivar.
 *
 * A ordem da lista de coleta é por risco de a bag não voltar, não por saldo:
 * quem saiu da semana some do radar, então vem primeiro. */

const MOTIVO_TOM: Record<number, 'danger' | 'warn' | 'muted'> = {
  1: 'danger', 2: 'warn', 3: 'muted',
}

export function BagsPage() {
  const { profile } = useAuth()
  const { data, loading, error, reload } = useQuery(fetchBags, [])
  const [filtroRota, setFiltroRota] = useState('')

  if (loading) return <div className="p-5"><Loading shape="cards" label="Carregando bags…" /></div>
  if (error) return <div className="p-5"><ErrorState message={error} onRetry={reload} /></div>
  if (!data) return null

  const { estoque, coleta, rotas } = data
  const emCasa = estoque.total - estoque.na_rua
  const visiveis = filtroRota ? coleta.filter((c) => c.route_id === filtroRota) : coleta

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">🧊 Bags térmicas</h1>
        <span className="text-[12px] text-ink-3">
          Clientes que não usam bag térmica ficam fora deste controle
        </span>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <CardEstoque total={estoque.total} podeEditar={profile?.role === 'admin'} onSaved={reload} />

        <Card titulo="Em casa" valor={estoque.total > 0 ? String(emCasa) : '—'}
          nota={estoque.total > 0 ? 'prontas para a montagem' : 'informe o estoque total'}
          tom={estoque.total > 0 && emCasa < 0 ? 'danger' : 'ok'} />

        <Card titulo="Na rua" valor={String(estoque.na_rua)}
          nota={`em posse de ${estoque.clientes_com_bag} cliente${estoque.clientes_com_bag === 1 ? '' : 's'}`}
          tom="warn" />

        <Card titulo="A coletar" valor={String(estoque.a_coletar)}
          nota="clientes fora da semana ou com bag há muito tempo"
          tom={estoque.a_coletar > 0 ? 'danger' : 'ok'} />
      </div>

      {estoque.total > 0 && emCasa < 0 && (
        <div className="bg-danger-bg border border-danger-line text-danger rounded-lg px-4 py-2.5 text-[12.5px]">
          ⚠️ <strong>Há mais bags na rua do que no estoque cadastrado.</strong> Ou o total
          está desatualizado, ou faltou registrar devolução.
        </div>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-center gap-3 flex-wrap">
          <h2 className="text-[13.5px] font-bold text-brand">Coletar · priorizado</h2>
          <span className="text-[11px] text-ink-muted flex-1">
            saiu da semana → muito tempo em posse → demais saldos
          </span>
          {rotas.length > 0 && (
            <select aria-label="Filtrar por rota" value={filtroRota}
              onChange={(e) => setFiltroRota(e.target.value)}
              className="border border-line rounded-lg px-3 py-1 text-[12px] bg-surface outline-none focus:border-brand">
              <option value="">Rota: todas</option>
              {rotas.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </header>

        {visiveis.length === 0 ? (
          <EmptyState icon="🧊"
            title={coleta.length === 0 ? 'Nenhuma bag na rua' : 'Nenhuma bag nesta rota'}
            body={coleta.length === 0
              ? 'O saldo aparece aqui conforme as entregas de domingo forem marcadas como montadas.'
              : 'Limpe o filtro para ver as demais.'} />
        ) : (
          <ul className="divide-y divide-line-soft">
            {visiveis.map((c) => (
              <ItemColeta key={c.customer_id} c={c}
                rota={rotas.find((r) => r.id === c.route_id)?.name}
                onMudou={reload} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ItemColeta({
  c, rota, onMudou,
}: { c: SaldoBag; rota?: string; onMudou: () => void }) {
  const [devolvendo, setDevolvendo] = useState(false)
  const [qtd, setQtd] = useState(String(c.balance))
  const [erro, setErro] = useState<string | null>(null)
  const tom = MOTIVO_TOM[c.prioridade] ?? 'muted'
  const cls = {
    danger: 'bg-danger-bg border-danger-line text-danger',
    warn: 'bg-warn-bg border-warn-line text-warn',
    muted: 'bg-muted-bg border-line text-ink-3',
  }[tom]

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
      <div className="flex-1 min-w-44">
        <div className="text-[12.5px] font-bold text-ink">
          {c.first_name} {c.last_name ?? ''}
        </div>
        <div className="text-[11px] text-ink-3">
          {rota ?? 'sem rota'} · {c.balance} bag{c.balance === 1 ? '' : 's'} ·{' '}
          {c.semanas} semana{c.semanas === 1 ? '' : 's'} em posse
        </div>
      </div>

      <span className={`border rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${cls}`}>
        {c.motivo}
      </span>

      {devolvendo ? (
        <div className="flex gap-1.5 items-center">
          <input aria-label={`Bags devolvidas por ${c.first_name}`} value={qtd}
            inputMode="numeric"
            onChange={(e) => setQtd(apenasDigitos(e.target.value))}
            className="w-14 text-center border border-line-strong rounded-md py-1 bg-surface-alt outline-none focus:border-brand tnum" />
          <button onClick={async () => {
            const n = Number(qtd)
            if (!Number.isInteger(n) || n <= 0) {
              setErro('Informe um número inteiro maior que zero.')
              return
            }
            const { error } = await registrarDevolucao(c.customer_id, n)
            if (error) { setErro(error.message); return }
            setErro(null)
            setDevolvendo(false)
            onMudou()
          }} className="bg-brand hover:bg-brand-hover text-cream rounded-md px-3 py-1 text-[11.5px] font-semibold">
            Confirmar
          </button>
          <button onClick={() => { setErro(null); setDevolvendo(false) }}
            className="text-[11.5px] text-ink-3">
            Cancelar
          </button>
        </div>
      ) : (
        <button onClick={() => { setQtd(String(c.balance)); setDevolvendo(true) }}
          className="bg-surface border border-line-strong hover:border-brand text-ink-2 rounded-md px-3 py-1.5 text-[11.5px] font-semibold whitespace-nowrap">
          Registrar devolução
        </button>
      )}

      {erro && (
        <div role="alert" className="basis-full text-[11.5px] text-danger">{erro}</div>
      )}
    </li>
  )
}

function CardEstoque({
  total, podeEditar, onSaved,
}: { total: number; podeEditar: boolean; onSaved: () => void }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(String(total))

  return (
    <div className="bg-surface border border-line rounded-xl px-3.5 py-3">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
        Estoque total
      </div>
      {editando ? (
        <div className="flex gap-1.5 mt-1">
          <input aria-label="Estoque total de bags" value={texto}
            inputMode="numeric"
            onChange={(e) => setTexto(apenasDigitos(e.target.value))}
            className="w-20 border border-line-strong rounded-md px-2 py-1 text-[17px] font-bold bg-surface-alt outline-none focus:border-brand tnum" />
          <button onClick={async () => {
            const n = Number(texto)
            if (!Number.isInteger(n) || n < 0) return
            await salvarEstoqueTotal(n)
            setEditando(false)
            onSaved()
          }} className="bg-brand text-cream rounded-md px-3 text-[11.5px] font-semibold">
            Salvar
          </button>
        </div>
      ) : (
        <>
          <div aria-label="Estoque total" className="text-[21px] font-bold text-ink leading-tight tnum">
            {total > 0 ? total : '—'}
          </div>
          {podeEditar ? (
            <button onClick={() => { setTexto(String(total)); setEditando(true) }}
              className="text-[11px] text-brand-mid hover:underline">
              {total > 0 ? 'editar' : 'informar quantas bags vocês têm'}
            </button>
          ) : (
            <div className="text-[10.5px] text-ink-muted">definido pelo Administrador</div>
          )}
        </>
      )}
    </div>
  )
}

function Card({
  titulo, valor, nota, tom,
}: { titulo: string; valor: string; nota: string; tom: 'ok' | 'warn' | 'danger' }) {
  const borda = { ok: 'border-line', warn: 'border-warn-line', danger: 'border-danger-line' }[tom]
  const cor = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[tom]
  return (
    <div className={`bg-surface border rounded-xl px-3.5 py-3 ${borda}`}>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">{titulo}</div>
      <div aria-label={titulo} className={`text-[21px] font-bold leading-tight tnum ${cor}`}>{valor}</div>
      <div className="text-[10.5px] text-ink-muted">{nota}</div>
    </div>
  )
}
