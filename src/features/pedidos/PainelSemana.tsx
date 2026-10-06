import { useMemo, useState } from 'react'
import { baixarCSV } from '../../lib/csv'
import { money } from '../../lib/supabase'
import { formatarTelefone, linkWhatsApp } from '../../lib/telefone'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { moneyInput, parseMoney } from '../../lib/precos'
import {
  cancelarSemPagamento, darPrazoPagamento, fetchAvisosFalhos, fetchPendencias,
  fetchPainel, mudarPagamento, paraCSV, reenviarAviso, salvarMeta,
  type AvisoPedido, type LinhaPedido, type PainelSemana as Dados,
  type PendenciaPagamento,
} from './semanaApi'

/* Painel da Semana. Ref: protótipo 10a (painel) e 9a (modo planilha).
 *
 * A tela mais usada não é uma tabela: cards que filtram, uma lista do que
 * precisa de ação agora, e um quadro por status de pagamento. A planilha fica
 * a um clique, com o mesmo conteúdo (§8).
 *
 * §6.4: Total Pedidos = Novo Pedido + Renovação. Skip, Cancelamento e Parceria
 * ficam fora do total — aparecem no card "fora do total". */

const COLUNAS = [
  { id: 'sem_pedido', rotulo: '✋ Aguardando seleção', cls: 'bg-muted-bg border-line' },
  { id: 'aguardando_pagamento', rotulo: '💵 Aguardando pagamento', cls: 'bg-warn-bg border-warn-line' },
  { id: 'comprovante_recebido', rotulo: '📎 Comprovante recebido', cls: 'bg-danger-bg border-danger-line' },
  { id: 'confirmado', rotulo: '✓ Confirmado', cls: 'bg-ok-bg border-ok-line' },
] as const

const FORA_DO_TOTAL = ['skip', 'cancelamento', 'parceria', 'follow_up']

type Props = {
  weekId: string
  isoCode: string
  podeEditarMeta: boolean
  onNovoPedido: () => void
  onAbrirPedido: (orderId: string) => void
}

