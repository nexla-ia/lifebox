import { useState } from 'react'
import { money } from '../../lib/supabase'
import { formatarTelefone, linkWhatsApp } from '../../lib/telefone'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import {
  fetchDetalhePedido, mudarPagamento,
  type ComprovanteFicha,
} from './semanaApi'

/* Ficha do pedido. Ref: protótipo 9b (§9.2).
 *
 * Abre pelo cartão do quadro. O que ela mostra é o pedido COMO FOI FECHADO:
 * os itens vêm do snapshot de `order_items`, não do catálogo de hoje — mexer
 * no cardápio não pode reescrever pedido antigo.
 *
 * Os adicionais ficam SEPARADOS dos pratos na conta, e não é enfeite: suco e
 * detox não entram no cálculo de tax nem de delivery (§5.4). Misturá-los na
 * mesma lista faria a conta parecer errada para quem confere. */

const PAGAMENTOS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando', comprovante_recebido: 'Comprovante recebido',
  confirmado: 'Confirmado', parcial: 'Parcial', recusado: 'Recusado',
}
const PROXIMO: Record<string, string> = {
  aguardando_pagamento: 'comprovante_recebido',
  comprovante_recebido: 'confirmado',
}
const ETAPAS = ['aguardando_pagamento', 'comprovante_recebido', 'confirmado']

/** O motivo escrito para quem está conferindo, não o código do banco. */
const MOTIVOS: Record<string, string> = {
  ok: 'Valor e destinatário conferem',
  valor_divergente: 'O valor não bate com o que está em aberto',
  destinatario_nao_reconhecido: 'Destinatário não está em Formas de pagamento',
  duplicado: 'Este comprovante já tinha sido recebido',
  baixa_confianca: 'A leitura do comprovante ficou incerta',
  sem_pedido: 'Chegou sem dar para escolher o pedido',
}

