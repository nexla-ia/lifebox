import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apenasDigitos } from '../../lib/numero'
import { formatarTelefone } from '../../lib/telefone'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { fetchSemanaCorrente } from '../producao/api'
import {
  fetchBags, fetchMontagem, marcarGelo, marcarMontado, ordenarEntrega,
  type ParadaMontagem, type PratoMontagem, type SaldoBag,
} from './api'

/* Tela 9.9 · Montagem de domingo. Ref: protótipo 11a e 11f.
 *
 * DUAS FOLHAS, e é para imprimir (reunião de 22/09/2026):
 *
 *   · Cozinha — o pedido inteiro, montado, bags, gelo, coletar e as notas de
 *     montagem. É quem monta a sacola.
 *   · Driver  — nome, telefone, endereço, bags e as notas de entrega. SEM o
 *     pedido: o que vai dentro da sacola não é da conta de quem dirige, e a
 *     folha do carro fica curta o bastante para caber numa página.
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

type Visao = 'cozinha' | 'driver'

function Folha({ weekId, entrega, iso }: { weekId: string; entrega: string; iso: string }) {
  const { data, loading, error, reload } = useQuery(() => fetchMontagem(weekId), [weekId])
  const bags = useQuery(fetchBags, [])
  // Rota e visão moram na URL: imprimir a folha do driver de uma rota é mandar
  // um link, e recarregar no meio da conferência não volta para a primeira aba.
  const [params, setParams] = useSearchParams()
  const aba = params.get('rota') ?? ''
  const visao: Visao = params.get('visao') === 'driver' ? 'driver' : 'cozinha'
  const [erro, setErro] = useState<string | null>(null)

  const abas = useMemo(() => {
    const paradas = data ?? []
    const rotas = [...new Set(paradas.filter((p) => p.fulfillment === 'delivery')
      .map((p) => p.rota ?? 'Sem rota'))].sort()
    const temPickup = paradas.some((p) => p.fulfillment === 'pickup')
    return [...rotas, ...(temPickup ? ['Pick-up'] : [])]
  }, [data])

  const abaAtual = aba || abas[0] || ''
  const pickup = abaAtual === 'Pick-up'
  const paradas = useMemo(() => (data ?? []).filter((p) =>
    pickup ? p.fulfillment === 'pickup'
      : p.fulfillment === 'delivery' && (p.rota ?? 'Sem rota') === abaAtual),
  [data, abaAtual, pickup])

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
  // todo cliente recebe bag; só o pick-up fica fora (reunião de 22/09/2026)
  const bagsAEnviar = paradas.reduce(
    (s, p) => s + (p.montado || p.fulfillment !== 'delivery' ? 0 : p.bag_qty), 0)

  const trocarAba = (r: string) => setParams((q) => { q.set('rota', r); return q })
  const trocarVisao = (v: Visao) => setParams((q) => { q.set('visao', v); return q })

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap print:hidden">
        <h1 className="text-base font-bold text-brand">Montagem de domingo</h1>
        <span className="bg-surface border border-line rounded-lg px-3 py-1 text-[12.5px] text-ink-2">
          <strong className="text-brand">{iso.replace(/^\d+-/, '')}</strong>
          {' · entrega dom '}{new Date(entrega).toLocaleDateString('pt-BR')}
        </span>

        <div className="flex rounded-lg border border-line overflow-hidden">
          {(['cozinha', 'driver'] as Visao[]).map((v) => (
            <button key={v} onClick={() => trocarVisao(v)}
              aria-pressed={visao === v}
              className={`px-3.5 py-1.5 text-[12.5px] font-semibold ${
                visao === v ? 'bg-brand text-cream' : 'bg-surface text-ink-2 hover:bg-muted-bg'}`}>
              {v === 'cozinha' ? '👩‍🍳 Cozinha' : '🚚 Driver'}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <button onClick={() => window.print()}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          Imprimir folha {visao === 'driver' ? 'do driver' : 'da cozinha'}
        </button>
      </header>

      {/* só no papel: sem isto a folha impressa não diz de quem é nem de quando */}
      <div className="hidden print:block mb-2">
        <strong className="text-[14px]">
          {visao === 'driver' ? 'Folha do driver' : 'Folha da cozinha'} · {abaAtual}
        </strong>
        <span className="text-[12px]">
          {' — '}{iso.replace(/^\d+-/, '')}, entrega dom{' '}
          {new Date(entrega).toLocaleDateString('pt-BR')}
        </span>
      </div>

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
                <button key={r} onClick={() => trocarAba(r)}
                  className={`rounded-lg px-3.5 py-1.5 text-[12.5px] border ${
                    abaAtual === r ? 'bg-brand border-brand text-cream font-semibold'
                                   : 'bg-surface border-line text-ink-2 hover:border-brand'}`}>
                  {r} · {n} parada{n === 1 ? '' : 's'} · {ok} conferida{ok === 1 ? '' : 's'}
                </button>
              )
            })}
          </div>

          <div className="bg-surface border border-line rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap print:hidden">
            <span className="text-[12.5px] font-semibold text-brand">
              {abaAtual} · {montados} de {paradas.length} montados
            </span>
            <div className="flex-1 h-2 rounded-full bg-muted-bg overflow-hidden min-w-32">
              <div className="h-full bg-brand-mid"
                style={{ width: `${paradas.length ? (montados / paradas.length) * 100 : 0}%` }} />
            </div>
            {!pickup && <span className="text-[12px] text-ink-3">{bagsAEnviar} bags a enviar</span>}
          </div>

          {erro && (
            <div role="alert"
              className="bg-danger-bg border border-danger-line text-danger rounded-lg px-4 py-2.5 text-[12.5px]">
              {erro}
            </div>
          )}

          <Tabela
            paradas={paradas} visao={visao} pickup={pickup}
            coletarPorCliente={coletarPorCliente}
            onErro={setErro}
            onMudou={() => { setErro(null); reload(); bags.reload() }}
          />

          <p className="text-[11.5px] text-ink-muted print:hidden">
            {visao === 'cozinha' ? (
              <>
                Marcar <strong className="text-ink-2">Montado</strong> registra o envio das
                bags no controle. A coluna <strong className="text-late-text">Coletar</strong>{' '}
                vem da lista priorizada em Bags. Tamanho{' '}
                <strong className="text-late-text">Large</strong> e{' '}
                <strong className="text-ink">Small</strong>; num pedido que mistura, o{' '}
                <strong className="text-leaf">brasileiro</strong> sai em verde.
              </>
            ) : (
              <>
                A folha do driver não traz o pedido — só o que é preciso para entregar.
                Arraste as linhas para pôr na ordem do trajeto; a ordem vale para as duas
                folhas e fica salva.
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ tabela */

function Tabela({
  paradas, visao, pickup, coletarPorCliente, onMudou, onErro,
}: {
  paradas: ParadaMontagem[]
  visao: Visao
  pickup: boolean
  coletarPorCliente: Map<string, SaldoBag>
  onMudou: () => void
  onErro: (m: string) => void
}) {
  // Ordem local para o arrasto não piscar: soltar reordena na hora e só
  // depois o banco confirma. Sem isso a linha volta para o lugar antigo até a
  // consulta terminar, e parece que o arrasto não pegou.
  const [ordem, setOrdem] = useState<string[]>(() => paradas.map((p) => p.order_id))
  const [arrastando, setArrastando] = useState<string | null>(null)

  useEffect(() => { setOrdem(paradas.map((p) => p.order_id)) }, [paradas])

  const porId = new Map(paradas.map((p) => [p.order_id, p]))

  // A ordem local só vale quando cobre EXATAMENTE as paradas desta aba. Trocar
  // de rota troca `paradas` antes de o efeito rodar, e mapear a ordem antiga
  // dava uma tabela vazia por um quadro — pisca na tela, e um teste que olha
  // nesse instante conclui que a parada não existe.
  const local = ordem.length === paradas.length
    && paradas.every((p) => ordem.includes(p.order_id))
  const lista = local ? (ordem.map((id) => porId.get(id)!)) : paradas

  async function mover(de: number, para: number) {
    if (de === para || para < 0 || para >= ordem.length) return
    const nova = ordem.slice()
    const [id] = nova.splice(de, 1)
    nova.splice(para, 0, id)
    setOrdem(nova)
    const { error } = await ordenarEntrega(nova)
    if (error) { onErro(error.message); return }
    onMudou()
  }

  return (
    <section className="bg-surface border border-line rounded-xl overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-surface-alt text-[10px] uppercase tracking-wide text-ink-muted">
            <th className="w-8 text-center font-semibold py-2">#</th>
            <th className="text-left font-semibold px-3 min-w-44">Cliente</th>
            {!pickup && <th className="text-left font-semibold px-3 min-w-40">Endereço</th>}
            {visao === 'cozinha' && (
              <th className="text-left font-semibold px-3 min-w-72">Pedido</th>
            )}
            {visao === 'cozinha' && <th className="w-16 text-center font-semibold">Montado</th>}
            {!pickup && <th className="w-14 text-center font-semibold">Bags</th>}
            {visao === 'cozinha' && <th className="w-12 text-center font-semibold">Gelo</th>}
            {visao === 'cozinha' && !pickup && (
              <th className="w-16 text-center font-semibold">Coletar</th>
            )}
            <th className="text-left font-semibold px-3 min-w-36">
              {visao === 'driver' ? 'Notas de entrega' : 'Notas'}
            </th>
          </tr>
        </thead>
        <tbody>
          {lista.map((p, i) => (
            <Linha
              key={p.order_id} n={i + 1} p={p} visao={visao} pickup={pickup}
              coletar={coletarPorCliente.get(p.cliente)?.balance ?? 0}
              arrastando={arrastando === p.order_id}
              onArrastar={() => setArrastando(p.order_id)}
              onSoltar={() => {
                const de = ordem.indexOf(arrastando ?? '')
                setArrastando(null)
                if (de >= 0) void mover(de, i)
              }}
              onSubir={() => void mover(i, i - 1)}
              onDescer={() => void mover(i, i + 1)}
              onErro={onErro}
              onMudou={onMudou}
            />
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** A cor do prato na folha da cozinha (reunião de 22/09/2026).
 *
 *  Verde ganha do tamanho: num pedido que mistura clássico e brasileiro, o que
 *  atrapalha é separar as duas linhas, não o tamanho — e é essa a troca que
 *  acontece na bancada. */
function corDoPrato(prato: PratoMontagem, misto: boolean) {
  if (misto && prato.categoria === 'brasileiro') return 'text-leaf font-semibold'
  if (prato.size === 'L') return 'text-late-text font-semibold'
  return 'text-ink'
}

function Linha({
  n, p, visao, pickup, coletar, arrastando,
  onArrastar, onSoltar, onSubir, onDescer, onMudou, onErro,
}: {
  n: number; p: ParadaMontagem; visao: Visao; pickup: boolean; coletar: number
  arrastando: boolean
  onArrastar: () => void; onSoltar: () => void
  onSubir: () => void; onDescer: () => void
  onMudou: () => void; onErro: (m: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [bags, setBags] = useState(String(p.bag_qty))
  const [salvandoBags, setSalvandoBags] = useState(false)

  useEffect(() => { setBags(String(p.bag_qty)) }, [p.order_id, p.bag_qty])

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
    <tr
      draggable={!pickup}
      onDragStart={onArrastar}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onSoltar}
      className={`border-t border-line-soft ${p.montado ? 'bg-ok-bg/40' : ''} ${
        arrastando ? 'opacity-50' : ''}`}
    >
      <td className="text-center py-2 font-bold text-brand tnum align-top">
        {n}
        {/* Arrastar sozinho não serve: não funciona no toque de muitos
            navegadores e o teclado não alcança. Os dois botões são o mesmo
            recurso por outro caminho. */}
        {!pickup && (
          <div className="flex flex-col items-center print:hidden">
            <button onClick={onSubir} aria-label={`Subir ${p.cliente} na ordem de entrega`}
              className="text-[9px] text-ink-muted hover:text-brand leading-none">▲</button>
            <button onClick={onDescer} aria-label={`Descer ${p.cliente} na ordem de entrega`}
              className="text-[9px] text-ink-muted hover:text-brand leading-none">▼</button>
          </div>
        )}
      </td>

      <td className="px-3 py-2 align-top">
        <div className="text-[13px] font-bold text-ink">{p.cliente}</div>
        <div className="text-[11px] text-ink-3 tnum">{formatarTelefone(p.telefone)}</div>
        <div className="flex gap-1 flex-wrap mt-1">
          {p.entregar_com && <Selo tom="info">JUNTO COM {p.entregar_com}</Selo>}
          {p.post_cutoff && <Selo tom="late">PÓS-CUTOFF</Selo>}
          {pickup && <Selo tom="accent">RETIRA NA COZINHA</Selo>}
        </div>
      </td>

      {!pickup && (
        <td className="px-3 py-2 text-ink-2 align-top">
          <div>{p.endereco ?? '—'}</div>
          <div className="text-[11px] text-ink-muted">{p.cidade ?? ''}</div>
        </td>
      )}

      {visao === 'cozinha' && (
        <td className="px-3 py-2 align-top">
          <div className="text-[12.5px] font-bold text-ink">
            {p.plano ?? '—'}{p.size && ` · ${p.size}`}
          </div>
          <div className="text-[11.5px] leading-snug">
            {p.pratos.length === 0 ? '—' : p.pratos.map((d, k) => (
              <span key={k}>
                {k > 0 && <span className="text-line-strong"> · </span>}
                <span className={corDoPrato(d, p.misto)}>
                  {d.nome} ×{d.qty}{d.size && ` (${d.size})`}
                </span>
              </span>
            ))}
          </div>
          {p.adicionais && (
            <div className="text-[11.5px] text-accent leading-snug mt-0.5">＋ {p.adicionais}</div>
          )}
        </td>
      )}

      {visao === 'cozinha' && (
        <td className="text-center py-2 align-top">
          <button onClick={alternarMontado} disabled={ocupado}
            aria-label={`${p.montado ? 'Desmarcar' : 'Marcar'} ${p.cliente} como montado`}
            className={`w-6 h-6 rounded-md border-2 grid place-items-center text-[14px] font-bold ${
              p.montado ? 'bg-brand border-brand text-lime' : 'bg-surface border-line-strong'}`}>
            {p.montado ? '✓' : ''}
          </button>
        </td>
      )}

      {!pickup && (
        <td className="text-center py-2 align-top">
          {visao === 'cozinha' ? (
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
          ) : (
            /* O driver LÊ quantas bags leva; quem altera é a cozinha, que é
               quem conta na hora de fechar a sacola. */
            <span className="tnum font-bold text-ink">{p.bag_qty}</span>
          )}
        </td>
      )}

      {visao === 'cozinha' && (
        <td className="text-center py-2 align-top">
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
      )}

      {visao === 'cozinha' && !pickup && (
        <td className={`text-center py-2 font-bold tnum align-top ${
          coletar ? 'text-late-text' : 'text-line-strong'}`}>
          {coletar || '—'}
        </td>
      )}

      <td className="px-3 py-2 text-[11.5px] text-ink-3 leading-snug align-top">
        {p.delivery_notes && <div>🚚 {p.delivery_notes}</div>}
        {/* nota de escritório é recado interno de montagem — não vai na folha
            do carro, que a pessoa lê na porta do cliente */}
        {visao === 'cozinha' && p.office_notes && (
          <div className="text-ink-muted">🗒️ {p.office_notes}</div>
        )}
        {!p.delivery_notes && (visao === 'driver' || !p.office_notes) && '—'}
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