export function PainelSemana({
  weekId, isoCode, podeEditarMeta, onNovoPedido, onAbrirPedido,
}: Props) {
  const { data, loading, error, reload } = useQuery(
    () => fetchPainel(weekId, isoCode), [weekId, isoCode])
  const [modo, setModo] = useState<'painel' | 'planilha'>('painel')
  const [filtroRota, setFiltroRota] = useState('')
  const [busca, setBusca] = useState('')

  const linhasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const digitos = q.replace(/\D/g, '')
    return (data?.linhas ?? []).filter((l) => {
      if (filtroRota && l.rota !== filtroRota) return false
      if (!q) return true
      if (l.cliente.toLowerCase().includes(q)) return true
      return Boolean(digitos) && l.telefone.includes(digitos)
    })
  }, [data, filtroRota, busca])

  if (loading) return <Loading shape="cards" label="Carregando a semana…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const rotas = [...new Set((data.linhas.map((l) => l.rota).filter(Boolean) as string[]))]

  return (
    <div className="flex flex-col gap-4">
      <Cards dados={data} isoCode={isoCode} podeEditarMeta={podeEditarMeta} onSaved={reload} />

      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex bg-surface border border-line rounded-lg p-0.5 gap-0.5">
          {(['painel', 'planilha'] as const).map((m) => (
            <button key={m} onClick={() => setModo(m)}
              className={`rounded-md px-3.5 py-1 text-[12px] capitalize ${
                modo === m ? 'bg-brand text-cream font-semibold' : 'text-ink-2 hover:bg-cream'}`}>
              {m === 'painel' ? 'Painel' : 'Planilha'}
            </button>
          ))}
        </div>
        {rotas.length > 0 && (
          <select aria-label="Filtrar por rota" value={filtroRota}
            onChange={(e) => setFiltroRota(e.target.value)}
            className="border border-line rounded-lg px-3 py-1 text-[12px] bg-surface outline-none focus:border-brand">
            <option value="">Rota: todas</option>
            {rotas.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <input aria-label="Buscar na semana" placeholder="Buscar cliente ou telefone…"
          value={busca} onChange={(e) => setBusca(e.target.value)}
          className="border border-line rounded-lg px-3 py-1.5 text-[12px] bg-surface outline-none focus:border-brand w-56" />
        <div className="flex-1" />
        {modo === 'planilha' && (
          <button onClick={() => exportar(linhasFiltradas, isoCode)}
            className="bg-surface border border-line-strong hover:border-brand text-ink-2 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold">
            Exportar CSV
          </button>
        )}
        <button onClick={onNovoPedido}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[13px] font-semibold">
          ＋ Novo pedido
        </button>
      </div>

      {/* Antes de qualquer número: mensagem que não saiu é ação pendente, e a
          equipe não tem como descobrir sozinha — o pedido fica lá bonito. */}
      <AvisosFalhos weekId={weekId} />

      {modo === 'painel' ? (
        <>
          <RotinaDeSexta weekId={weekId} onMudou={reload} />
          <PrecisaDeAcao linhas={data.linhas} />
          <Quadro linhas={linhasFiltradas} onMudou={reload} onAbrir={onAbrirPedido} />
        </>
      ) : (
        <Planilha linhas={linhasFiltradas} />
      )}
    </div>
  )
}

function Cards({
  dados, isoCode, podeEditarMeta, onSaved,
}: { dados: Dados; isoCode: string; podeEditarMeta: boolean; onSaved: () => void }) {
  const r = dados.resumo
  const meta = dados.metaCents
  const pct = meta && meta > 0 ? Math.min(100, (r.pedidos_cents / meta) * 100) : null

  const pagamentos = useMemo(() => {
    const c = { aguardando_pagamento: 0, comprovante_recebido: 0, confirmado: 0 }
    for (const l of dados.linhas) {
      const s = l.order?.payment_status
      if (s && s in c) c[s as keyof typeof c]++
    }
    return c
  }, [dados.linhas])

  // clientes, não pedidos: é quantas PESSOAS responderam à semana
  const ativos = r.clientes_com_pedido + r.aguardando_selecao

  return (
    <div className="grid md:grid-cols-3 xl:grid-cols-5 gap-2.5">
      <div className="bg-brand rounded-xl px-3.5 py-3 text-cream">
        <div className="text-[10.5px] uppercase tracking-wide text-nav-item">Pedidos da semana</div>
        <div className="text-[23px] font-bold text-lime leading-tight tnum">
          {money(r.pedidos_cents)}
        </div>
        {pct !== null ? (
          <>
            <div className="h-1.5 rounded-full bg-white/20 my-1.5 overflow-hidden">
              <div className="h-full bg-lime" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[10.5px] text-nav-item tnum">
              {pct.toFixed(1)}% da meta de {money(meta!)}
              {r.pedidos_cents < meta! && ` · faltam ${money(meta! - r.pedidos_cents)}`}
            </div>
          </>
        ) : (
          <div className="text-[10.5px] text-nav-item mt-1">sem meta definida</div>
        )}
        {podeEditarMeta && <EditarMeta isoCode={isoCode} atual={meta} onSaved={onSaved} />}
        {/* aria-label no valor: sem ele o leitor de tela anuncia só o número,
            e o teste teria que caçar o rótulo pela estrutura do DOM */}
        <div className="flex gap-3 mt-2 pt-2 border-t border-white/15">
          <div className="flex-1">
            <div className="text-[9.5px] uppercase text-nav-item">Faturado</div>
            <div aria-label="Faturado" className="text-[14px] font-bold tnum">
              {money(r.faturado_cents)}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[9.5px] uppercase text-warn-line">A receber</div>
            <div aria-label="A receber" className="text-[14px] font-bold text-warn-line tnum">
              {money(r.a_receber_cents)}
            </div>
          </div>
        </div>
      </div>

      <Card titulo="Total Pedidos" valor={String(r.total_pedidos)}
        detalhe={`✅ ${r.novo_pedido} Novo · 🔁 ${r.renovacao} Renovação`}
        nota={r.total_pedidos !== r.clientes_com_pedido
          // Novo e Renovação contam PESSOAS; o total conta PEDIDOS. Quando
          // alguém pede duas vezes os números deixam de bater, e o certo é
          // dizer por quê em vez de deixar a equipe achando que errou a conta
          ? `de ${r.clientes_com_pedido} clientes — alguém pediu mais de uma vez`
          : 'conta na semana do pedido, mesmo sem pagamento'} />

      <Card titulo="Seleção"
        valor={`${r.aguardando_selecao}`} valorSufixo="aguardando"
        detalhe={ativos > 0
          ? `${r.clientes_com_pedido} de ${ativos} clientes responderam`
          : 'nenhum cliente na semana ainda'}
        tom={r.aguardando_selecao > 0 ? 'warn' : undefined} />

      <Card titulo="Pagamentos"
        valor={`${pagamentos.aguardando_pagamento} · ${pagamentos.comprovante_recebido} · ${pagamentos.confirmado}`}
        detalhe="aguardando · comprovante · confirmado"
        nota={pagamentos.comprovante_recebido > 0
          ? `${pagamentos.comprovante_recebido} para conferir`
          : undefined}
        tom={pagamentos.comprovante_recebido > 0 ? 'danger' : undefined} />

      <div className="bg-surface border border-line rounded-xl px-3.5 py-3">
        <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">
          Fora do total
        </div>
        <div className="flex flex-col gap-0.5 mt-1 text-[12px]">
          <LinhaFora rotulo="🕒 Skip" n={r.skip} cor="text-warn" />
          <LinhaFora rotulo="❌ Cancelamento" n={r.cancelamento} cor="text-danger" />
          <LinhaFora rotulo="🎁 Parceria" n={r.parceria} cor="text-accent" />
          <LinhaFora rotulo="🟠 Follow-up" n={r.follow_up} cor="text-late-text" />
        </div>
        {r.parceria > 0 && (
          <div className="text-[10.5px] text-accent mt-1.5 tnum">
            valor comercial {money(r.parceria_valor_comercial_cents)}
          </div>
        )}
      </div>
    </div>
  )
}

function EditarMeta({
  isoCode, atual, onSaved,
}: { isoCode: string; atual: number | null; onSaved: () => void }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(atual ? moneyInput(atual) : '')

  if (!editando) {
    return (
      <button onClick={() => setEditando(true)}
        className="text-[10.5px] text-lime hover:underline mt-1">
        {atual ? 'editar meta' : 'definir meta'}
      </button>
    )
  }
  return (
    <div className="flex gap-1 mt-1.5">
      <input aria-label="Meta da semana" value={texto} onChange={(e) => setTexto(e.target.value)}
        className="w-24 rounded-md px-2 py-1 text-[12px] text-ink bg-white outline-none tnum" />
      <button onClick={async () => {
        const c = parseMoney(texto)
        if (c === null) return
        await salvarMeta(isoCode, c)
        setEditando(false)
        onSaved()
      }} className="bg-lime text-brand rounded-md px-2.5 py-1 text-[11.5px] font-semibold">
        Salvar
      </button>
    </div>
  )
}

/** §9.1: a lista esvazia conforme a equipe resolve. */
function PrecisaDeAcao({ linhas }: { linhas: LinhaPedido[] }) {
  const semSelecao = linhas.filter((l) => !l.order && !FORA_DO_TOTAL.includes(l.order_status))
  const aConferir = linhas.filter((l) => l.order?.payment_status === 'comprovante_recebido')
  const semPagamento = linhas.filter((l) => l.order?.payment_status === 'aguardando_pagamento')
  const posCutoff = linhas.filter((l) => l.order?.post_cutoff)

  const itens = [
    semSelecao.length > 0 && {
      icone: '✋', tom: 'warn' as const,
      titulo: `Aguardando seleção · ${semSelecao.length}`,
      detalhe: semSelecao.map((l) => l.cliente).join(', '),
      acao: semSelecao[0] && {
        rotulo: 'Chamar no WhatsApp',
        href: linkWhatsApp(semSelecao[0].telefone),
      },
    },
    aConferir.length > 0 && {
      icone: '📎', tom: 'danger' as const,
      titulo: `Comprovante para conferir · ${aConferir.length}`,
      detalhe: aConferir.map((l) => `${l.cliente} (${money(l.order!.total_cents)})`).join(' · '),
    },
    semPagamento.length > 0 && {
      icone: '💵', tom: 'warn' as const,
      titulo: `Aguardando pagamento · ${semPagamento.length}`,
      detalhe: semPagamento.map((l) => l.cliente).join(', '),
    },
    posCutoff.length > 0 && {
      icone: '⏰', tom: 'late' as const,
      titulo: `Pedido lançado após o cutoff · ${posCutoff.length}`,
      detalhe: 'A cozinha precisa refazer a contagem — reimprima a folha de produção.',
    },
  ].filter(Boolean) as {
    icone: string; tom: 'warn' | 'danger' | 'late'; titulo: string
    detalhe: string; acao?: { rotulo: string; href: string }
  }[]

  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3.5">
      <div className="flex items-baseline gap-2 mb-2.5">
        <h2 className="text-[13.5px] font-bold text-brand">Precisa de ação agora</h2>
        <span className="text-[11.5px] text-ink-muted">
          {itens.length === 0 ? 'nada pendente' : `${itens.length} itens`}
        </span>
      </div>

      {itens.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-2xl mb-1">🎉</div>
          <p className="text-[14px] font-bold text-ink">Tudo em dia</p>
          <p className="text-[12.5px] text-ink-3 max-w-sm mx-auto mt-0.5">
            Nenhuma seleção pendente, nenhum comprovante para conferir e nenhum
            pagamento em aberto.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((i, k) => {
            const cls = { warn: 'bg-warn-bg border-warn-line text-warn',
                          danger: 'bg-danger-bg border-danger-line text-danger',
                          late: 'bg-late-bg border-late-line text-late-text' }[i.tom]
            return (
              <li key={k} className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 ${cls}`}>
                <span aria-hidden className="text-base">{i.icone}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold">{i.titulo}</div>
                  <div className="text-[11.5px] text-ink-3 truncate">{i.detalhe}</div>
                </div>
                {i.acao && (
                  <a href={i.acao.href} target="_blank" rel="noreferrer"
                    className="bg-[#25D366] text-white rounded-md px-3 py-1.5 text-[11.5px] font-semibold whitespace-nowrap">
                    {i.acao.rotulo}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Quadro({ linhas, onMudou, onAbrir }: {
  linhas: LinhaPedido[]; onMudou: () => void; onAbrir: (orderId: string) => void
}) {
  const coluna = (id: string) =>
    id === 'sem_pedido'
      ? linhas.filter((l) => !l.order && !FORA_DO_TOTAL.includes(l.order_status))
      : linhas.filter((l) => l.order?.payment_status === id)

  const fora = linhas.filter((l) => FORA_DO_TOTAL.includes(l.order_status))

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-[13.5px] font-bold text-brand">Quadro por pagamento</h2>
        <span className="text-[11.5px] text-ink-muted">
          clique no cartão para avançar o status
        </span>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2.5 items-start">
        {COLUNAS.map((c) => {
          const lista = coluna(c.id)
          return (
            <div key={c.id} className={`rounded-xl border p-2.5 ${c.cls}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[12px] font-bold text-ink-2">{c.rotulo}</span>
                <span className="bg-surface border border-line text-ink-3 rounded-full px-2 py-0.5 text-[11px] font-bold">
                  {lista.length}
                </span>
              </div>
              {lista.length === 0 ? (
                <p className="border border-dashed border-line rounded-lg py-5 text-center text-[11.5px] text-ink-muted">
                  vazio
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lista.map((l) => (
                    // a chave é o PEDIDO, não a pessoa: o mesmo cliente pode
                    // ter dois pedidos na semana e cairiam com a mesma chave
                    <CartaoPedido key={l.order?.id ?? l.customer_id} linha={l}
                                  coluna={c.id} onMudou={onMudou} onAbrir={onAbrir} />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {fora.length > 0 && (
        <div className="bg-surface border border-line rounded-lg px-3.5 py-2.5 mt-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-[12.5px] font-semibold text-ink-2">
            {fora.length} fora da semana
          </span>
          <span className="text-[11.5px] text-ink-muted flex-1">
            {fora.map((l) => `${rotuloStatus(l.order_status)} ${l.cliente}`).join(' · ')}
          </span>
          <span className="text-[11px] text-ink-muted">não entram no Total Pedidos</span>
        </div>
      )}
    </section>
  )
}

const PROXIMO: Record<string, string> = {
  aguardando_pagamento: 'comprovante_recebido',
  comprovante_recebido: 'confirmado',
}

/** Número do pedido, para abrir a conversa e conferir o comprovante.
 *
 *  A LifeBox decidiu NÃO guardar a imagem do comprovante no banco (28/09/2026):
 *  quem confere abre o WhatsApp e olha lá. Então o número tem de estar à mão no
 *  cartão — sem ele a conferência vira procurar a pessoa na agenda pelo nome.
 *
 *  Copiar existe porque o `wa.me` nem sempre resolve: no computador ele abre o
 *  WhatsApp Web, que pode não estar logado, e quem usa o aplicativo do celular
 *  prefere colar na busca. */
function Telefone({ e164 }: { e164: string }) {
  const [copiado, setCopiado] = useState(false)

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <a
        href={linkWhatsApp(e164)}
        target="_blank"
        rel="noreferrer"
        title="Abrir a conversa no WhatsApp"
        className="text-[11px] text-brand-mid hover:underline tnum"
      >
        {formatarTelefone(e164)}
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(e164)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1500)
          } catch {
            // navegador sem permissão de área de transferência (ou sem HTTPS):
            // o número continua visível e selecionável ao lado, então não há
            // o que consertar aqui além de não fingir que copiou
            setCopiado(false)
          }
        }}
        aria-label={`Copiar telefone ${formatarTelefone(e164)}`}
        className="text-[10px] text-ink-muted hover:text-ink-2 border border-line rounded px-1.5 py-0.5"
      >
        {copiado ? 'copiado' : 'copiar'}
      </button>
    </div>
  )
}

function CartaoPedido({
  linha, coluna, onMudou, onAbrir,
}: {
  linha: LinhaPedido; coluna: string; onMudou: () => void
  onAbrir: (orderId: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const proximo = linha.order ? PROXIMO[coluna] : undefined

  // O cartão inteiro abre a ficha (protótipo 9b). É BOTÃO, não div com
  // onClick: sem papel de botão o teclado não alcança e o leitor de tela não
  // anuncia. O botão de avançar status fica FORA dele — botão dentro de botão
  // é HTML inválido, e o clique vira loteria de qual dos dois disparou.
  return (
    <li className="bg-surface border border-line rounded-lg px-2.5 py-2">
      <button
        type="button"
        disabled={!linha.order}
        onClick={() => linha.order && onAbrir(linha.order.id)}
        aria-label={linha.order ? `Abrir pedido de ${linha.cliente}` : undefined}
        className="w-full text-left disabled:cursor-default"
      >
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-[12.5px] font-bold text-ink truncate">{linha.cliente}</span>
        {linha.order && (
          <span className="text-[11.5px] font-bold text-brand-mid tnum whitespace-nowrap">
            {money(linha.order.total_cents)}
          </span>
        )}
      </div>
      <div className="flex gap-1 flex-wrap mt-1">
        <span className="bg-muted-bg text-ink-3 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          {rotuloStatus(linha.order_status)}
        </span>
        {linha.order?.post_cutoff && (
          <span className="bg-late text-white rounded-full px-2 py-0.5 text-[9.5px] font-bold">
            pós-cutoff
          </span>
        )}
      </div>
      <div className="text-[11px] text-ink-3 mt-1 truncate">
        {[linha.order?.plano, linha.order?.size, linha.rota, linha.order?.forma]
          .filter(Boolean).join(' · ') || formatarTelefone(linha.telefone)}
      </div>
      </button>
      {/* O telefone fica FORA do botão da ficha: link dentro de botão é HTML
          inválido e o clique vira loteria de qual dos dois disparou. É o
          número DO PEDIDO — a conversa em que o comprovante chegou. */}
      {linha.order && linha.telefone && <Telefone e164={linha.telefone} />}
      {proximo && (
        <button
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true)
            await mudarPagamento(linha.order!.id, proximo)
            setOcupado(false)
            onMudou()
          }}
          className="mt-1.5 w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-md py-1 text-[11px] font-semibold"
        >
          {ocupado ? '…' : `→ ${rotuloPagamento(proximo)}`}
        </button>
      )}
    </li>
  )
}

function Planilha({ linhas }: { linhas: LinhaPedido[] }) {
  if (linhas.length === 0) {
    return (
      <section className="bg-surface border border-line rounded-xl">
        <EmptyState icon="📋" title="Nenhuma linha nesta semana"
          body="A semana abriu na segunda. Lance o primeiro pedido ou envie o link pelo WhatsApp." />
      </section>
    )
  }
  return (
    <section className="bg-surface border border-line rounded-xl overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-surface-alt text-[10.5px] uppercase tracking-wide text-ink-muted">
            {['Cliente', 'Telefone', 'Situação', 'Pedido', 'Plano', 'Valor', 'Pagamento', 'Rota']
              .map((h) => (
                <th key={h} className={`font-semibold px-3 py-2.5 ${h === 'Valor' ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.customer_id}
              className={`border-t border-line-soft ${l.order?.post_cutoff ? 'bg-late-bg' : ''}`}>
              <td className="px-3 py-2 font-semibold text-ink">{l.cliente}</td>
              <td className="px-3 text-ink-2 tnum whitespace-nowrap">{formatarTelefone(l.telefone)}</td>
              <td className="px-3 text-ink-2 whitespace-nowrap">{rotuloStatus(l.order_status)}</td>
              <td className="px-3 text-ink-3 tnum whitespace-nowrap">{l.order?.code ?? '—'}</td>
              <td className="px-3 text-ink-2">
                {l.order?.plano ?? '—'}
                {l.order?.size && <span className="text-ink-muted"> · {l.order.size}</span>}
              </td>
              <td className="px-3 text-right text-brand-mid font-semibold tnum">
                {l.order ? money(l.order.total_cents) : '—'}
              </td>
              <td className="px-3 text-ink-2 whitespace-nowrap">
                {l.order ? rotuloPagamento(l.order.payment_status) : '—'}
              </td>
              <td className="px-3 text-ink-2">{l.rota ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Card({
  titulo, valor, valorSufixo, detalhe, nota, tom,
}: {
  titulo: string; valor: string; valorSufixo?: string
  detalhe?: string; nota?: string; tom?: 'warn' | 'danger'
}) {
  const borda = tom === 'warn' ? 'border-warn-line'
              : tom === 'danger' ? 'border-danger-line' : 'border-line'
  const cor = tom === 'warn' ? 'text-warn' : tom === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className={`bg-surface border rounded-xl px-3.5 py-3 ${borda}`}>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold">{titulo}</div>
      <div className={`text-[21px] font-bold leading-tight tnum ${cor}`}>
        {valor}
        {valorSufixo && <span className="text-[12px] font-semibold text-ink-muted"> {valorSufixo}</span>}
      </div>
      {detalhe && <div className="text-[11.5px] text-ink-2 mt-0.5">{detalhe}</div>}
      {nota && <div className="text-[10.5px] text-ink-muted mt-0.5">{nota}</div>}
    </div>
  )
}

const LinhaFora = ({ rotulo, n, cor }: { rotulo: string; n: number; cor: string }) => (
  <div className={`flex justify-between ${cor}`}>
    <span>{rotulo}</span><strong className="tnum">{n}</strong>
  </div>
)

const ROTULOS: Record<string, string> = {
  novo_pedido: '✅ Novo Pedido', renovacao: '🔁 Renovação', follow_up: '🟠 Follow-up',
  skip: '🕒 Skip', cancelamento: '❌ Cancelamento', parceria: '🎁 Parceria',
  aguardando_selecao: '✋ Aguardando seleção',
}
const rotuloStatus = (s: string) => ROTULOS[s] ?? s

const PAGAMENTOS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando', comprovante_recebido: 'Comprovante recebido',
  confirmado: 'Confirmado', parcial: 'Parcial', recusado: 'Recusado',
}
const rotuloPagamento = (s: string) => PAGAMENTOS[s] ?? s

function exportar(linhas: LinhaPedido[], isoCode: string) {
  baixarCSV(`lifebox-${isoCode}`, paraCSV(linhas))
}

/** A mensagem que a automação não conseguiu entregar (§9.2).
 *
 *  Existe porque o webhook é assíncrono: `fn_notificar_pedido` devolve antes de
 *  saber o desfecho, e gravava no audit que tinha enviado. A falha caía em
 *  `net._http_response`, que ninguém lia e que o pg_net apaga em 6 horas — o
 *  cliente ficava sem as instruções de pagamento e só se descobria quando ele
 *  não pagava.
 *
 *  Some quando não há nada: faixa permanente vira parte do cenário e para de
 *  ser lida. */
function AvisosFalhos({ weekId }: { weekId: string }) {
  const { data, reload } = useQuery(() => fetchAvisosFalhos(weekId), [weekId])
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const avisos = data ?? []
  if (avisos.length === 0 && !erro) return null

  async function reenviar(a: AvisoPedido) {
    setOcupado(a.order_id)
    setErro(null)
    const { error } = await reenviarAviso(a.order_id)
    setOcupado(null)
    // o motivo mais comum é a URL do webhook estar vazia em Configurações, e a
    // função diz isso — engolir deixaria o clique sem efeito
    if (error) { setErro(error.message); return }
    reload()
  }

  return (
    <section className="bg-warn-bg border border-warn-line rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <strong className="text-[13px] text-warn">
          ⚠️ {avisos.length} aviso{avisos.length === 1 ? '' : 's'} de pedido
          não chegou{avisos.length === 1 ? '' : 'ram'} na automação
        </strong>
        <span className="text-[11.5px] text-ink-3">
          o cliente pode não ter recebido as instruções de pagamento
        </span>
      </div>

      {erro && <p role="alert" className="text-[12px] text-danger">{erro}</p>}

      <ul className="flex flex-col gap-1.5">
        {avisos.map((a) => (
          <li key={a.order_id} className="flex items-center gap-2 flex-wrap text-[12px]">
            <strong className="text-ink">{a.code}</strong>
            <span className="text-ink-3">
              {new Date(a.enviado_em).toLocaleString('pt-BR')}
            </span>
            {a.erro && <span className="text-ink-muted">· {a.erro}</span>}
            <button
              disabled={ocupado === a.order_id}
              onClick={() => reenviar(a)}
              className="ml-auto bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-md px-2.5 py-1 text-[11.5px] font-semibold">
              {ocupado === a.order_id ? '…' : 'Reenviar'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Rotina de sexta (§6.4): pedido sem pagamento, com Cancelar e Dar prazo.
 *
 *  Até aqui a equipe via "Aguardando pagamento · 3" e não tinha o que fazer
 *  com a informação — decidia por fora e o sistema não registrava nada. O
 *  documento-mestre pede exatamente estes dois botões.
 *
 *  Cancelar é caro e não tem desfazer nesta tela, então pergunta antes. Dar
 *  prazo não pergunta: é o lado seguro, e errar custa ver o pedido de novo
 *  amanhã. */
function RotinaDeSexta({ weekId, onMudou }: { weekId: string; onMudou: () => void }) {
  const { data, reload } = useQuery(() => fetchPendencias(weekId), [weekId])
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const pendencias = data ?? []
  if (pendencias.length === 0 && !erro && !aviso) return null

  async function agir(p: PendenciaPagamento, acao: 'cancelar' | 'prazo') {
    if (acao === 'cancelar' && !window.confirm(
      `Cancelar o pedido ${p.code} de ${p.cliente}?

`
      + 'Ele sai da produção, da montagem e do faturamento da semana, '
      + 'e o cliente entra em Follow-up na semana seguinte.')) return

    setOcupado(p.order_id)
    setErro(null)
    const { data: r, error } = acao === 'cancelar'
      ? await cancelarSemPagamento(p.order_id)
      : await darPrazoPagamento(p.order_id)
    setOcupado(null)
    if (error) { setErro(error.message); return }

    setAviso(acao === 'cancelar'
      ? `${p.code} cancelado. ${p.cliente} entra em Follow-up na ${
          (r as { follow_up_em?: string })?.follow_up_em ?? 'semana seguinte'}.`
      : `${p.code} ganhou prazo — volta a cobrar depois disso.`)
    reload()
    onMudou()
  }

  return (
    <section className="bg-warn-bg border border-warn-line rounded-xl px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[13.5px] font-bold text-warn">
          💵 Sem pagamento · {pendencias.length}
        </h2>
        <span className="text-[11.5px] text-ink-3">
          cancelar da semana ou dar mais prazo
        </span>
      </div>

      {aviso && (
        <p className="text-[12px] text-ok bg-ok-bg border border-ok-line rounded-lg px-3 py-1.5">
          ✅ {aviso}
        </p>
      )}
      {erro && <p role="alert" className="text-[12px] text-danger">{erro}</p>}

      <ul className="flex flex-col gap-1.5">
        {pendencias.map((p) => (
          <li key={p.order_id}
            className="flex items-center gap-2 flex-wrap text-[12px] border-t border-warn-line/60 pt-1.5 first:border-0 first:pt-0">
            <strong className="text-ink">{p.cliente}</strong>
            <span className="text-ink-3">{p.code}</span>
            <span className="text-ink-2 tnum font-semibold">{money(p.total_cents)}</span>
            <a href={linkWhatsApp(p.telefone)} target="_blank" rel="noreferrer"
              className="text-brand-mid hover:underline">
              cobrar no WhatsApp ↗
            </a>
            <div className="ml-auto flex gap-1.5">
              <button
                disabled={ocupado === p.order_id}
                onClick={() => agir(p, 'prazo')}
                className="border border-line-strong text-ink-2 hover:bg-surface disabled:opacity-60 rounded-md px-2.5 py-1 text-[11.5px] font-semibold">
                Dar mais prazo
              </button>
              <button
                disabled={ocupado === p.order_id}
                onClick={() => agir(p, 'cancelar')}
                className="bg-danger hover:opacity-90 disabled:opacity-60 text-white rounded-md px-2.5 py-1 text-[11.5px] font-semibold">
                {ocupado === p.order_id ? '…' : 'Cancelar'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