export function DetalhePedido({ orderId, onVoltar }: {
  orderId: string
  onVoltar: () => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const { data: p, loading, error, reload } =
    useQuery(() => fetchDetalhePedido(orderId), [orderId])

  if (loading) return <Loading shape="cards" label="Abrindo o pedido…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!p) return null

  const pratos = p.itens.filter((i) => i.item_type === 'dish')
  const extras = p.itens.filter((i) => i.item_type === 'extra')
  const adicionais = p.itens.filter((i) => i.item_type === 'addon')
  const proximo = PROXIMO[p.payment_status]
  const etapa = ETAPAS.indexOf(p.payment_status)

  async function avancar(para: string) {
    setOcupado(true)
    setErro(null)
    const { error: err } = await mudarPagamento(p!.id, para)
    setOcupado(false)
    // RLS barra UPDATE devolvendo zero linhas, sem erro. Ação de tela que
    // engole o erro da RPC vira clique sem efeito e sem explicação.
    if (err) { setErro(err.message); return }
    reload()
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header className="flex items-center gap-3 flex-wrap">
        <button onClick={onVoltar} className="text-[12.5px] text-brand-mid hover:underline">
          ‹ Semana
        </button>
        <div>
          <h2 className="text-[18px] font-bold text-ink leading-tight">
            {p.cliente} · {p.semana.replace(/^\d+-/, '')}
          </h2>
          <p className="text-[12px] text-ink-3">
            Pedido {p.code} · {new Date(p.created_at).toLocaleString('pt-BR')}
          </p>
        </div>
        {p.post_cutoff && (
          <span className="bg-late text-white rounded-full px-2.5 py-0.5 text-[10px] font-bold">
            PÓS-CUTOFF
          </span>
        )}
        {p.is_partnership && (
          <span className="bg-muted-bg text-ink-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold">
            🎁 Parceria
          </span>
        )}
        {p.telefone && (
          <a href={linkWhatsApp(p.telefone)} target="_blank" rel="noreferrer"
             className="ml-auto text-[12.5px] text-brand-mid hover:underline">
            {formatarTelefone(p.telefone)} ↗
          </a>
        )}
      </header>

      <section className="bg-surface border border-line rounded-xl p-4">
        <h3 className="text-[13px] font-bold text-ink">
          Pratos
          {p.plano && (
            <span className="font-normal text-ink-3"> · {p.plano} {p.tamanho ?? ''}</span>
          )}
        </h3>
        {pratos.length === 0 ? (
          <p className="text-[12.5px] text-ink-3 mt-1">Sem pratos escolhidos ainda.</p>
        ) : (
          <ul className="text-[12.5px] text-ink-2 mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {pratos.map((i, n) => (
              <li key={n}>{i.name_snapshot} <strong className="tnum">×{i.qty}</strong></li>
            ))}
          </ul>
        )}
      </section>

      {adicionais.length > 0 && (
        <section className="bg-surface border border-line rounded-xl p-4">
          <h3 className="text-[13px] font-bold text-ink">
            Adicionais <span className="font-normal text-ink-3">· separados dos pratos</span>
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {adicionais.map((i, n) => (
              <li key={n} className="flex justify-between text-[12.5px] text-ink-2">
                <span>{i.name_snapshot} ×{i.qty}</span>
                <span className="tnum">{money(i.unit_price_cents * i.qty)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-muted mt-2">
            Sucos e Detox não entram no cálculo de tax nem de delivery.
          </p>
        </section>
      )}

      <section className="bg-surface border border-line rounded-xl p-4">
        <h3 className="text-[13px] font-bold text-ink mb-2">
          Conta <span className="font-normal text-ink-3">· calculada no servidor</span>
        </h3>
        <dl className="flex flex-col gap-1 text-[12.5px]">
          {extras.map((i, n) => (
            <Linha key={n} rotulo={`${i.name_snapshot} ×${i.qty}`}
                   valor={i.unit_price_cents * i.qty} />
          ))}
          <Linha rotulo="Tributável" valor={p.taxable_cents} forte />
          <Linha rotulo="Tax" valor={p.tax_cents} />
          {p.delivery_cents > 0 && <Linha rotulo="Delivery" valor={p.delivery_cents} />}
          {p.fulfillment === 'pickup' && (
            <Linha rotulo="Retirada na cozinha" nota="sem delivery" />
          )}
          {p.non_taxable_cents > 0 && (
            <Linha rotulo="Adicionais" valor={p.non_taxable_cents} nota="sem tax/delivery" />
          )}
          <div className="border-t border-line mt-1 pt-1.5 flex justify-between">
            <dt className="text-[13.5px] font-bold text-ink">Total</dt>
            <dd className="text-[15px] font-bold text-brand tnum">{money(p.total_cents)}</dd>
          </div>
          {p.paid_amount_cents > 0 && p.paid_amount_cents < p.total_cents && (
            <Linha rotulo="Pago" valor={p.paid_amount_cents} />
          )}
        </dl>
      </section>

      <section className="bg-surface border border-line rounded-xl p-4">
        <h3 className="text-[13px] font-bold text-ink">
          Pagamento {p.forma && <span className="font-normal text-ink-3">· {p.forma}</span>}
        </h3>

        <ol className="flex items-center gap-1.5 mt-2 flex-wrap">
          {ETAPAS.map((e, n) => (
            <li key={e} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
              n < etapa ? 'bg-ok-bg border-ok-line text-ok'
                : n === etapa ? 'bg-brand text-cream border-brand'
                : 'bg-muted-bg border-line text-ink-muted'}`}>
              {PAGAMENTOS[e]}
            </li>
          ))}
        </ol>

        {p.confirmed_at && (
          <p className="text-[11.5px] text-ok mt-2">
            ✓ Confirmado {p.confirmed_by_kind === 'auto' ? 'automaticamente' : 'pela equipe'}
            {' · '}{new Date(p.confirmed_at).toLocaleString('pt-BR')}
          </p>
        )}

        {erro && (
          <p role="alert" className="text-[12px] text-danger mt-2">{erro}</p>
        )}

        <div className="flex gap-2 mt-3 flex-wrap">
          {proximo && (
            <button disabled={ocupado} onClick={() => avancar(proximo)}
              className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-md px-3 py-1.5 text-[12px] font-semibold">
              {ocupado ? '…' : `→ ${PAGAMENTOS[proximo]}`}
            </button>
          )}
          {/* Reverter existe porque a confirmação pode errar (§9.3.8): sem o
              caminho de volta, corrigir exigiria mexer no banco. */}
          {p.payment_status !== 'aguardando_pagamento' && (
            <button disabled={ocupado} onClick={() => avancar('aguardando_pagamento')}
              className="border border-line text-ink-2 hover:bg-muted-bg disabled:opacity-60 rounded-md px-3 py-1.5 text-[12px] font-semibold">
              Reverter
            </button>
          )}
        </div>
      </section>

      {p.comprovantes.length > 0 && (
        <section className="bg-surface border border-line rounded-xl p-4">
          <h3 className="text-[13px] font-bold text-ink mb-2">
            Comprovantes <span className="font-normal text-ink-3">· {p.comprovantes.length}</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {p.comprovantes.map((c) => <Comprovante key={c.id} c={c} />)}
          </ul>
        </section>
      )}
    </div>
  )
}

function Linha({ rotulo, valor, nota, forte }: {
  rotulo: string; valor?: number; nota?: string; forte?: boolean
}) {
  return (
    <div className="flex justify-between">
      <dt className={forte ? 'font-semibold text-ink' : 'text-ink-2'}>
        {rotulo}
        {nota && <span className="text-ink-muted text-[11px]"> · {nota}</span>}
      </dt>
      {valor !== undefined && (
        <dd className={`tnum ${forte ? 'font-semibold text-ink' : 'text-ink-2'}`}>
          {money(valor)}
        </dd>
      )}
    </div>
  )
}

function Comprovante({ c }: { c: ComprovanteFicha }) {
  const ex = (c.extracted ?? {}) as Record<string, unknown>
  const campos: [string, string][] = [
    ['Valor', ex.valor != null ? String(ex.valor) : ''],
    ['Data', ex.data != null ? String(ex.data) : ''],
    ['Destinatário', ex.destinatario != null ? String(ex.destinatario) : ''],
    ['Pagador', ex.pagador != null ? String(ex.pagador) : ''],
  ]
  const ok = c.check_result === 'ok'
  return (
    <li className="border border-line rounded-lg p-3">
      <div className="flex justify-between items-baseline gap-2 flex-wrap">
        <span className="text-[12px] text-ink-2">
          🧾 {new Date(c.received_at).toLocaleString('pt-BR')}
          {c.transaction_id && <span className="text-ink-muted"> · {c.transaction_id}</span>}
        </span>
        <span className={`text-[11px] font-semibold ${ok ? 'text-ok' : 'text-warn'}`}>
          {ok ? '✅' : '⚠️'} {MOTIVOS[c.check_result] ?? c.check_result}
        </span>
      </div>
      {c.check_detail && (
        <p className="text-[11.5px] text-ink-3 mt-1">{c.check_detail}</p>
      )}
      {campos.some(([, v]) => v) && (
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[11.5px]">
          {campos.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}
