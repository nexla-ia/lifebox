import { useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import {
  alternarOrigem, clientesDaOrigem, fetchOrigens, removerOrigem, salvarOrigem, type Origem,
} from './api'

/* Configurações · Origens de lead. Ref: protótipo 9d.
 *
 * Duas espécies na mesma lista: canal (Ads, Instagram, Indicações) e
 * influenciador, que entra pelo nome e aparece no ranking de origens do
 * Overview (§10). É a mesma tabela porque a pergunta é a mesma — "de onde veio
 * essa pessoa?" — e separar em duas telas faria a equipe escolher onde
 * cadastrar antes de saber a resposta. */

const ESPECIE = {
  channel: { rotulo: 'Canal', icone: '📣' },
  influencer: { rotulo: 'Influenciador', icone: '⭐' },
} as const

export function Origens({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchOrigens, [])
  const [novo, setNovo] = useState<{ name: string; kind: Origem['kind'] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  if (loading) return <Loading shape="rows" label="Carregando origens…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const origens = data ?? []

  async function salvar(o: { id?: string; name: string; kind: Origem['kind'] }) {
    setErro(null)
    const nome = o.name.trim()
    if (!nome) return
    const { error } = await salvarOrigem({ ...o, name: nome })
    if (error) {
      // unique em sources.name: o nome repetido é justamente o que bagunçaria
      // o ranking, somando a mesma origem em duas linhas
      setErro(error.code === '23505'
        ? `Já existe uma origem chamada "${nome}".`
        : error.message)
      return
    }
    setNovo(null)
    reload()
  }

  return (
    <div className="flex flex-col gap-4">
      {podeEditar && (
        <section className="bg-surface border border-line rounded-xl px-4 py-3 flex flex-col gap-2">
          <h2 className="text-[13.5px] font-bold text-brand">Nova origem</h2>
          <div className="flex gap-2 flex-wrap items-end">
            <label className="flex flex-col gap-1 flex-1 min-w-48">
              <span className="text-[11.5px] font-semibold text-ink-2">Nome</span>
              <input value={novo?.name ?? ''} aria-label="Nome da origem"
                placeholder="Instagram, Ads, nome do influenciador…"
                onChange={(e) => setNovo({ kind: novo?.kind ?? 'channel', name: e.target.value })}
                className="border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand" />
            </label>
            <div className="flex gap-1.5">
              {(['channel', 'influencer'] as const).map((k) => (
                <button key={k} onClick={() => setNovo({ name: novo?.name ?? '', kind: k })}
                  aria-pressed={(novo?.kind ?? 'channel') === k}
                  className={`rounded-lg px-3 py-2 text-[12.5px] border ${
                    (novo?.kind ?? 'channel') === k
                      ? 'bg-brand border-brand text-cream font-semibold'
                      : 'bg-surface border-line-strong text-ink-2 hover:border-brand'}`}>
                  {ESPECIE[k].icone} {ESPECIE[k].rotulo}
                </button>
              ))}
            </div>
            <button
              onClick={() => novo && salvar({ name: novo.name, kind: novo.kind })}
              disabled={!novo?.name.trim()}
              className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
              Adicionar
            </button>
          </div>
          {erro && (
            <div role="alert" className="text-[12px] text-danger">{erro}</div>
          )}
          <p className="text-[11.5px] text-ink-muted">
            Influenciadores entram pelo nome e aparecem no ranking de origens do Overview.
          </p>
        </section>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-line bg-surface-alt">
          <h2 className="text-[13.5px] font-bold text-brand">
            Origens de lead · {origens.length}
          </h2>
        </header>

        {origens.length === 0 ? (
          <EmptyState icon="📣" title="Nenhuma origem cadastrada"
            body="A origem é o que responde 'de onde veio esse cliente' no Overview. Sem nenhuma, a ficha do cliente fica sem essa pergunta." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {origens.map((o) => (
              <Linha key={o.id} o={o} podeEditar={podeEditar}
                onSalvar={(nome, kind) => salvar({ id: o.id, name: nome, kind })}
                onMudou={reload} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Linha({
  o, podeEditar, onSalvar, onMudou,
}: {
  o: Origem; podeEditar: boolean
  onSalvar: (nome: string, kind: Origem['kind']) => void
  onMudou: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(o.name)
  const [confirmar, setConfirmar] = useState<number | null>(null)

  async function tentarRemover() {
    const n = await clientesDaOrigem(o.id)
    if (n > 0) { setConfirmar(n); return }
    await removerOrigem(o.id)
    onMudou()
  }

  return (
    <li className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="text-[15px]" aria-hidden="true">{ESPECIE[o.kind].icone}</span>

      {editando ? (
        <input value={nome} onChange={(e) => setNome(e.target.value)}
          aria-label={`Nome de ${o.name}`}
          className="flex-1 min-w-40 border border-line-strong rounded-lg px-2.5 py-1 text-[13px] bg-surface-alt outline-none focus:border-brand" />
      ) : (
        <span className={`flex-1 min-w-40 text-[13px] font-semibold ${
          o.active ? 'text-ink' : 'text-ink-muted line-through'}`}>
          {o.name}
        </span>
      )}

      <span className="text-[11px] text-ink-3">{ESPECIE[o.kind].rotulo}</span>

      {podeEditar && (
        <div className="flex gap-2 items-center">
          {editando ? (
            <>
              <button onClick={() => { onSalvar(nome, o.kind); setEditando(false) }}
                className="bg-brand text-cream rounded-md px-3 py-1 text-[11.5px] font-semibold">
                Salvar
              </button>
              <button onClick={() => { setNome(o.name); setEditando(false) }}
                className="text-[11.5px] text-ink-3">Cancelar</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditando(true)}
                className="text-[11.5px] text-brand-mid hover:underline">editar</button>
              <button onClick={async () => { await alternarOrigem(o.id, !o.active); onMudou() }}
                className="text-[11.5px] text-ink-3 hover:text-brand">
                {o.active ? 'desativar' : 'reativar'}
              </button>
              <button onClick={tentarRemover} aria-label={`Remover ${o.name}`}
                className="text-[13px] text-ink-muted hover:text-danger">✕</button>
            </>
          )}
        </div>
      )}

      {confirmar !== null && (
        <div role="alert"
          className="basis-full bg-warn-bg border border-warn-line text-warn rounded-lg px-3 py-2 text-[12px]">
          <strong>{confirmar} cliente{confirmar === 1 ? '' : 's'}</strong> {confirmar === 1 ? 'veio' : 'vieram'} por
          esta origem. Apagar deixaria o histórico do Overview sem explicação —
          desative para tirar do formulário sem perder o passado.
          <div className="mt-1.5 flex gap-2">
            <button onClick={async () => {
              await alternarOrigem(o.id, false); setConfirmar(null); onMudou()
            }} className="bg-brand text-cream rounded-md px-3 py-1 text-[11.5px] font-semibold">
              Desativar
            </button>
            <button onClick={() => setConfirmar(null)} className="text-[11.5px] text-ink-3">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
