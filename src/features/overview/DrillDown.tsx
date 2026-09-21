import { Link } from 'react-router-dom'
import { money } from '../../lib/supabase'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { fetchLista, type Tipo } from './api'

/* Drill-down do Overview. Ref: protótipo 8c.
 *
 * §10: "clicar em qualquer número, barra ou fatia abre a lista de clientes ou
 * pedidos que o compõe". Sem isso o dashboard é um cartaz; com isso, todo
 * número tem de onde ser explicado — e a conferência vira um clique em vez de
 * uma consulta ao banco. */

const RECORTE = {
  total:        { titulo: 'Total Pedidos', nota: 'Novo + Renovação' },
  novo:         { titulo: '✅ Novo Pedido', nota: 'primeira compra' },
  renovacao:    { titulo: '🔁 Renovação',   nota: 'já pediram antes' },
  skip:         { titulo: '🕒 Skip',        nota: 'fora do Total Pedidos' },
  cancelamento: { titulo: '❌ Cancelamento', nota: 'fora do Total Pedidos' },
  parceria:     { titulo: '🎁 Parceria',    nota: 'valor comercial, não receita' },
  faturado:     { titulo: '💰 Faturado',    nota: 'pagamento confirmado' },
  a_receber:    { titulo: '⏳ A receber',   nota: 'pagamento ainda não confirmado' },
} as const

export type Recorte = keyof typeof RECORTE

export function DrillDown({
  tipo, chave, recorte, rotuloPeriodo, onFechar,
}: {
  tipo: Tipo; chave: string; recorte: Recorte
  rotuloPeriodo: string
  onFechar: () => void
}) {
  const { data, loading, error, reload } = useQuery(
    () => fetchLista(tipo, chave, recorte), [tipo, chave, recorte])

  const r = RECORTE[recorte]
  const linhas = data ?? []

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Fechar" onClick={onFechar}
        className="absolute inset-0 bg-ink/25" />

      <aside role="dialog" aria-label={`${r.titulo} · ${rotuloPeriodo}`}
        className="relative w-full max-w-md bg-cream h-full overflow-y-auto shadow-xl
                   flex flex-col">
        <header className="sticky top-0 bg-surface border-b border-line px-4 py-3 flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-[14px] font-bold text-brand">{r.titulo} · {rotuloPeriodo}</h2>
            <p className="text-[11px] text-ink-3">
              {/* durante a carga o contador fica de fora: "0 clientes" enquanto
                  a lista ainda vem lê-se como vazio, que é outra coisa */}
              {loading ? r.nota
                : <>{linhas.length} {linhas.length === 1 ? 'cliente' : 'clientes'} · {r.nota}</>}
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="text-[18px] text-ink-muted hover:text-ink leading-none">✕</button>
        </header>

        <div className="p-4">
          {loading ? <Loading shape="rows" label="Carregando a lista…" />
            : error ? <ErrorState message={error} onRetry={reload} />
            : linhas.length === 0 ? (
              <EmptyState icon="📋" title="Nenhum cliente neste recorte" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {linhas.map((l) => (
                  <li key={l.customer_id}
                    className="bg-surface border border-line rounded-lg px-3 py-2.5 flex gap-3 items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-bold text-ink">{l.cliente.trim()}</div>
                      <div className="text-[11px] text-ink-3">
                        {[l.plano, l.tamanho, l.rota ? `rota ${l.rota}` : null]
                          .filter(Boolean).join(' · ') || '—'}
                      </div>
                      {l.code && (
                        <div className="text-[10.5px] text-ink-muted tnum">#{l.code}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {l.total_cents != null && (
                        <div className="text-[12.5px] font-bold text-brand-mid tnum">
                          {money(l.total_cents)}
                        </div>
                      )}
                      <Link to={`/clientes?busca=${encodeURIComponent(l.cliente.trim())}`}
                        className="text-[11px] text-brand-mid hover:underline">
                        Ficha
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </aside>
    </div>
  )
}
