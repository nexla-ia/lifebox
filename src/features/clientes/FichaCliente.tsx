import { money } from '../../lib/supabase'
import { formatarTelefone, linkWhatsApp } from '../../lib/telefone'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import { fetchHistorico, type Cliente, type DadosClientes } from './api'
import { SeloStatus, SeloLead } from './selos'

/* Ficha do cliente. Ref: protótipo 4b.
 *
 * O cliente é a entidade permanente: Skip e Cancelamento pertencem à SEMANA,
 * não a ele (§6.3). Por isso o histórico vem de customer_weeks — uma semana em
 * que a pessoa pausou aparece na lista mesmo sem pedido. */

export function FichaCliente({
  cliente, dados, onVoltar, onEditar,
}: {
  cliente: Cliente
  dados: DadosClientes
  onVoltar: () => void
  onEditar: () => void
}) {
  const { data: historico, loading, error, reload } =
    useQuery(() => fetchHistorico(cliente.id), [cliente.id])

  const rota = dados.rotas.find((r) => r.id === cliente.route_id)?.name
  const origem = dados.origens.find((o) => o.id === cliente.source_id)?.name
  const plano = dados.planos.find((p) => p.id === cliente.default_plan_id)?.name_pt
  const tamanho = dados.tamanhos.find((t) => t.id === cliente.default_size_id)?.name
  const pedidos = (historico ?? []).filter((h) => h.order_code).length

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <button onClick={onVoltar} className="text-[12.5px] text-brand-mid hover:underline">
          ‹ Clientes
        </button>
        <div className="w-10 h-10 rounded-full bg-brand-mid text-cream grid place-items-center text-sm font-semibold">
          {iniciais(cliente)}
        </div>
        <div>
          <h2 className="text-[18px] font-bold text-ink leading-tight">
            {cliente.first_name} {cliente.last_name ?? ''}
          </h2>
          <p className="text-[12px] text-ink-3">
            Cliente desde {new Date(cliente.created_at).toLocaleDateString('pt-BR')}
            {pedidos > 0 && ` · ${pedidos} pedido${pedidos > 1 ? 's' : ''}`}
            {rota && ` · Rota ${rota}`}
          </p>
        </div>
        <SeloStatus status={cliente.status} />
        <SeloLead tipo={cliente.lead_type} />
        <div className="flex-1" />
        <button onClick={onEditar}
          className="bg-surface border border-line-strong hover:border-brand text-ink-2 rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          Editar
        </button>
        <a href={linkWhatsApp(cliente.phone_e164)} target="_blank" rel="noreferrer"
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          WhatsApp
        </a>
      </header>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4">
          <Bloco titulo="Cadastro">
            <dl className="grid sm:grid-cols-2 gap-x-5 gap-y-3">
              <Campo rotulo="Telefone / WhatsApp" valor={formatarTelefone(cliente.phone_e164)} tnum />
              <Campo rotulo="E-mail" valor={cliente.email} />
              <Campo rotulo="Endereço" valor={cliente.street_address} />
              <Campo rotulo="Cidade" valor={cliente.city ? `${cliente.city}, ${cliente.state ?? 'MA'}` : null} />
              <Campo rotulo="ZIP Code" valor={cliente.zip_code} tnum />
              <Campo rotulo="Rota" valor={rota} dica="editável, não é estritamente geográfica" />
              <Campo rotulo="Origem" valor={origem} />
              <Campo
                rotulo="Recebimento"
                valor={cliente.fulfillment_preference === 'pickup' ? '🏠 Pick-up' : '🚚 Entrega'}
              />
            </dl>

            {cliente.delivery_notes && (
              <div className="mt-3 bg-surface-alt border border-line-soft rounded-lg px-3 py-2">
                <div className="text-[10.5px] font-semibold text-ink-muted">🚚 Instruções de entrega</div>
                <p className="text-[12.5px] text-ink mt-0.5">{cliente.delivery_notes}</p>
              </div>
            )}
          </Bloco>

          {cliente.kitchen_notes && (
            <div className="bg-surface border-2 border-warn-strong rounded-xl px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-warn">
                🔪 Kitchen Notes
                <span className="font-normal normal-case tracking-normal text-ink-muted">
                  {' '}· vão direto para a folha da cozinha
                </span>
              </div>
              <p className="text-[14px] font-semibold text-ink mt-1">{cliente.kitchen_notes}</p>
            </div>
          )}

          <Bloco titulo="Histórico por semana" nota="Skip e Cancelamento pertencem à semana, não ao cliente">
            {loading ? <Loading shape="rows" label="Carregando histórico…" />
              : error ? <ErrorState message={error} onRetry={reload} />
              : (historico ?? []).length === 0 ? (
                <p className="text-[12.5px] text-ink-muted py-6 text-center">
                  Nenhuma semana registrada ainda. O histórico aparece assim que o cliente
                  entrar numa semana — com pedido, Skip ou Follow-up.
                </p>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
                      <th className="text-left font-semibold py-1.5">Semana</th>
                      <th className="text-left font-semibold">Situação</th>
                      <th className="text-left font-semibold">Plano</th>
                      <th className="text-right font-semibold">Valor</th>
                      <th className="text-left font-semibold pl-3">Pagamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historico ?? []).map((h) => (
                      <tr key={h.week_iso} className="border-t border-line-soft">
                        <td className="py-2 font-semibold text-ink">
                          {h.week_iso.replace(/^\d+-/, '')}
                          {h.post_cutoff && (
                            <span className="ml-1.5 bg-late text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold">
                              PÓS-CUTOFF
                            </span>
                          )}
                        </td>
                        <td><SeloSemana status={h.order_status} /></td>
                        <td className="text-ink-2">{h.plano ?? '—'}</td>
                        <td className="text-right text-brand-mid font-semibold tnum">
                          {h.order_code ? money(h.total_cents) : '—'}
                        </td>
                        <td className="pl-3 text-ink-3">{rotuloPagamento(h.payment_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </Bloco>
        </div>

        <div className="flex flex-col gap-4">
          <Bloco titulo="Plano e tamanho">
            {plano ? (
              <>
                <p className="text-[15px] font-bold text-ink">{plano}</p>
                <p className="text-[12.5px] text-ink-2">{tamanho ?? 'sem tamanho definido'}</p>
              </>
            ) : (
              <p className="text-[12.5px] text-ink-muted">Nenhum plano padrão definido.</p>
            )}
            <p className="text-[11px] text-ink-muted mt-2.5 leading-relaxed">
              É o padrão que puxa na renovação. Pode ser trocado no pedido da semana
              sem mudar o cadastro.
            </p>
          </Bloco>

          {cliente.office_notes && (
            <Bloco titulo="Observações internas">
              <p className="text-[12.5px] text-ink leading-relaxed">{cliente.office_notes}</p>
            </Bloco>
          )}
        </div>
      </div>
    </div>
  )
}

const iniciais = (c: Cliente) =>
  `${c.first_name[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase()

function Bloco({
  titulo, nota, children,
}: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3.5">
      <div className="flex items-baseline gap-2 flex-wrap mb-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{titulo}</h3>
        {nota && <span className="text-[11px] text-ink-muted">· {nota}</span>}
      </div>
      {children}
    </section>
  )
}

function Campo({
  rotulo, valor, dica, tnum,
}: { rotulo: string; valor?: string | null; dica?: string; tnum?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold text-ink-muted">{rotulo}</dt>
      <dd className={`text-[13px] text-ink ${tnum ? 'tnum' : ''}`}>
        {valor || <span className="text-ink-muted">—</span>}
        {dica && <span className="text-[11px] text-ink-muted"> · {dica}</span>}
      </dd>
    </div>
  )
}

const SEMANA: Record<string, { rotulo: string; cls: string }> = {
  novo_pedido: { rotulo: '✅ Novo Pedido', cls: 'bg-ok-bg text-ok' },
  renovacao: { rotulo: '🔁 Renovação', cls: 'bg-info-bg text-info' },
  follow_up: { rotulo: '🟠 Follow-up', cls: 'bg-late-bg text-late-text' },
  skip: { rotulo: '🕒 Skip', cls: 'bg-warn-bg text-warn' },
  cancelamento: { rotulo: '❌ Cancelamento', cls: 'bg-danger-bg text-danger' },
  parceria: { rotulo: '🎁 Parceria', cls: 'bg-accent-bg text-accent' },
  aguardando_selecao: { rotulo: '✋ Aguardando seleção', cls: 'bg-muted-bg text-ink-3' },
}

function SeloSemana({ status }: { status: string }) {
  const s = SEMANA[status] ?? { rotulo: status, cls: 'bg-muted-bg text-ink-3' }
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {s.rotulo}
    </span>
  )
}

const rotuloPagamento = (s: string) =>
  ({
    aguardando_pagamento: 'Aguardando',
    comprovante_recebido: 'Comprovante recebido',
    confirmado: 'Confirmado',
    parcial: 'Parcial',
    recusado: 'Recusado',
  })[s] ?? '—'
