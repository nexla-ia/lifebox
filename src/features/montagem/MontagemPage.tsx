import { useMemo, useState } from 'react'
import { apenasDigitos } from '../../lib/numero'
import { formatarTelefone } from '../../lib/telefone'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { fetchSemanaCorrente } from '../producao/api'
import {
  fetchBags, fetchMontagem, marcarGelo, marcarMontado,
  type ParadaMontagem, type SaldoBag,
} from './api'

/* Tela 9.9 · Montagem de domingo. Ref: protótipo 11a e 11f.
 *
 * Uma aba por rota, mais Pick-up. O pedido inteiro na linha, e as colunas de
 * conferência: Montado, Bags, Gelo, Coletar.
 *
 * §6.7: marcar Montado REGISTRA o envio das bags — as duas coisas na mesma
 * função do banco, senão o saldo mente. Quem não usa bag térmica e quem
 * retira na cozinha ficam fora do controle, com 0 bags. */

export function MontagemPage() {
  const semana = useQuery(fetchSemanaCorrente, [])
  const weekId = semana.data?.id

  if (semana.loading) return <div className="p-5"><Loading shape="rows" label="Carregando a semana…" /></div>
  if (semana.error) return <div className="p-5"><ErrorState message={semana.error} onRetry={semana.reload} /></div>
  if (!semana.data || !weekId) {
    return (
      <div className="p-5">
        <EmptyState icon="📦" title="Nenhuma semana aberta ainda"
          body="A folha de montagem aparece quando houver pedidos na semana." />
      </div>
    )
  }

  return <Folha weekId={weekId} entrega={semana.data.ends_on} iso={semana.data.iso_code} />
}

