import type { LeadType, StatusCliente } from './api'

/* Selos de status e Lead Type. Ref: protótipo 4a e 10d.
 *
 * São DOIS eixos independentes (§6.2 e §6.3): o Lead Type é fixo na pessoa e
 * nunca volta de Old para New; o status do cliente muda com a operação. */

const STATUS: Record<StatusCliente, { rotulo: string; cls: string }> = {
  ativo: { rotulo: 'Ativo', cls: 'bg-ok-bg text-ok border-ok-line' },
  pausado: { rotulo: '⏰ Pausado', cls: 'bg-warn-bg text-warn border-warn-line' },
  cancelado: { rotulo: '❌ Cancelado', cls: 'bg-danger-bg text-danger border-danger-line' },
  lead: { rotulo: '🧲 Lead', cls: 'bg-muted-bg text-ink-3 border-line' },
}

export function SeloStatus({ status }: { status: StatusCliente }) {
  const s = STATUS[status]
  return (
    <span className={`border rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${s.cls}`}>
      {s.rotulo}
    </span>
  )
}

export function SeloLead({ tipo }: { tipo: LeadType }) {
  return tipo === 'new' ? (
    <span
      className="bg-muted-bg border border-line text-ink-3 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      title="Primeiro contato"
    >
      🧲 New Lead
    </span>
  ) : (
    <span
      className="bg-info-bg border border-info-line text-info rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      title="Já existe na base — nunca volta a ser New Lead (§6.2)"
    >
      ♻️ Old Lead
    </span>
  )
}
