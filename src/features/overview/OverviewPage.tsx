import { useEffect, useState } from 'react'
import { money } from '../../lib/supabase'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import {
  fetchOverview, fetchPeriodos, fetchSerie, rotulo, salvarMeta, variacao,
  type Tipo,
} from './api'
import { DrillDown, type Recorte } from './DrillDown'
import { BarrasReceita, Bloco, Card, EntradaSaida, Funil, ListaBarras } from './pecas'
import { Tabela } from './Tabela'

/* Tela 9.6 · Overview. Ref: protótipo 8a, 8b, 8c, 8d, 8f.
 *
 * §3: exclusiva do Administrador — e quem recusa é o servidor, não o menu:
 * fn_overview levanta LB403 para qualquer outro perfil.
 *
 * Nada aqui é digitado. Só a meta, que é a única coisa que ninguém consegue
 * derivar dos pedidos (§10).
 *
 * O bloco de leads fica zerado até a automação do n8n alimentar `leads`
 * (§9.1). A tela diz isso — "0%" sem explicação pareceria desempenho ruim em
 * vez de dado que ainda não existe. */

const TIPOS: { id: Tipo; rotulo: string }[] = [
  { id: 'week', rotulo: 'Semana' },
  { id: 'month', rotulo: 'Mês' },
  { id: 'year', rotulo: 'Ano' },
]

