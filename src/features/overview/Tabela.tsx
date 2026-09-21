import { money } from '../../lib/supabase'
import type { PontoSerie, Tipo } from './api'

/* Overview · aba Tabela. Ref: protótipo 8b.
 *
 * É a grade da planilha que a LifeBox já usava: indicadores em linhas,
 * períodos em colunas. Existe para conferência — quem desconfia de um número
 * do dashboard vem aqui ver a série inteira lado a lado, e exporta.
 *
 * Os mesmos valores do dashboard, da mesma função: se divergissem, um dos dois
 * estaria mentindo e não haveria como saber qual. */

type Linha = {
  grupo: string
  label: string
  hint?: string
  valor: (p: PontoSerie) => string
}

const LINHAS: Linha[] = [
  { grupo: '💰 Resultado', label: 'Faturamento', hint: 'pedidos da semana',
    valor: (p) => money(p.total_cents) },
  { grupo: '💰 Resultado', label: 'Faturado', hint: 'pagamento confirmado',
    valor: (p) => money(p.faturado_cents) },
  { grupo: '💰 Resultado', label: 'A receber',
    valor: (p) => money(p.total_cents - p.faturado_cents) },
  { grupo: '💰 Resultado', label: 'Meta', valor: (p) => p.meta_cents ? money(p.meta_cents) : '—' },
  { grupo: '💰 Resultado', label: '% da meta',
    valor: (p) => p.meta_cents
      ? `${((p.total_cents / p.meta_cents) * 100).toFixed(1).replace('.', ',')}%` : '—' },
  { grupo: '💰 Resultado', label: 'Ano anterior',
    valor: (p) => p.ano_anterior_cents ? money(p.ano_anterior_cents) : '—' },

  { grupo: 'Orders', label: 'Total Pedidos', hint: 'Novo + Renovação',
    valor: (p) => String(p.novo + p.renovacao) },
  { grupo: 'Orders', label: '✅ Novo Pedido', valor: (p) => String(p.novo) },
  { grupo: 'Orders', label: '🔁 Renovação', valor: (p) => String(p.renovacao) },
  { grupo: 'Orders', label: '🕒 Skip', hint: 'fora do total', valor: (p) => String(p.skip) },
  { grupo: 'Orders', label: '❌ Cancelamento', hint: 'fora do total',
    valor: (p) => String(p.cancelamento) },
]

export function Tabela({
  serie, tipo, onAbrir,
}: {
  serie: PontoSerie[]
  tipo: Tipo
  onAbrir: (chave: string) => void
}) {
  const grupos = [...new Set(LINHAS.map((l) => l.grupo))]

  function exportar() {
    const sep = ','
    const cab = ['Indicador', ...serie.map((p) => p.rotulo)].join(sep)
    const corpo = LINHAS.map((l) =>
      [l.label, ...serie.map((p) => l.valor(p).replace(/,/g, ''))].join(sep))
    const csv = [cab, ...corpo].join('\n')
    // BOM: sem ele o Excel abre "Renovação" como "RenovaÃ§Ã£o"
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lifebox-overview-${tipo}-${serie.at(-1)?.chave ?? ''}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="text-[11.5px] text-ink-3 flex-1">
          {tipo === 'week' ? 'semanas' : tipo === 'month' ? 'meses' : 'anos'} em colunas ·
          os mesmos números do dashboard, da mesma consulta
        </p>
        <button onClick={exportar}
          className="bg-surface border border-line-strong hover:border-brand text-ink-2
                     rounded-lg px-3.5 py-1.5 text-[12px] font-semibold">
          Exportar CSV
        </button>
      </div>

      <section className="bg-surface border border-line rounded-xl overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-surface-alt text-[10px] uppercase tracking-wide text-ink-muted">
              <th className="text-left font-semibold px-4 py-2 min-w-44">Indicador</th>
              {serie.map((p) => (
                <th key={p.chave} className="text-right font-semibold px-3 min-w-24">
                  <button onClick={() => onAbrir(p.chave)} className="hover:text-brand">
                    {p.rotulo}
                    {p.em_andamento && (
                      <span className="block text-[9px] text-late-text font-bold">
                        EM ANDAMENTO
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <ItensDoGrupo key={g} grupo={g} serie={serie} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function ItensDoGrupo({ grupo, serie }: { grupo: string; serie: PontoSerie[] }) {
  return (
    <>
      <tr className="bg-leaf-bg/50">
        <td colSpan={serie.length + 1}
          className="px-4 py-1.5 text-[11px] font-bold text-leaf uppercase tracking-wide">
          {grupo}
        </td>
      </tr>
      {LINHAS.filter((l) => l.grupo === grupo).map((l) => (
        <tr key={l.label} className="border-t border-line-soft">
          <td className="px-4 py-2 text-ink-2">
            {l.label}
            {l.hint && <span className="block text-[10px] text-ink-muted">{l.hint}</span>}
          </td>
          {serie.map((p) => (
            <td key={p.chave} className="px-3 text-right font-semibold text-ink tnum">
              {l.valor(p)}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
