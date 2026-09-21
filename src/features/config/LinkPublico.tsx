import { useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import { fetchProntidaoLink } from './api'

/* Configurações · Link público. Ref: §9.7, telas 6e e 6k.
 *
 * O link existia e não tinha de onde ser copiado — quem manda para o cliente
 * no WhatsApp precisava saber o endereço de cabeça. Esta aba é o lugar dele.
 *
 * Junto vem a pergunta que a equipe só descobriria pelo cliente reclamando:
 * dá para fechar pedido agora? Quatro coisas derrubam o link em silêncio, e
 * cada uma de um jeito diferente. */

export function LinkPublico() {
  const { data, loading, error, reload } = useQuery(fetchProntidaoLink, [])
  const [copiado, setCopiado] = useState<string | null>(null)

  if (loading) return <Loading shape="cards" label="Conferindo o link…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  const base = `${window.location.origin}/pedido`
  const s = data.semana

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(url)
    } catch {
      // clipboard barrado (http, permissão negada): o campo continua aí para
      // copiar à mão, e o botão não pode fingir que deu certo
      setCopiado(null)
    }
  }

  const checagens = [
    {
      ok: data.zips > 0,
      titulo: `${data.zips} ZIP code${data.zips === 1 ? '' : 's'} atendido${data.zips === 1 ? '' : 's'}`,
      falta: 'Sem ZIP cadastrado, o link recusa todo pedido por estar fora da área.',
      aba: 'ZIP Codes',
    },
    {
      ok: data.formas > 0,
      titulo: `${data.formas} forma${data.formas === 1 ? '' : 's'} de pagamento ativa${data.formas === 1 ? '' : 's'}`,
      falta: 'Sem forma ativa, o cliente chega na revisão sem ter o que escolher.',
      aba: 'Formas de pagamento',
    },
    {
      ok: data.planos > 0,
      titulo: `${data.planos} preço${data.planos === 1 ? '' : 's'} de plano cadastrado${data.planos === 1 ? '' : 's'}`,
      falta: 'Sem plano com preço, o passo 2 vem vazio.',
      aba: 'Catálogo',
    },
    {
      ok: data.pratos > 0,
      titulo: `${data.pratos} prato${data.pratos === 1 ? '' : 's'} no menu desta semana`,
      falta: 'Sem prato no menu da semana, o passo 3 vem vazio.',
      aba: 'Catálogo e menus',
    },
  ]
  const pendentes = checagens.filter((c) => !c.ok)

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <section className="bg-surface border border-line rounded-xl px-4 py-4 flex flex-col gap-3">
        <h2 className="text-[13.5px] font-bold text-brand">Link para mandar no WhatsApp</h2>

        <Endereco rotulo="Link principal" ajuda="Abre em inglês, com o seletor de idioma no topo."
          url={base} copiado={copiado === base} onCopiar={() => copiar(base)} />
        <Endereco rotulo="Abrindo direto em português" ajuda="Mesmo fluxo, já em PT."
          url={`${base}?lang=pt`} copiado={copiado === `${base}?lang=pt`}
          onCopiar={() => copiar(`${base}?lang=pt`)} />

        <p className="text-[11.5px] text-ink-muted leading-relaxed">
          O mesmo link serve todas as semanas: ele sempre mostra o menu da semana aberta e
          fecha sozinho no cutoff. Não é preciso mandar um link novo toda segunda.
        </p>
      </section>

      {s && (
        <section className={`border rounded-xl px-4 py-3 text-[12.5px] ${
          s.aberto ? 'bg-ok-bg border-ok-line text-ok' : 'bg-warn-bg border-warn-line text-warn'}`}>
          {s.aberto ? (
            <>
              ✅ <strong>Aberto agora</strong> — recebendo pedido da{' '}
              {s.iso_code.replace(/^\d+-/, '')}, até{' '}
              {new Date(s.cutoff_at).toLocaleString('pt-BR', {
                weekday: 'long', hour: '2-digit', minute: '2-digit',
                timeZone: 'America/New_York',
              })}.
            </>
          ) : (
            <>
              ⏰ <strong>Fechado</strong> — a {s.iso_code.replace(/^\d+-/, '')} passou do cutoff.
              Quem abrir o link vê a data da próxima janela. A{' '}
              {s.proxima_iso.replace(/^\d+-/, '')} abre{' '}
              {new Date(`${s.proxima_abertura}T12:00:00`).toLocaleDateString('pt-BR')}.
            </>
          )}
        </section>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-line bg-surface-alt">
          <h2 className="text-[13.5px] font-bold text-brand">
            {pendentes.length === 0
              ? 'Tudo pronto para receber pedido'
              : `${pendentes.length} coisa${pendentes.length === 1 ? '' : 's'} impedindo o pedido de fechar`}
          </h2>
        </header>
        <ul className="divide-y divide-line-soft">
          {checagens.map((c) => (
            <li key={c.titulo} className="px-4 py-2.5 flex gap-3 items-start">
              <span aria-hidden="true" className="text-[14px]">{c.ok ? '✅' : '⚠️'}</span>
              <div className="flex-1">
                <div className={`text-[12.5px] font-semibold ${c.ok ? 'text-ink' : 'text-warn'}`}>
                  {c.titulo}
                </div>
                {!c.ok && (
                  <div className="text-[11.5px] text-ink-3">
                    {c.falta} <span className="text-ink-muted">Resolve em {c.aba}.</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <a href={base} target="_blank" rel="noreferrer"
        className="self-start bg-surface border border-line-strong hover:border-brand text-ink-2 rounded-lg px-4 py-2 text-[12.5px] font-semibold">
        Abrir o link numa aba nova ↗
      </a>
    </div>
  )
}

function Endereco({
  rotulo, ajuda, url, copiado, onCopiar,
}: {
  rotulo: string; ajuda: string; url: string; copiado: boolean; onCopiar: () => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-ink-2">{rotulo}</span>
      <div className="flex gap-2 items-center flex-wrap">
        <input readOnly value={url} aria-label={rotulo}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-56 border border-line-strong rounded-lg px-3 py-2 text-[12.5px] bg-surface-alt font-mono outline-none focus:border-brand" />
        <button onClick={onCopiar}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold whitespace-nowrap">
          {copiado ? 'Copiado ✓' : 'Copiar'}
        </button>
      </div>
      <span className="text-[11px] text-ink-muted">{ajuda}</span>
    </label>
  )
}