export function OverviewPage() {
  const [tipo, setTipo] = useState<Tipo>('week')
  const [chave, setChave] = useState<string | null>(null)
  const [aba, setAba] = useState<'dashboard' | 'tabela'>('dashboard')
  const [drill, setDrill] = useState<Recorte | null>(null)

  const periodos = useQuery(() => fetchPeriodos(tipo), [tipo])
  const lista = periodos.data ?? []

  /** Ao trocar de visão, cai no período mais recente que existe.
   *
   *  `periodos.loading` no guard não é detalhe: o useQuery mantém os dados
   *  antigos enquanto recarrega, então sem ele a troca para Mês escolheria uma
   *  chave da lista de SEMANAS ('2026-W39' como se fosse mês). Some sozinho no
   *  render seguinte, e é justamente por isso que passava despercebido. */
  useEffect(() => {
    if (periodos.loading) return
    if (lista.length > 0 && (!chave || !lista.includes(chave))) setChave(lista.at(-1)!)
  }, [lista, chave, periodos.loading])

  const i = chave ? lista.indexOf(chave) : -1
  const anterior = i > 0 ? lista[i - 1] : null
  const proximo = i >= 0 && i < lista.length - 1 ? lista[i + 1] : null

  const ov = useQuery(
    () => (chave ? fetchOverview(tipo, chave) : Promise.resolve({ data: null, error: null })),
    [tipo, chave])
  const comp = useQuery(
    () => (anterior ? fetchOverview(tipo, anterior) : Promise.resolve({ data: null, error: null })),
    [tipo, anterior])
  const serie = useQuery(
    () => (chave ? fetchSerie(tipo, chave, 5) : Promise.resolve({ data: null, error: null })),
    [tipo, chave])

  if (periodos.loading) return <div className="p-5"><Loading shape="cards" label="Carregando…" /></div>
  if (periodos.error) {
    return <div className="p-5"><ErrorState message={periodos.error} onRetry={periodos.reload} /></div>
  }
  if (lista.length === 0 || !chave) {
    return (
      <div className="p-5">
        <EmptyState icon="📊" title="Sem dados ainda"
          body="Os indicadores aparecem sozinhos conforme as semanas e os pedidos entrarem. Nada aqui é digitado." />
      </div>
    )
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">Overview</h1>

        <nav className="flex gap-1" aria-label="Visão">
          {TIPOS.map((t) => (
            <button key={t.id} onClick={() => { setTipo(t.id); setChave(null) }}
              aria-pressed={tipo === t.id}
              className={`rounded-lg px-3 py-1 text-[12.5px] border ${
                tipo === t.id ? 'bg-brand border-brand text-cream font-semibold'
                              : 'bg-surface border-line text-ink-2 hover:border-brand'}`}>
              {t.rotulo}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1 bg-surface border border-line rounded-lg px-1 py-0.5">
          <button onClick={() => anterior && setChave(anterior)} disabled={!anterior}
            aria-label="Período anterior"
            className="px-2 text-[14px] text-ink-3 disabled:text-line-strong hover:text-brand">‹</button>
          <span className="text-[12.5px] font-bold text-brand px-1">{rotulo(tipo, chave)}</span>
          <button onClick={() => proximo && setChave(proximo)} disabled={!proximo}
            aria-label="Próximo período"
            className="px-2 text-[14px] text-ink-3 disabled:text-line-strong hover:text-brand">›</button>
        </div>

        {anterior && (
          <span className="text-[11.5px] text-ink-3">
            comparando com {rotulo(tipo, anterior)}
          </span>
        )}

        <div className="flex-1" />

        {(ov.refreshing || serie.refreshing) && (
          <span role="status" className="text-[11px] text-ink-muted">atualizando…</span>
        )}

        <div className="flex gap-1">
          {(['dashboard', 'tabela'] as const).map((a) => (
            <button key={a} onClick={() => setAba(a)} aria-pressed={aba === a}
              className={`rounded-lg px-3 py-1 text-[12.5px] border ${
                aba === a ? 'bg-brand border-brand text-cream font-semibold'
                          : 'bg-surface border-line text-ink-2 hover:border-brand'}`}>
              {a === 'dashboard' ? 'Dashboard' : 'Tabela'}
            </button>
          ))}
        </div>
      </header>

      {ov.loading ? <Loading shape="cards" label="Somando…" />
        : ov.error ? <ErrorState message={ov.error} onRetry={ov.reload} />
        : !ov.data ? null
        : aba === 'tabela' ? (
          serie.data
            ? <Tabela serie={serie.data} tipo={tipo} onAbrir={setChave} />
            : <Loading shape="rows" label="Montando a grade…" />
        ) : (
          <Dashboard
            ov={ov.data} comp={comp.data} serie={serie.data ?? []}
            tipo={tipo} chave={chave}
            onRecarregar={() => { ov.reload(); serie.reload() }}
            onDrill={setDrill} onTrocarPeriodo={setChave} />
        )}

      {drill && (
        <DrillDown tipo={tipo} chave={chave} recorte={drill}
          rotuloPeriodo={rotulo(tipo, chave)} onFechar={() => setDrill(null)} />
      )}
    </div>
  )
}

function Dashboard({
  ov, comp, serie, tipo, chave, onDrill, onTrocarPeriodo, onRecarregar,
}: {
  ov: NonNullable<Awaited<ReturnType<typeof fetchOverview>>['data']>
  comp: Awaited<ReturnType<typeof fetchOverview>>['data']
  serie: NonNullable<Awaited<ReturnType<typeof fetchSerie>>['data']>
  tipo: Tipo
  chave: string
  onDrill: (r: Recorte) => void
  onTrocarPeriodo: (c: string) => void
  onRecarregar: () => void
}) {
  const f = ov.faturamento
  const emAndamento = ov.periodo.em_andamento

  return (
    <div className="flex flex-col gap-4">
      {emAndamento && (
        <div className="bg-late-bg border border-late-line text-late-text rounded-xl px-4 py-2.5 text-[12px]">
          ⏳ <strong>Período em andamento.</strong> Os números ainda vão mudar até o
          fim da semana — as barras em hachura são parciais.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <Card titulo="Faturamento" tom="brand" valor={money(f.total_cents)}
          delta={comp ? variacao(f.total_cents, comp.faturamento.total_cents) : null}
          onAbrir={() => onDrill('total')}
          nota={ov.meta_cents > 0
            ? <>{f.pct_meta?.toFixed(1).replace('.', ',')}% da meta de {money(ov.meta_cents)}</>
            : 'sem meta definida'} />

        <Card titulo="Faturado" valor={money(f.faturado_cents)}
          onAbrir={() => onDrill('faturado')}
          nota={<>a receber {money(f.a_receber_cents)}</>} />

        <Card titulo="Total Pedidos" valor={String(ov.pedidos.total)}
          delta={comp ? variacao(ov.pedidos.total, comp.pedidos.total) : null}
          onAbrir={() => onDrill('total')}
          nota={<>{ov.pedidos.novo} Novo + {ov.pedidos.renovacao} Renovação</>} />

        <Card titulo="Ticket médio"
          valor={ov.ticket_medio_cents != null ? money(ov.ticket_medio_cents) : '—'}
          delta={comp && comp.ticket_medio_cents && ov.ticket_medio_cents
            ? variacao(ov.ticket_medio_cents, comp.ticket_medio_cents) : null}
          nota={ov.ticket_pagos > 0
            ? <>{money(f.faturado_cents)} ÷ {ov.ticket_pagos} pago{ov.ticket_pagos === 1 ? '' : 's'}</>
            : 'nenhum pedido pago ainda'} />

        <Card titulo="New Leads" valor={String(ov.leads.novos)}
          delta={comp ? variacao(ov.leads.novos, comp.leads.novos) : null}
          nota={ov.leads.conversao != null
            ? <>conversão {ov.leads.conversao.toFixed(1).replace('.', ',')}%</>
            : 'entra com a automação'} />

        <Card titulo="Renovação"
          valor={ov.renovacao.taxa != null
            ? `${ov.renovacao.taxa.toFixed(1).replace('.', ',')}%` : '—'}
          onAbrir={() => onDrill('renovacao')}
          nota={<>{ov.renovacao.renovou} de {ov.renovacao.base} do período anterior</>} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Bloco titulo={`Receita por ${tipo === 'week' ? 'semana' : tipo === 'month' ? 'mês' : 'ano'}`}
          nota={<>■ faturamento · - - meta · ⋯ ano anterior · hachura = em andamento.
            Clicar na barra abre aquele período.</>}>
          <BarrasReceita pontos={serie} onAbrir={onTrocarPeriodo} />
        </Bloco>

        <Bloco titulo="Entrada e saída de clientes"
          nota="Acima do eixo, o Total Pedidos. Abaixo, quem saiu — Skip e Cancelamento não entram no total nem no faturamento.">
          <EntradaSaida pontos={serie} />
        </Bloco>

        <Bloco titulo={`Mix de planos · ${rotulo(tipo, chave)}`}
          nota={ov.adicionais.length > 0
            ? 'Detox e sucos são produtos adicionais — não contam como plano.'
            : undefined}>
          {ov.mix_planos.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Nenhum pedido de plano no período.</p>
          ) : (
            <>
              <ListaBarras itens={ov.mix_planos.map((m) => ({ nome: m.plano, valor: m.qtd }))} />
              {ov.mix_tamanhos.length > 0 && (
                <div className="flex gap-3 text-[11.5px] text-ink-3 pt-1 border-t border-line-soft">
                  <span className="font-semibold">Tamanho</span>
                  {ov.mix_tamanhos.map((t) => (
                    <span key={t.size} className="tnum">{t.size} <strong>{t.qtd}</strong></span>
                  ))}
                </div>
              )}
            </>
          )}
        </Bloco>

        <Bloco titulo="Adicionais vendidos"
          nota="Sucos e Detox não têm tax nem delivery — entram no total sem passar pelo cálculo do plano.">
          {ov.adicionais.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Nenhum adicional no período.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {ov.adicionais.map((a) => (
                  <li key={a.nome} className="flex items-baseline gap-2 text-[12px]">
                    <span className="flex-1 text-ink-2 truncate">{a.nome}</span>
                    <span className="text-ink-3 tnum">×{a.qtd}</span>
                    <span className="font-bold text-ink tnum w-20 text-right">
                      {money(a.valor_cents)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between text-[12px] font-bold text-brand
                              border-t border-line-soft pt-1.5">
                <span>Receita de adicionais</span>
                <span className="tnum">
                  {money(ov.adicionais.reduce((s, a) => s + a.valor_cents, 0))}
                </span>
              </div>
            </>
          )}
        </Bloco>

        <Bloco titulo={`Funil · ${rotulo(tipo, chave)}`}
          nota={ov.leads.novos === 0
            ? 'O funil se preenche quando a automação do WhatsApp começar a criar lead a partir da conversa. Até lá não há o que contar — não é desempenho ruim, é dado que ainda não existe.'
            : <>Conversão total {ov.leads.conversao?.toFixed(1).replace('.', ',')}%
                {ov.leads.ads_conversao != null
                  && <> · Ads {ov.leads.ads_conversao.toFixed(1).replace('.', ',')}%</>}</>}>
          <Funil passos={[
            { rotulo: 'New Leads', valor: ov.leads.novos },
            { rotulo: 'Follow-up', valor: ov.leads.follow_up },
            { rotulo: 'Convertidos', valor: ov.leads.convertidos },
          ]} />
        </Bloco>

        <Bloco titulo="Origens · leads e convertidos"
          nota="Influenciadores entram pelo nome, cadastrados em Configurações.">
          {ov.leads.origens.length === 0 ? (
            <p className="text-[12px] text-ink-muted">
              Aparece quando houver lead com origem registrada.
            </p>
          ) : (
            <ListaBarras itens={ov.leads.origens.map((o) => ({
              nome: o.nome,
              valor: o.leads,
              nota: `${o.convertidos} conv · ${o.pct?.toFixed(1).replace('.', ',') ?? '—'}%`,
            }))} />
          )}
        </Bloco>

        <Bloco titulo="🎁 Parcerias"
          nota="Valor comercial investido — não conta como receita (§6.4).">
          <div className="flex items-baseline gap-3">
            <span className="text-[21px] font-bold text-accent tnum">
              {ov.parcerias.qtd}
            </span>
            <span className="text-[12px] text-ink-3">
              pedido{ov.parcerias.qtd === 1 ? '' : 's'} FREE ·{' '}
              <strong className="text-accent">
                {money(ov.parcerias.valor_comercial_cents)}
              </strong>
            </span>
            {ov.parcerias.qtd > 0 && (
              <button onClick={() => onDrill('parceria')}
                className="text-[11.5px] text-brand-mid hover:underline ml-auto">
                ver
              </button>
            )}
          </div>
        </Bloco>

        <Bloco titulo="Top pratos" nota="O que a cozinha mais produziu no período.">
          {ov.top_pratos.length === 0 ? (
            <p className="text-[12px] text-ink-muted">Nenhum prato no período.</p>
          ) : (
            <ListaBarras itens={ov.top_pratos.map((p) => ({ nome: p.nome, valor: p.qtd }))} />
          )}
        </Bloco>
      </div>

      <EditarMeta tipo={tipo} chave={chave} atual={ov.meta_cents} onSalvo={onRecarregar} />
    </div>
  )
}

/** §10: "metas semanal e mensal, editáveis pelo Administrador". É o único
 *  número desta tela que alguém digita — todo o resto é derivado dos pedidos.
 *  Na visão Ano não há o que editar: ela soma as metas dos meses. */
function EditarMeta({
  tipo, chave, atual, onSalvo,
}: { tipo: Tipo; chave: string; atual: number; onSalvo: () => void }) {
  const [texto, setTexto] = useState((atual / 100).toFixed(2))
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  // depende do PERÍODO, não do valor: salvar muda `atual`, e um efeito ouvindo
  // `atual` apagaria a confirmação que acabou de aparecer — foi o que
  // aconteceu aqui e em Mensagens, pelo mesmo motivo
  useEffect(() => { setTexto((atual / 100).toFixed(2)); setAviso(null) }, [tipo, chave])

  if (tipo === 'year') {
    return (
      <p className="text-[11.5px] text-ink-muted">
        A meta do ano é a soma das metas mensais — edite mês a mês na visão Mês.
      </p>
    )
  }

  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3 flex items-end gap-3 flex-wrap">
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-ink-2">
          Meta {tipo === 'week' ? 'semanal' : 'mensal'} · {rotulo(tipo, chave)}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-ink-3">$</span>
          <input value={texto} inputMode="decimal" aria-label="Meta do período"
            onChange={(e) => { setTexto(e.target.value); setAviso(null) }}
            className="w-32 border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand tnum" />
        </div>
      </label>

      <button disabled={salvando}
        onClick={async () => {
          const n = Math.round(Number(texto.replace(',', '.')) * 100)
          if (!Number.isFinite(n) || n < 0) { setAviso('Valor inválido.'); return }
          setSalvando(true); setAviso(null)
          const { error } = await salvarMeta(tipo, chave, n)
          setSalvando(false)
          if (error) { setAviso(error.message); return }
          setAviso('Meta salva.')
          onSalvo()
        }}
        className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
        {salvando ? 'Salvando…' : 'Salvar meta'}
      </button>

      {aviso && (
        <span role="status" className="text-[12px] text-ok font-semibold">{aviso}</span>
      )}
      <span className="text-[11px] text-ink-muted flex-1 min-w-40">
        Único número digitado nesta tela. Todo o resto sai dos pedidos.
      </span>
    </section>
  )
}
