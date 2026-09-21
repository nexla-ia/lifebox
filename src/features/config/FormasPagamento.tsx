import { useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import {
  alternarForma, fetchFormas, removerForma, salvarForma, type FormaPagamento,
} from './api'

/* Configurações · Formas de pagamento. Ref: protótipo 9d.
 *
 * Cada forma carrega as instruções em PT e EN e, quando é cartão, o link de
 * pagamento. Elas entram na mensagem de confirmação pelas variáveis
 * {instrucoes_pagamento} e {link_pagamento} (tela 6p) — por isso o texto mora
 * aqui e não dentro do template: trocar a chave do Zelle não pode exigir
 * reescrever a mensagem.
 *
 * `recipient_keys` é a lista de destinatários reconhecidos na checagem do
 * comprovante (§9.3): é contra ela que a automação confere para quem o dinheiro
 * foi. Chave errada aqui vira comprovante recusado na conferência. */

const VAZIA = {
  name_pt: '', name_en: '', instructions_pt: '', instructions_en: '',
  pay_link: '', recipient_keys: [] as string[],
}

export function FormasPagamento({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchFormas, [])
  const [editando, setEditando] = useState<string | 'nova' | null>(null)

  if (loading) return <Loading shape="rows" label="Carregando formas…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const formas = data ?? []
  const ativas = formas.filter((f) => f.active).length

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {ativas === 0 && formas.length > 0 && (
        <div role="alert"
          className="bg-danger-bg border border-danger-line text-danger rounded-xl px-4 py-3 text-[12.5px]">
          ⚠️ <strong>Nenhuma forma ativa.</strong> Sem pelo menos uma, o link público não
          consegue fechar pedido.
        </div>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-center gap-3">
          <h2 className="text-[13.5px] font-bold text-brand">
            Formas de pagamento · {formas.length}
          </h2>
          <div className="flex-1" />
          {podeEditar && editando !== 'nova' && (
            <button onClick={() => setEditando('nova')}
              className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-3.5 py-1.5 text-[12px] font-semibold">
              ＋ Adicionar
            </button>
          )}
        </header>

        {editando === 'nova' && (
          <div className="px-4 py-3 border-b border-line bg-leaf-bg/40">
            <Formulario inicial={VAZIA} onCancelar={() => setEditando(null)}
              onSalvo={() => { setEditando(null); reload() }} />
          </div>
        )}

        {formas.length === 0 && editando !== 'nova' ? (
          <EmptyState icon="💳" title="Nenhuma forma cadastrada"
            body="Sem forma ativa, o link público não consegue fechar pedido. Cadastre a primeira." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {formas.map((f) => (
              <li key={f.id} className="px-4 py-3">
                {editando === f.id ? (
                  <Formulario inicial={f} onCancelar={() => setEditando(null)}
                    onSalvo={() => { setEditando(null); reload() }} />
                ) : (
                  <div className="flex gap-3 items-start flex-wrap">
                    <div className="flex-1 min-w-52">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13.5px] font-bold ${
                          f.active ? 'text-ink' : 'text-ink-muted line-through'}`}>
                          {f.name_pt}
                        </span>
                        {f.name_en !== f.name_pt && (
                          <span className="text-[11px] text-ink-muted">EN: {f.name_en}</span>
                        )}
                        {!f.active && (
                          <span className="bg-muted-bg border border-line rounded-full px-2 py-0.5 text-[10px] text-ink-3">
                            inativo no link público
                          </span>
                        )}
                      </div>
                      {f.instructions_pt && (
                        <div className="text-[11.5px] text-ink-3 mt-0.5">PT: {f.instructions_pt}</div>
                      )}
                      {f.instructions_en && (
                        <div className="text-[11.5px] text-ink-3">EN: {f.instructions_en}</div>
                      )}
                      {f.pay_link && (
                        <div className="text-[11.5px] text-brand-mid mt-0.5">🔗 {f.pay_link}</div>
                      )}
                      {f.recipient_keys.length > 0 && (
                        <div className="text-[11px] text-ink-muted mt-0.5">
                          Destinatários reconhecidos: {f.recipient_keys.join(', ')}
                        </div>
                      )}
                    </div>

                    {podeEditar && (
                      <div className="flex gap-2 items-center">
                        <button onClick={() => setEditando(f.id)}
                          className="text-[11.5px] text-brand-mid hover:underline">editar</button>
                        <button onClick={async () => { await alternarForma(f.id, !f.active); reload() }}
                          className="text-[11.5px] text-ink-3 hover:text-brand">
                          {f.active ? 'desativar' : 'reativar'}
                        </button>
                        <button onClick={async () => { await removerForma(f.id); reload() }}
                          aria-label={`Remover ${f.name_pt}`}
                          className="text-[13px] text-ink-muted hover:text-danger">✕</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11.5px] text-ink-muted leading-relaxed">
        Instruções e link de cada forma ativa entram na mensagem de confirmação por{' '}
        <code className="bg-muted-bg rounded px-1">{'{instrucoes_pagamento}'}</code> e{' '}
        <code className="bg-muted-bg rounded px-1">{'{link_pagamento}'}</code>, junto do
        pedido de comprovante.
      </p>
    </div>
  )
}

function Formulario({
  inicial, onSalvo, onCancelar,
}: {
  inicial: Partial<FormaPagamento>
  onSalvo: () => void
  onCancelar: () => void
}) {
  const [f, setF] = useState<Partial<FormaPagamento>>(inicial)
  const [chaves, setChaves] = useState((inicial.recipient_keys ?? []).join(', '))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const campo = 'w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface outline-none focus:border-brand'

  async function salvar() {
    if (!f.name_pt?.trim()) { setErro('O nome em português é obrigatório.'); return }
    setSalvando(true); setErro(null)
    const { error } = await salvarForma({
      ...f,
      name_pt: f.name_pt.trim(),
      // uma forma só, com o mesmo nome nos dois idiomas, é o caso comum
      // (Zelle, Venmo): não obrigar a digitar duas vezes
      name_en: (f.name_en?.trim() || f.name_pt.trim()),
      recipient_keys: chaves.split(',').map((c) => c.trim()).filter(Boolean),
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSalvo()
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid sm:grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Nome (PT)</span>
          <input value={f.name_pt ?? ''} aria-label="Nome da forma em português"
            onChange={(e) => setF({ ...f, name_pt: e.target.value })}
            placeholder="Zelle" className={campo} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Nome (EN)</span>
          <input value={f.name_en ?? ''} aria-label="Nome da forma em inglês"
            onChange={(e) => setF({ ...f, name_en: e.target.value })}
            placeholder="igual ao PT, se for o caso" className={campo} />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Instruções (PT)</span>
          <input value={f.instructions_pt ?? ''} aria-label="Instruções em português"
            onChange={(e) => setF({ ...f, instructions_pt: e.target.value })}
            placeholder="Envie para …" className={campo} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Instruções (EN)</span>
          <input value={f.instructions_en ?? ''} aria-label="Instruções em inglês"
            onChange={(e) => setF({ ...f, instructions_en: e.target.value })}
            placeholder="Send to …" className={campo} />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-ink-2">
          Link de pagamento <span className="text-ink-muted font-normal">(cartão)</span>
        </span>
        <input value={f.pay_link ?? ''} aria-label="Link de pagamento"
          onChange={(e) => setF({ ...f, pay_link: e.target.value })}
          placeholder="https://…/pay/{numero_pedido}" className={campo} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-ink-2">
          Destinatários reconhecidos
        </span>
        <input value={chaves} aria-label="Destinatários reconhecidos"
          onChange={(e) => setChaves(e.target.value)}
          placeholder="e-mail, telefone ou @usuário, separados por vírgula" className={campo} />
        <span className="text-[11px] text-ink-muted">
          É contra esta lista que a conferência do comprovante checa para quem o dinheiro
          foi. Deixar fora um destinatário que vocês usam manda o comprovante para a fila
          de conferência manual.
        </span>
      </label>

      {erro && <div role="alert" className="text-[12px] text-danger">{erro}</div>}

      <div className="flex gap-2">
        <button onClick={salvar} disabled={salvando}
          className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={onCancelar} className="text-[12.5px] text-ink-3 px-2">Cancelar</button>
      </div>
    </div>
  )
}
