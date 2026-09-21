import { useState } from 'react'
import { money, supabase } from '../../lib/supabase'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { fetchDadosPedido } from './api'
import { FichaPedido } from './FichaPedido'

/* Tela 9.1 · Semana — versão inicial.
 *
 * Por enquanto: cabeçalho da semana com o cutoff, lista dos pedidos e o
 * lançamento. O painel completo (cards, "precisa de ação agora", kanban por
 * pagamento e modo planilha) é a etapa 5 do §11. */

type LinhaSemana = {
  order_status: string
  customers: { first_name: string; last_name: string | null }
  orders: {
    id: string; code: string; total_cents: number
    payment_status: string; post_cutoff: boolean
  } | null
}

async function fetchSemana(weekId: string) {
  const { data, error } = await supabase
    .from('customer_weeks')
    .select(`
      order_status,
      customers!inner(first_name, last_name),
      orders(id, code, total_cents, payment_status, post_cutoff)
    `)
    .eq('week_id', weekId)
  if (error) return { data: null, error: { message: error.message } }
  return { data: data as unknown as LinhaSemana[], error: null }
}

export function SemanaPage() {
  const [lancando, setLancando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const { data, loading, error, reload } = useQuery(() => fetchDadosPedido(), [])

  if (loading) return <div className="p-5"><Loading shape="cards" label="Abrindo a semana…" /></div>
  if (error) return <div className="p-5"><ErrorState message={error} onRetry={reload} /></div>
  if (!data) return null

  const cutoff = new Date(data.semana.cutoff_at)

  if (lancando) {
    return (
      <div className="p-5">
        <FichaPedido
          dados={data}
          onCancelar={() => setLancando(false)}
          onCriado={(code) => {
            setLancando(false)
            setAviso(`Pedido ${code} criado.`)
            reload()
          }}
        />
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">Semana</h1>
        <span className="bg-surface border border-line rounded-lg px-3 py-1 text-[12.5px] text-ink-2">
          <strong className="text-brand">{data.semana.iso_code.replace(/^\d+-/, '')}</strong>
          {' · '}
          {new Date(data.semana.starts_on).toLocaleDateString('pt-BR')} a{' '}
          {new Date(data.semana.ends_on).toLocaleDateString('pt-BR')}
        </span>
        <span className={`rounded-full px-3 py-1 text-[12px] font-semibold border ${
          data.passouCutoff
            ? 'bg-muted-bg border-line text-ink-3'
            : 'bg-warn-bg border-warn-line text-warn'
        }`}>
          {data.passouCutoff
            ? '⏰ Encerrado · aceitando pós-cutoff'
            : `⏰ Cutoff ${cutoff.toLocaleDateString('pt-BR', { weekday: 'short' })} ${cutoff.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
        </span>
        <div className="flex-1" />
        <button onClick={() => setLancando(true)}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[13px] font-semibold">
          ＋ Novo pedido
        </button>
      </header>

      {aviso && (
        <div className="bg-ok-bg border border-ok-line text-ok rounded-lg px-3 py-2 text-[12.5px]">
          ✅ {aviso}
        </div>
      )}

      <ListaDaSemana weekId={data.semana.id} />
    </div>
  )
}

function ListaDaSemana({ weekId }: { weekId: string }) {
  const { data, loading, error, reload } = useQuery(() => fetchSemana(weekId), [weekId])

  if (loading) return <Loading shape="rows" label="Carregando pedidos…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const linhas = data ?? []
  const contam = linhas.filter((l) => ['novo_pedido', 'renovacao'].includes(l.order_status))
  const total = contam.reduce((s, l) => s + (l.orders?.total_cents ?? 0), 0)

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13.5px] font-bold text-brand">Pedidos da semana</h2>
        <span className="text-[12px] text-ink-3">
          {/* §6.4: Skip, Cancelamento e Parceria ficam fora do Total Pedidos */}
          Total Pedidos <strong className="text-ink">{contam.length}</strong>
          {' · '}
          <span className="tnum">{money(total)}</span>
        </span>
      </header>

      {linhas.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Nenhum pedido lançado nesta semana"
          body="A semana abriu na segunda. Lance o primeiro pedido ou envie o link de pedido pelo WhatsApp."
        />
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-muted">
              <th className="text-left font-semibold px-4 py-2">Cliente</th>
              <th className="text-left font-semibold px-3">Situação</th>
              <th className="text-left font-semibold px-3">Pedido</th>
              <th className="text-right font-semibold px-4">Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className={`border-t border-line-soft ${l.orders?.post_cutoff ? 'bg-late-bg' : ''}`}>
                <td className="px-4 py-2 font-semibold text-ink">
                  {l.customers.first_name} {l.customers.last_name ?? ''}
                </td>
                <td className="px-3 text-ink-2">{l.order_status}</td>
                <td className="px-3 text-ink-3 tnum">
                  {l.orders?.code ?? '—'}
                  {l.orders?.post_cutoff && (
                    <span className="ml-1.5 bg-late text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold">
                      PÓS-CUTOFF
                    </span>
                  )}
                </td>
                <td className="px-4 text-right text-brand-mid font-semibold tnum">
                  {l.orders ? money(l.orders.total_cents) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
