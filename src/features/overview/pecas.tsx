import type { ReactNode } from 'react'
import { money } from '../../lib/supabase'

/* Peças do Overview. Ref: protótipo 8a e 8f.
 *
 * Os gráficos são barras e um donut desenhados à mão, sem biblioteca: o
 * protótipo já é assim, são cinco formas ao todo, e uma dependência de gráfico
 * custaria mais bundle do que a tela inteira. */

export function Card({
  titulo, valor, delta, nota, onAbrir, tom = 'ink',
}: {
  titulo: string
  valor: string
  delta?: number | null
  nota?: ReactNode
  onAbrir?: () => void
  tom?: 'ink' | 'brand'
}) {
  const conteudo = (
    <>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
        {titulo}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span aria-label={titulo}
          className={`text-[21px] font-bold leading-tight tnum ${
            tom === 'brand' ? 'text-brand' : 'text-ink'}`}>
          {valor}
        </span>
        {delta != null && <Delta pct={delta} />}
      </div>
      {nota && <div className="text-[10.5px] text-ink-muted leading-snug">{nota}</div>}
    </>
  )

  if (!onAbrir) {
    return <div className="bg-surface border border-line rounded-xl px-3.5 py-3">{conteudo}</div>
  }
  return (
    <button onClick={onAbrir}
      className="bg-surface border border-line rounded-xl px-3.5 py-3 text-left
                 hover:border-brand transition-colors">
      {conteudo}
    </button>
  )
}

/** ▲ / ▼ com o sinal certo. Sem base de comparação não inventa 100%: some. */
export function Delta({ pct }: { pct: number }) {
  const subiu = pct >= 0
  return (
    <span className={`text-[11.5px] font-semibold tnum ${subiu ? 'text-ok' : 'text-danger'}`}>
      {subiu ? '▲' : '▼'} {Math.abs(pct).toFixed(1).replace('.', ',')}%
    </span>
  )
}

export function Bloco({
  titulo, nota, children, acao,
}: { titulo: string; nota?: ReactNode; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3 flex flex-col gap-2">
      <header className="flex items-center gap-2 flex-wrap">
        <h2 className="text-[12.5px] font-bold text-brand">{titulo}</h2>
        <div className="flex-1" />
        {acao}
      </header>
      {children}
      {nota && <p className="text-[10.5px] text-ink-muted leading-snug">{nota}</p>}
    </section>
  )
}

/** Barras de receita com meta e ano anterior (tela 8a).
 *
 *  O período em andamento aparece tracejado: o número dele ainda vai mudar, e
 *  mostrá-lo igual aos fechados faria a barra menor parecer queda. */
