import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import { fetchDadosPedido } from './api'
import { FichaPedido } from './FichaPedido'
import { PainelSemana } from './PainelSemana'

/* Tela 9.1 · Semana. Ref: protótipo 10a e 9a.
 *
 * A semana corrente é criada na primeira visita (fn_ensure_week) — não existe
 * passo manual de "abrir a semana": a segunda-feira abre sozinha (§4). */

export function SemanaPage() {
  const { profile } = useAuth()
  const [lancando, setLancando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const { data, loading, error, reload } = useQuery(() => fetchDadosPedido(), [])

  if (loading) return <div className="p-5"><Loading shape="cards" label="Abrindo a semana…" /></div>
  if (error) return <div className="p-5"><ErrorState message={error} onRetry={reload} /></div>
  if (!data) return null

  if (lancando) {
    return (
      <div className="p-5">
        <FichaPedido
          dados={data}
          onCancelar={() => setLancando(false)}
          onCriado={(code) => {
            setLancando(false)
            setAviso(`Pedido ${code} criado.`)
            setRecarga((n) => n + 1)
          }}
        />
      </div>
    )
  }

  const cutoff = new Date(data.semana.cutoff_at)

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">Semana</h1>
        <span className="bg-surface border border-line rounded-lg px-3 py-1 text-[12.5px] text-ink-2">
          <strong className="text-brand">{data.semana.iso_code.replace(/^\d+-/, '')}</strong>
          {' · '}
          {new Date(data.semana.starts_on).toLocaleDateString('pt-BR')} a{' '}
          {new Date(data.semana.ends_on).toLocaleDateString('pt-BR')}
        </span>
        <span className={`rounded-full px-3 py-1 text-[12px] font-semibold border ${
          data.passouCutoff
            ? 'bg-muted-bg border-line text-ink-3'
            : 'bg-warn-bg border-warn-line text-warn'}`}>
          {data.passouCutoff
            ? '⏰ Encerrado · aceitando pós-cutoff'
            : `⏰ Cutoff ${cutoff.toLocaleDateString('pt-BR', { weekday: 'short' })} ${cutoff.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
        </span>
      </header>

      {aviso && (
        <div className="bg-ok-bg border border-ok-line text-ok rounded-lg px-3 py-2 text-[12.5px]">
          ✅ {aviso}
        </div>
      )}

      <PainelSemana
        key={recarga}
        weekId={data.semana.id}
        isoCode={data.semana.iso_code}
        podeEditarMeta={profile?.role === 'admin'}
        onNovoPedido={() => { setAviso(null); setLancando(true) }}
      />
    </div>
  )
}