function Folha({ weekId, entrega, iso }: { weekId: string; entrega: string; iso: string }) {
  const { data, loading, error, reload } = useQuery(() => fetchMontagem(weekId), [weekId])
  const bags = useQuery(fetchBags, [])
  const [aba, setAba] = useState<string>('')
  const [erro, setErro] = useState<string | null>(null)

  const abas = useMemo(() => {
    const paradas = data ?? []
    const rotas = [...new Set(paradas.filter((p) => p.fulfillment === 'delivery')
      .map((p) => p.rota ?? 'Sem rota'))].sort()
    const temPickup = paradas.some((p) => p.fulfillment === 'pickup')
    return [...rotas, ...(temPickup ? ['Pick-up'] : [])]
  }, [data])

  const abaAtual = aba || abas[0] || ''
  const paradas = (data ?? []).filter((p) =>
    abaAtual === 'Pick-up' ? p.fulfillment === 'pickup'
      : p.fulfillment === 'delivery' && (p.rota ?? 'Sem rota') === abaAtual)

  // §6.7: a coluna Coletar vem da lista priorizada de bags
  const coletarPorCliente = useMemo(() => {
    const m = new Map<string, SaldoBag>()
    for (const c of bags.data?.coleta ?? []) {
      if (c.prioridade <= 2) m.set(`${c.first_name} ${c.last_name ?? ''}`.trim(), c)
    }
    return m
  }, [bags.data])

  if (loading) return <div className="p-5"><Loading shape="rows" label="Montando a folha…" /></div>
  if (error) return <div className="p-5"><ErrorState message={error} onRetry={reload} /></div>

  const montados = paradas.filter((p) => p.montado).length
  const bagsAEnviar = paradas.reduce((s, p) => s + (p.montado ? 0 : p.usa_bag && p.fulfillment === 'delivery' ? p.bag_qty : 0), 0)

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap print:hidden">
        <h1 className="text-base font-bold text-brand">Montagem de domingo</h1>
        <span className="bg-surface border border-line rounded-lg px-3 py-1 text-[12.5px] text-ink-2">
          <strong className="text-brand">{iso.replace(/^\d+-/, '')}</strong>
          {' · entrega dom '}{new Date(entrega).toLocaleDateString('pt-BR')}
        </span>
        <div className="flex-1" />
        <button onClick={() => window.print()}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          Imprimir folha da rota
        </button>
      </header>

      {abas.length === 0 ? (
        <section className="bg-surface border border-line rounded-xl">
          <EmptyState icon="📦" title="Nenhum pedido para montar"
            body="A folha se monta sozinha conforme os pedidos entram na Semana." />
        </section>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap items-center print:hidden">
            {abas.map((r) => {
              const n = (data ?? []).filter((p) =>
                r === 'Pick-up' ? p.fulfillment === 'pickup'
                  : p.fulfillment === 'delivery' && (p.rota ?? 'Sem rota') === r).length
              const ok = (data ?? []).filter((p) =>
                (r === 'Pick-up' ? p.fulfillment === 'pickup'
                  : p.fulfillment === 'delivery' && (p.rota ?? 'Sem rota') === r) && p.montado).length
              return (
                <button key={r} onClick={() => setAba(r)}
                  className={`rounded-lg px-3.5 py-1.5 text-[12.5px] border ${
                    abaAtual === r ? 'bg-brand border-brand text-cream font-semibold'
                                   : 'bg-surface border-line text-ink-2 hover:border-brand'}`}>
                  {r} · {n} parada{n === 1 ? '' : 's'} · {ok} conferida{ok === 1 ? '' : 's'}
                </button>
              )
            })}
          </div>

          <div className="bg-surface border border-line rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="text-[12.5px] font-semibold text-brand">
              {abaAtual} · {montados} de {paradas.length} montados
            </span>
            <div className="flex-1 h-2 rounded-full bg-muted-bg overflow-hidden min-w-32">
              <div className="h-full bg-brand-mid"
                style={{ width: `${paradas.length ? (montados / paradas.length) * 100 : 0}%` }} />
            </div>
            {abaAtual !== 'Pick-up' && (
              <span className="text-[12px] text-ink-3">{bagsAEnviar} bags a enviar</span>
            )}
          </div>

          {erro && (
            <div role="alert"
              className="bg-danger-bg border border-danger-line text-danger rounded-lg px-4 py-2.5 text-[12.5px]">
              {erro}
            </div>
          )}

          <section className="bg-surface border border-line rounded-xl overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-surface-alt text-[10px] uppercase tracking-wide text-ink-muted">
                  <th className="w-8 text-center font-semibold py-2">#</th>
                  <th className="text-left font-semibold px-3 min-w-44">Cliente</th>
                  {abaAtual !== 'Pick-up' && (
                    <th className="text-left font-semibold px-3 min-w-40">Endereço</th>
                  )}
                  <th className="text-left font-semibold px-3 min-w-72">Pedido</th>
                  <th className="w-16 text-center font-semibold">Montado</th>
                  {abaAtual !== 'Pick-up' && <th className="w-14 text-center font-semibold">Bags</th>}
                  <th className="w-12 text-center font-semibold">Gelo</th>
                  {abaAtual !== 'Pick-up' && <th className="w-16 text-center font-semibold">Coletar</th>}
                  <th className="text-left font-semibold px-3 min-w-36">Notas</th>
                </tr>
              </thead>
              <tbody>
                {paradas.map((p, i) => (
                  <Linha key={p.order_id} n={i + 1} p={p} pickup={abaAtual === 'Pick-up'}
                    coletar={coletarPorCliente.get(p.cliente)?.balance ?? 0}
                    onErro={setErro}
                    onMudou={() => { setErro(null); reload(); bags.reload() }} />
                ))}
              </tbody>
            </table>
          </section>

          <p className="text-[11.5px] text-ink-muted print:hidden">
            Marcar <strong className="text-ink-2">Montado</strong> registra o envio das bags
            no controle. A coluna <strong className="text-late-text">Coletar</strong> vem da
            lista priorizada em Bags. Rota é editável por cliente — o ZIP só sugere.
          </p>
        </>
      )}
    </div>
  )
}