export function BarrasReceita({
  pontos, onAbrir,
}: {
  pontos: { rotulo: string; total_cents: number; meta_cents: number
            ano_anterior_cents: number; em_andamento: boolean; chave: string }[]
  onAbrir: (chave: string) => void
}) {
  const teto = Math.max(
    1, ...pontos.map((p) => Math.max(p.total_cents, p.meta_cents, p.ano_anterior_cents)))

  // `max-w` não é enfeite: com uma semana só no banco a barra ocuparia a
  // largura inteira e viraria um bloco, não um gráfico
  return (
    <div className="flex gap-3 items-end h-44 pt-2">
      {pontos.map((p) => {
        const alt = (v: number) => `${Math.max(2, (v / teto) * 100)}%`
        return (
          <button key={p.chave} onClick={() => onAbrir(p.chave)}
            aria-label={`${p.rotulo}: ${money(p.total_cents)}`}
            className="flex-1 max-w-24 h-full flex flex-col justify-end items-center gap-1 group">
            <span className="text-[10px] text-ink-3 tnum opacity-0 group-hover:opacity-100">
              {money(p.total_cents)}
            </span>
            <div className="w-full relative flex-1 flex items-end">
              {p.meta_cents > 0 && (
                <div className="absolute left-0 right-0 border-t-2 border-dashed border-warn-strong"
                  style={{ bottom: alt(p.meta_cents) }} aria-hidden="true" />
              )}
              {p.ano_anterior_cents > 0 && (
                <div className="absolute left-0 right-0 border-t border-dotted border-ink-muted"
                  style={{ bottom: alt(p.ano_anterior_cents) }} aria-hidden="true" />
              )}
              <div className={`w-full rounded-t ${
                p.em_andamento
                  ? 'bg-[repeating-linear-gradient(45deg,var(--color-brand-mid)_0_6px,transparent_6px_12px)] border border-brand-mid'
                  : 'bg-brand-mid group-hover:bg-brand'}`}
                style={{ height: alt(p.total_cents) }} />
            </div>
            <span className="text-[10.5px] text-ink-3 font-semibold">{p.rotulo}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Entrada e saída de clientes: Novo e Renovação acima do eixo, Skip e
 *  Cancelamento abaixo (§10). O eixo no meio é o que faz "saiu" ser lido como
 *  saída, e não como mais uma barra. */
export function EntradaSaida({
  pontos,
}: {
  pontos: { rotulo: string; novo: number; renovacao: number
            skip: number; cancelamento: number }[]
}) {
  const teto = Math.max(
    1, ...pontos.map((p) => Math.max(p.novo + p.renovacao, p.skip + p.cancelamento)))
  const h = (n: number) => `${(n / teto) * 100}%`

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3 items-end h-16">
        {pontos.map((p) => (
          <div key={p.rotulo} className="flex-1 max-w-24 h-full flex flex-col justify-end"
            aria-label={`${p.rotulo}: ${p.novo} novos, ${p.renovacao} renovações`}>
            <div className="w-full bg-info" style={{ height: h(p.renovacao) }} />
            <div className="w-full bg-ok rounded-t" style={{ height: h(p.novo) }} />
          </div>
        ))}
      </div>
      <div className="border-t border-line-strong" />
      <div className="flex gap-3 items-start h-10">
        {pontos.map((p) => (
          <div key={p.rotulo} className="flex-1 max-w-24 h-full flex flex-col"
            aria-label={`${p.rotulo}: ${p.skip} skip, ${p.cancelamento} cancelamentos`}>
            <div className="w-full bg-warn-strong" style={{ height: h(p.skip) }} />
            <div className="w-full bg-danger rounded-b" style={{ height: h(p.cancelamento) }} />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        {pontos.map((p) => (
          <span key={p.rotulo} className="flex-1 max-w-24 text-center text-[10.5px] text-ink-3 font-semibold">
            {p.rotulo}
          </span>
        ))}
      </div>
      <div className="flex gap-3 flex-wrap text-[10.5px] text-ink-3 mt-1">
        <Legenda cor="bg-ok">✅ Novo</Legenda>
        <Legenda cor="bg-info">🔁 Renovação</Legenda>
        <Legenda cor="bg-warn-strong">🕒 Skip</Legenda>
        <Legenda cor="bg-danger">❌ Cancelamento</Legenda>
      </div>
    </div>
  )
}

function Legenda({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-2.5 h-2.5 rounded-sm ${cor}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Lista com barra proporcional. Serve para mix de planos, origens e top
 *  pratos — três blocos com a mesma pergunta: quanto cada um pesa. */
export function ListaBarras({
  itens, onAbrir, sufixo,
}: {
  itens: { nome: string; valor: number; nota?: string }[]
  onAbrir?: (nome: string) => void
  sufixo?: string
}) {
  const total = itens.reduce((s, i) => s + i.valor, 0)
  if (itens.length === 0) return null

  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((i) => {
        const pct = total > 0 ? (i.valor / total) * 100 : 0
        const linha = (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] text-ink-2 flex-1 truncate">{i.nome}</span>
              <span className="text-[12px] font-bold text-ink tnum">
                {i.valor}{sufixo}
              </span>
              <span className="text-[10.5px] text-ink-muted tnum w-11 text-right">
                {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted-bg overflow-hidden">
              <div className="h-full bg-brand-mid rounded-full" style={{ width: `${pct}%` }} />
            </div>
            {i.nota && <div className="text-[10px] text-ink-muted">{i.nota}</div>}
          </>
        )
        return (
          <li key={i.nome}>
            {onAbrir ? (
              <button onClick={() => onAbrir(i.nome)} className="w-full text-left">
                {linha}
              </button>
            ) : linha}
          </li>
        )
      })}
    </ul>
  )
}

/** Funil: cada degrau com a queda até o próximo (tela 8a). */
export function Funil({
  passos,
}: { passos: { rotulo: string; valor: number }[] }) {
  const topo = Math.max(1, passos[0]?.valor ?? 1)
  return (
    <div className="flex flex-col gap-1">
      {passos.map((p, i) => {
        const anterior = i > 0 ? passos[i - 1].valor : null
        const queda = anterior && anterior > 0 ? (p.valor / anterior) * 100 : null
        return (
          <div key={p.rotulo}>
            {queda !== null && (
              <div className="text-[10px] text-ink-muted pl-1 py-0.5">
                ↓ {queda.toFixed(1).replace('.', ',')}%
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="h-7 rounded bg-leaf-bg border border-leaf-line grid place-items-center
                              text-[12px] font-bold text-leaf tnum min-w-10 px-2"
                style={{ width: `${Math.max(12, (p.valor / topo) * 100)}%` }}>
                {p.valor}
              </div>
              <span className="text-[11.5px] text-ink-2">{p.rotulo}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
