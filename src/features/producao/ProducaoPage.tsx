import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import {
  agrupar, fetchMatriz, fetchProducao, fetchSemanaCorrente,
  type CelulaMatriz, type Producao,
} from './api'

/* Tela 9.3 · Produção da cozinha. Ref: protótipo 3a, 3b, 3c, 3d.
 *
 * Duas visões: a agregada é o número que vai para a bancada; a matriz
 * reproduz a aba MENU ## da planilha, para conferência item a item.
 *
 * O perfil Cozinha só vê a agregada, em alto contraste e sem valores,
 * contatos ou endereços (§3). A matriz mostra nome de cliente, então nem
 * aparece para ela — e se tentasse, a RLS devolveria vazio.
 *
 * Adicionais não entram aqui: saem do estoque, não da produção (§5.4). A view
 * v_production já filtra item_type='dish'. */

const CATEGORIAS: Record<string, string> = {
  classico: 'Menu Clássico',
  brasileiro: 'Menu Brasileiro',
  breakfast: 'Breakfast',
}

export function ProducaoPage() {
  const { profile } = useAuth()
  const ehCozinha = profile?.role === 'cozinha'
  const [visao, setVisao] = useState<'agregada' | 'matriz'>('agregada')

  const semana = useQuery(fetchSemanaCorrente, [])
  const weekId = semana.data?.id

  if (semana.loading) return <div className="p-5"><Loading shape="blocks" label="Carregando a semana…" /></div>
  if (semana.error) return <div className="p-5"><ErrorState message={semana.error} onRetry={semana.reload} /></div>

  const s = semana.data
  if (!s || !weekId) {
    return (
      <div className="p-5">
        <EmptyState icon="📋" title="Nenhuma semana aberta ainda"
          body="A semana abre sozinha na segunda-feira. A contagem aparece aqui conforme os pedidos entrarem." />
      </div>
    )
  }

  return (
    <div className={`p-5 flex flex-col gap-4 ${ehCozinha ? 'bg-white min-h-screen' : ''}`}>
      <header className="flex items-center gap-3 flex-wrap print:hidden">
        <h1 className={ehCozinha
          ? 'text-[26px] font-extrabold text-black tracking-tight'
          : 'text-base font-bold text-brand'}>
          {ehCozinha ? `PRODUÇÃO — ${s.iso_code.replace(/^\d+-/, '')}` : 'Produção da cozinha'}
        </h1>
        {!ehCozinha && (
          <span className="bg-surface border border-line rounded-lg px-3 py-1 text-[12.5px] text-ink-2">
            <strong className="text-brand">{s.iso_code.replace(/^\d+-/, '')}</strong>
            {' · entrega dom '}
            {new Date(s.ends_on).toLocaleDateString('pt-BR')}
          </span>
        )}
        {ehCozinha && (
          <span className="text-[14px] text-black/70">
            entrega domingo {new Date(s.ends_on).toLocaleDateString('pt-BR')}
          </span>
        )}

        {!ehCozinha && (
          <div className="flex bg-surface border border-line rounded-lg p-0.5 gap-0.5">
            {(['agregada', 'matriz'] as const).map((v) => (
              <button key={v} onClick={() => setVisao(v)}
                className={`rounded-md px-3.5 py-1 text-[12px] capitalize ${
                  visao === v ? 'bg-brand text-cream font-semibold' : 'text-ink-2 hover:bg-cream'}`}>
                {v}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />
        <button onClick={() => window.print()}
          className={ehCozinha
            ? 'bg-black text-white rounded-lg px-4 py-2 text-[13px] font-bold'
            : 'bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold'}>
          Imprimir folha
        </button>
      </header>

      {visao === 'agregada' || ehCozinha
        ? <Agregada weekId={weekId} ehCozinha={ehCozinha} />
        : <Matriz weekId={weekId} />}
    </div>
  )
}

function Agregada({ weekId, ehCozinha }: { weekId: string; ehCozinha: boolean }) {
  const { data, loading, error, reload } = useQuery(() => fetchProducao(weekId), [weekId])
  // só os tamanhos que aparecem nesta semana, na ordem do catálogo
  const tamanhos = useMemo(() => {
    const usados = new Set((data?.linhas ?? []).map((l) => l.size_code).filter(Boolean))
    return (data?.tamanhos ?? []).filter((t) => usados.has(t))
  }, [data])

  const grupos = useMemo(
    () => agrupar(data?.linhas ?? [], tamanhos), [data, tamanhos])

  if (loading) return <Loading shape="blocks" label="Somando as seleções da semana…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const totalItens = grupos.reduce((s, g) => s + g.total, 0)
  const recontagem = (data.linhas ?? []).filter((l) => l.has_post_cutoff)

  if (totalItens === 0) {
    return (
      <section className={ehCozinha ? '' : 'bg-surface border border-line rounded-xl'}>
        <EmptyState
          icon="✓"
          title="Semana aberta, ainda sem pratos selecionados"
          body="A contagem aparece aqui sozinha conforme os pedidos entrarem na Semana. Tudo certo — só é cedo."
        />
      </section>
    )
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap print:hidden">
        <Chip ehCozinha={ehCozinha}>
          <strong>{totalItens} itens</strong> na semana
        </Chip>
        {grupos.map((g) => (
          <Chip key={g.categoria} ehCozinha={ehCozinha}>
            {CATEGORIAS[g.categoria] ?? g.categoria}: <strong>{g.total}</strong>
          </Chip>
        ))}
      </div>

      {/* §6.8: restrições e alergias no topo da folha, antes de qualquer número */}
      {data.notas.length > 0 && <Notas notas={data.notas} ehCozinha={ehCozinha} />}

      {/* §4: pedido lançado depois de quinta muda a contagem já impressa */}
      {recontagem.length > 0 && (
        <div className={ehCozinha
          ? 'bg-warn-bg border-2 border-warn-strong rounded-lg px-4 py-2.5 text-[14px] font-semibold text-warn'
          : 'bg-warn-bg border border-warn-line rounded-lg px-4 py-2.5 text-[12.5px] text-warn'}>
          ⏰ <strong>Recontagem pós-cutoff.</strong> Entraram pedidos depois da contagem de
          quinta: {recontagem.map((l) => `${l.dish_name_pt} (${l.size_code}) +${l.qty_post_cutoff}`)
            .join(' · ')}. Reimprima a folha.
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3 items-start">
        {grupos.map((g) => (
          <Bloco key={g.categoria} titulo={CATEGORIAS[g.categoria] ?? g.categoria}
            grupo={g} tamanhos={tamanhos} ehCozinha={ehCozinha} />
        ))}
      </div>

      <p className={`text-[11.5px] ${ehCozinha ? 'text-black/60' : 'text-ink-muted'}`}>
        Detox e sucos não entram na folha — saem do estoque, não da produção.
      </p>
    </>
  )
}

function Bloco({
  titulo, grupo, tamanhos, ehCozinha,
}: {
  titulo: string
  grupo: ReturnType<typeof agrupar>[number]
  tamanhos: string[]
  ehCozinha: boolean
}) {
  if (ehCozinha) {
    return (
      <div className="border-2 border-black rounded-lg overflow-hidden break-inside-avoid">
        <div className="flex justify-between items-center px-3.5 py-2.5 bg-black">
          <span className="text-[14px] font-extrabold tracking-wide text-white uppercase">{titulo}</span>
          <span className="text-[12px] font-bold text-lime">{grupo.total}</span>
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-[10px] font-extrabold text-black/70 px-3 py-1.5 border-b-2 border-black">PRATO</th>
              {tamanhos.map((t) => (
                <th key={t} className="w-12 text-center text-[10px] font-extrabold text-black/70 py-1.5 border-b-2 border-black">{t}</th>
              ))}
              <th className="w-14 text-center text-[10px] font-extrabold text-black/70 py-1.5 border-b-2 border-black">TOT</th>
            </tr>
          </thead>
          <tbody>
            {grupo.itens.map((i) => (
              <tr key={i.prato}>
                <td className="px-3 py-2 border-b border-black/25 text-[14.5px] font-semibold text-black leading-tight">
                  {i.prato}
                </td>
                {tamanhos.map((t) => (
                  <td key={t} className="text-center py-2 border-b border-black/25 text-[17px] font-extrabold text-black tnum">
                    {i.porTamanho[t] ?? 0}
                  </td>
                ))}
                <td className="text-center py-2 border-b border-black/25 text-[17px] font-extrabold text-black bg-black/[0.06] tnum">
                  {i.total}
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-2 text-[13px] font-extrabold text-black bg-black/10">TOTAL</td>
              {tamanhos.map((t) => (
                <td key={t} className="text-center py-2 text-[17px] font-extrabold text-black bg-black/10 tnum">
                  {grupo.totais[t] ?? 0}
                </td>
              ))}
              <td className="text-center py-2 text-[17px] font-extrabold text-black bg-black/10 tnum">{grupo.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden break-inside-avoid">
      <div className="flex justify-between items-center px-3.5 py-2.5 border-b border-line bg-surface-alt">
        <span className="text-[13.5px] font-bold text-brand">{titulo}</span>
        <span className="bg-muted-bg text-ink-3 rounded-full px-2 py-0.5 text-[11px] font-semibold tnum">
          {tamanhos.map((t) => `${t} ${grupo.totais[t] ?? 0}`).join(' · ')}
        </span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
            <th className="text-left font-semibold px-3 py-1.5 border-b border-line-soft">Prato</th>
            {tamanhos.map((t) => (
              <th key={t} className="w-11 text-center font-semibold py-1.5 border-b border-line-soft">{t}</th>
            ))}
            <th className="w-12 text-center font-semibold py-1.5 border-b border-line-soft">Total</th>
          </tr>
        </thead>
        <tbody>
          {grupo.itens.map((i) => (
            <tr key={i.prato} className="hover:bg-cream/60">
              <td className="px-3 py-1.5 border-b border-line-soft text-ink">{i.prato}</td>
              {tamanhos.map((t) => (
                <td key={t} className="text-center py-1.5 border-b border-line-soft text-ink-2 tnum">
                  {i.porTamanho[t] ?? 0}
                </td>
              ))}
              <td className="text-center py-1.5 border-b border-line-soft font-bold text-brand tnum">
                {i.total}
              </td>
            </tr>
          ))}
          <tr className="bg-surface-alt">
            <td className="px-3 py-1.5 font-bold text-brand">Total</td>
            {tamanhos.map((t) => (
              <td key={t} className="text-center py-1.5 font-bold text-brand tnum">{grupo.totais[t] ?? 0}</td>
            ))}
            <td className="text-center py-1.5 font-bold text-brand tnum">{grupo.total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Notas({
  notas, ehCozinha,
}: { notas: Producao['notas']; ehCozinha: boolean }) {
  return (
    <div className={ehCozinha
      ? 'border-2 border-black rounded-lg px-4 py-3 flex gap-4 flex-wrap items-baseline'
      : 'bg-surface border-2 border-warn-strong rounded-xl px-4 py-3 flex gap-4 flex-wrap items-baseline'}>
      <span className={ehCozinha
        ? 'text-[12px] font-extrabold tracking-wide text-black'
        : 'text-[11px] font-bold uppercase tracking-wide text-warn'}>
        🔪 KITCHEN NOTES
      </span>
      {notas.map((n) => (
        <span key={n.order_id} className={ehCozinha ? 'text-[14.5px] text-black' : 'text-[13px] text-ink'}>
          <strong>{n.customer_label}</strong> — {n.kitchen_notes}
        </span>
      ))}
    </div>
  )
}

/** Matriz prato × cliente (tela 3b). Só Admin e Operação. */
function Matriz({ weekId }: { weekId: string }) {
  const { data, loading, error, reload } = useQuery(() => fetchMatriz(weekId), [weekId])

  const { clientes, pratos, celulas } = useMemo(() => {
    const cs = [...new Set((data ?? []).map((c) => c.cliente))].sort()
    const ps = [...new Set((data ?? []).map((c) => c.prato))].sort()
    const mapa = new Map<string, CelulaMatriz>()
    for (const c of data ?? []) {
      const k = `${c.prato}|${c.cliente}`
      const antes = mapa.get(k)
      mapa.set(k, antes ? { ...antes, qty: antes.qty + c.qty } : c)
    }
    return { clientes: cs, pratos: ps, celulas: mapa }
  }, [data])

  if (loading) return <Loading shape="rows" label="Montando a matriz…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  if (clientes.length === 0) {
    return (
      <section className="bg-surface border border-line rounded-xl">
        <EmptyState icon="📋" title="Nenhum pedido com pratos nesta semana"
          body="A matriz reproduz a aba MENU ## da planilha, para conferir item a item." />
      </section>
    )
  }

  const totalCliente = (cli: string) =>
    pratos.reduce((s, p) => s + (celulas.get(`${p}|${cli}`)?.qty ?? 0), 0)
  const totalPrato = (p: string) =>
    clientes.reduce((s, c) => s + (celulas.get(`${p}|${c}`)?.qty ?? 0), 0)
  const posCutoff = (cli: string) =>
    (data ?? []).some((c) => c.cliente === cli && c.post_cutoff)

  return (
    <section className="bg-surface border border-line rounded-xl overflow-x-auto">
      <table className="text-[12px] w-max min-w-full">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface-alt text-left text-[10px] uppercase tracking-wide text-ink-muted font-semibold px-3.5 py-2 border-b border-line border-r border-line min-w-56">
              Prato · PT
            </th>
            {clientes.map((c) => (
              <th key={c} className={`text-center px-2 py-1.5 border-b border-line min-w-20 ${
                posCutoff(c) ? 'bg-late-bg' : 'bg-surface-alt'}`}>
                <div className={`text-[11px] font-bold ${posCutoff(c) ? 'text-late-text' : 'text-ink'}`}>
                  {c}
                </div>
                {posCutoff(c) && <div className="text-[9px] font-bold text-late-text">pós-cutoff</div>}
              </th>
            ))}
            <th className="text-center text-[10px] uppercase text-ink-muted font-semibold px-3 py-2 border-b border-line border-l border-line-soft bg-surface-alt">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {pratos.map((p) => (
            <tr key={p} className="hover:bg-cream/60">
              <td className="sticky left-0 z-10 bg-surface px-3.5 py-1.5 border-b border-line-soft border-r border-line-soft whitespace-nowrap text-ink">
                {p}
              </td>
              {clientes.map((c) => {
                const q = celulas.get(`${p}|${c}`)?.qty ?? 0
                return (
                  <td key={c} className={`text-center py-1.5 border-b border-line-soft tnum ${
                    q ? 'text-ink' : 'text-line-strong'} ${posCutoff(c) ? 'bg-late-bg/50' : ''}`}>
                    {q || '·'}
                  </td>
                )
              })}
              <td className="text-center py-1.5 border-b border-line-soft border-l border-line-soft font-bold text-brand tnum">
                {totalPrato(p)}
              </td>
            </tr>
          ))}
          <tr className="bg-surface-alt">
            <td className="sticky left-0 z-10 bg-surface-alt px-3.5 py-2 font-bold text-brand border-r border-line-soft whitespace-nowrap">
              Total do cliente
            </td>
            {clientes.map((c) => (
              <td key={c} className="text-center py-2 font-bold text-brand tnum">{totalCliente(c)}</td>
            ))}
            <td className="text-center py-2 font-bold text-brand border-l border-line-soft tnum">
              {pratos.reduce((s, p) => s + totalPrato(p), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

const Chip = ({ ehCozinha, children }: { ehCozinha: boolean; children: React.ReactNode }) => (
  <span className={ehCozinha
    ? 'border-2 border-black rounded-lg px-3 py-1.5 text-[13px] text-black'
    : 'bg-surface border border-line rounded-lg px-3 py-1.5 text-[12.5px] text-ink-2'}>
    {children}
  </span>
)