function Linha({
  n, p, pickup, coletar, onMudou, onErro,
}: {
  n: number; p: ParadaMontagem; pickup: boolean; coletar: number
  onMudou: () => void; onErro: (m: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [bags, setBags] = useState(String(p.bag_qty))
  const [salvandoBags, setSalvandoBags] = useState(false)

  /** O banco recusa desmarcar quando já houve devolução, e a mensagem é escrita
   *  para quem está na folha ("ajuste a devolução primeiro"). Engolir o erro
   *  deixaria o clique sem efeito e sem explicação — parece tela travada. */
  async function alternarMontado() {
    setOcupado(true)
    const { error } = await marcarMontado(p.order_id, Number(bags) || 0, !p.montado)
    setOcupado(false)
    if (error) { onErro(error.message); return }
    onMudou()
  }

  /** Salvar no blur sem retorno visual perde o número se a pessoa sair da tela
   *  no meio — numa folha de conferência isso é uma bag some do controle. O
   *  input trava enquanto grava, então dá para ver que ainda não terminou. */
  async function salvarBags() {
    if (Number(bags) === p.bag_qty) return
    setSalvandoBags(true)
    const { error } = await marcarMontado(p.order_id, Number(bags) || 0, p.montado)
    setSalvandoBags(false)
    if (error) { onErro(error.message); return }
    onMudou()
  }

  return (
    <tr className={`border-t border-line-soft ${p.montado ? 'bg-ok-bg/40' : ''}`}>
      <td className="text-center py-2 font-bold text-brand tnum">{n}</td>

      <td className="px-3 py-2">
        <div className="text-[13px] font-bold text-ink">{p.cliente}</div>
        <div className="text-[11px] text-ink-3 tnum">{formatarTelefone(p.telefone)}</div>
        <div className="flex gap-1 flex-wrap mt-1">
          {!p.usa_bag && (
            <Selo tom="warn">SEM BAG · SÓ PAPEL</Selo>
          )}
          {p.entregar_com && <Selo tom="info">JUNTO COM {p.entregar_com}</Selo>}
          {p.post_cutoff && <Selo tom="late">PÓS-CUTOFF</Selo>}
          {pickup && <Selo tom="accent">RETIRA NA COZINHA</Selo>}
        </div>
      </td>

      {!pickup && (
        <td className="px-3 py-2 text-ink-2">
          <div>{p.endereco ?? '—'}</div>
          <div className="text-[11px] text-ink-muted">{p.cidade ?? ''}</div>
        </td>
      )}

      <td className="px-3 py-2">
        <div className="text-[12.5px] font-bold text-ink">
          {p.plano ?? '—'}{p.size && ` · ${p.size}`}
        </div>
        <div className="text-[11.5px] text-ink-2 leading-snug">{p.pratos || '—'}</div>
        {p.adicionais && (
          <div className="text-[11.5px] text-accent leading-snug mt-0.5">＋ {p.adicionais}</div>
        )}
      </td>

      <td className="text-center py-2">
        <button onClick={alternarMontado} disabled={ocupado}
          aria-label={`${p.montado ? 'Desmarcar' : 'Marcar'} ${p.cliente} como montado`}
          className={`w-6 h-6 rounded-md border-2 grid place-items-center text-[14px] font-bold ${
            p.montado ? 'bg-brand border-brand text-lime' : 'bg-surface border-line-strong'}`}>
          {p.montado ? '✓' : ''}
        </button>
      </td>

      {!pickup && (
        <td className="text-center py-2">
          {p.usa_bag ? (
            <input
              aria-label={`Bags de ${p.cliente}`}
              value={bags}
              disabled={salvandoBags}
              inputMode="numeric"
              onChange={(e) => setBags(apenasDigitos(e.target.value))}
              onBlur={salvarBags}
              onKeyDown={(e) => { if (e.key === 'Enter') void salvarBags() }}
              className={`w-10 text-center border rounded-md py-0.5 outline-none tnum font-bold ${
                salvandoBags
                  ? 'border-brand bg-leaf-bg text-brand'
                  : 'border-line-strong bg-surface-alt focus:border-brand'}`}
            />
          ) : <span className="text-ink-muted">—</span>}
        </td>
      )}

      <td className="text-center py-2">
        <button
          onClick={async () => {
            const { error } = await marcarGelo(p.order_id, !p.gelo)
            if (error) { onErro(error.message); return }
            onMudou()
          }}
          aria-label={`${p.gelo ? 'Desmarcar' : 'Marcar'} gelo de ${p.cliente}`}
          className={`w-6 h-6 rounded-md border-2 grid place-items-center text-[14px] font-bold ${
            p.gelo ? 'bg-brand border-brand text-lime' : 'bg-surface border-line-strong'}`}>
          {p.gelo ? '✓' : ''}
        </button>
      </td>

      {!pickup && (
        <td className={`text-center py-2 font-bold tnum ${coletar ? 'text-late-text' : 'text-line-strong'}`}>
          {coletar || '—'}
        </td>
      )}

      <td className="px-3 py-2 text-[11.5px] text-ink-3 leading-snug">
        {p.delivery_notes && <div>🚚 {p.delivery_notes}</div>}
        {p.office_notes && <div className="text-ink-muted">🗒️ {p.office_notes}</div>}
        {!p.delivery_notes && !p.office_notes && '—'}
      </td>
    </tr>
  )
}

function Selo({ tom, children }: { tom: 'warn' | 'info' | 'late' | 'accent'; children: React.ReactNode }) {
  const cls = {
    warn: 'bg-warn-bg border-warn-line text-warn',
    info: 'bg-info-bg border-info-line text-info',
    late: 'bg-late text-white border-late',
    accent: 'bg-accent-bg border-accent-line text-accent',
  }[tom]
  return (
    <span className={`border rounded-full px-2 py-0.5 text-[9.5px] font-bold ${cls}`}>
      {children}
    </span>
  )
}
