import { useEffect, useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import { fetchCutoff, salvarCutoff } from './api'

/* Configurações · Cutoff da semana. Ref: protótipo 9d.
 *
 * §4: o link público fecha sozinho no cutoff — não existe chave para desligar
 * e não existe "deixar aberto mais um pouco". Depois dele, pedido só entra por
 * lançamento manual da equipe, com o selo pós-cutoff, e a cozinha recebe a
 * recontagem.
 *
 * A hora é sempre no fuso operacional (vem de settings), não no de quem está
 * mexendo: a equipe pode estar em outro fuso e o pedido fecha no de Boston. */

const DIAS = [
  { n: 1, nome: 'Segunda' }, { n: 2, nome: 'Terça' }, { n: 3, nome: 'Quarta' },
  { n: 4, nome: 'Quinta' }, { n: 5, nome: 'Sexta' }, { n: 6, nome: 'Sábado' },
  { n: 7, nome: 'Domingo' },
]

export function Cutoff({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchCutoff, [])
  const [weekday, setWeekday] = useState(4)
  const [hora, setHora] = useState('18:00')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (data) { setWeekday(data.weekday); setHora(data.hora) }
  }, [data])

  if (loading) return <Loading shape="cards" label="Carregando o cutoff…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const mudou = data ? weekday !== data.weekday || hora !== data.hora : false

  async function salvar() {
    setSalvando(true); setErro(null); setAviso(null)
    const { data: res, error } = await salvarCutoff(weekday, hora)
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const n = (res as { semanas_realinhadas?: number } | null)?.semanas_realinhadas ?? 0
    setAviso(n > 0
      ? `Salvo. ${n} semana${n === 1 ? '' : 's'} em aberto passou a fechar ${DIAS.find((d) => d.n === weekday)?.nome.toLowerCase()} às ${hora}.`
      : 'Salvo.')
    reload()
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <section className="bg-surface border border-line rounded-xl px-4 py-4 flex flex-col gap-3">
        <h2 className="text-[13.5px] font-bold text-brand">Cutoff da semana</h2>

        <div className="flex gap-3 flex-wrap items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-ink-2">Dia</span>
            <select value={weekday} disabled={!podeEditar} aria-label="Dia do cutoff"
              onChange={(e) => setWeekday(Number(e.target.value))}
              className="border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand disabled:text-ink-muted">
              {DIAS.map((d) => <option key={d.n} value={d.n}>{d.nome}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-ink-2">Hora</span>
            <input type="time" value={hora} disabled={!podeEditar} aria-label="Hora do cutoff"
              onChange={(e) => setHora(e.target.value)}
              className="border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand tnum disabled:text-ink-muted" />
          </label>

          {podeEditar && (
            <button onClick={salvar} disabled={!mudou || salvando}
              className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>

        <p className="text-[11.5px] text-ink-3">
          Horário de <strong>{data?.fuso.replace('_', ' ')}</strong> — o mesmo em que a
          semana e a entrega são calculadas, não o do seu computador.
        </p>

        {aviso && (
          <div role="status" className="bg-ok-bg border border-ok-line text-ok rounded-lg px-3 py-2 text-[12px]">
            ✅ {aviso}
          </div>
        )}
        {erro && (
          <div role="alert" className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2 text-[12px]">
            {erro}
          </div>
        )}
      </section>

      <section className="bg-warn-bg border border-warn-line rounded-xl px-4 py-3 text-[12px] text-warn leading-relaxed">
        ⏰ O link público <strong>fecha sozinho</strong> no cutoff — não há chave para
        desligar. Na sexta, pedido entra apenas por lançamento manual da equipe, com o
        selo <strong>pós-cutoff</strong>, e a cozinha recebe a recontagem.
      </section>

      <p className="text-[11.5px] text-ink-muted leading-relaxed">
        Mudar aqui vale também para a semana em andamento: as semanas que ainda não
        terminaram passam a fechar no novo horário. As que já acabaram ficam como
        estavam — o pedido antigo continua explicável pelo cutoff que valia na época.
      </p>
    </div>
  )
}
