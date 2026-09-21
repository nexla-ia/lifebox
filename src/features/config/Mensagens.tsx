import { useEffect, useRef, useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import { fetchTemplates, salvarTemplate } from './api'

/* Configurações · Mensagens do WhatsApp. Ref: protótipo 6p.
 *
 * O texto é da LifeBox, não do código: a mensagem que o cliente recebe muda
 * com a campanha, com a forma de pagamento e com o tom da semana. As variáveis
 * entre chaves são preenchidas pela automação na hora do envio (§9.2).
 *
 * {instrucoes_pagamento} e {link_pagamento} NÃO são escritos aqui — vêm da
 * forma de pagamento cadastrada na aba ao lado. Assim, trocar a chave do Zelle
 * não obriga ninguém a reescrever a mensagem. */

const VARIAVEIS = [
  'nome', 'numero_pedido', 'semana', 'plano', 'tamanho', 'lista_pratos',
  'adicionais', 'total', 'forma_pagamento', 'status_pagamento',
  'instrucoes_pagamento', 'link_pagamento', 'data_entrega',
] as const

/** Valores só da prévia. Não são de cliente nenhum: são rótulos do formato,
 *  para a equipe ver onde cada variável cai. */
const EXEMPLO: Record<string, string> = {
  nome: 'Maria',
  numero_pedido: '#W39-0142',
  semana: 'W39',
  plano: '10 Meals + 5 Breakfasts',
  tamanho: 'Large',
  lista_pratos: 'Grilled Chicken ×3, Salmon ×2, Beef Stroganoff ×3',
  adicionais: '5 Juices ×1',
  total: '$221.52',
  forma_pagamento: 'Zelle',
  status_pagamento: 'aguardando pagamento',
  instrucoes_pagamento: '(das Formas de pagamento)',
  link_pagamento: '(das Formas de pagamento)',
  data_entrega: 'domingo 27/09',
}

const CHAVES = [
  { key: 'order_confirmation', rotulo: 'Confirmação de pedido' },
] as const

export function Mensagens({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchTemplates, [])
  const [lang, setLang] = useState<'pt' | 'en'>('pt')
  const [corpo, setCorpo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  const chave = CHAVES[0].key
  const doBanco = (data ?? []).find((t) => t.key === chave && t.language === lang)?.body ?? ''
  const [salvo, setSalvo] = useState('')

  useEffect(() => { setSalvo(doBanco); setCorpo(doBanco); setAviso(null) }, [doBanco])

  if (loading) return <Loading shape="cards" label="Carregando mensagens…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  /** Inserir no cursor, não no fim: a equipe escreve a frase e põe a variável
   *  no meio dela. Clicar e ver o texto aparecer lá embaixo faria recortar e
   *  colar toda vez. */
  function inserir(v: string) {
    const el = area.current
    const marca = `{${v}}`
    if (!el) { setCorpo(corpo + marca); return }
    const i = el.selectionStart ?? corpo.length
    const j = el.selectionEnd ?? i
    const novo = corpo.slice(0, i) + marca + corpo.slice(j)
    setCorpo(novo)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(i + marca.length, i + marca.length)
    })
  }

  /** Sem reload depois de salvar, de propósito. `useQuery.reload` volta a
   *  `loading`, e aí a aba inteira vira skeleton: o texto some da tela, o
   *  cursor se perde e a confirmação nem chega a aparecer. O que ficou no
   *  banco é o que acabamos de mandar — se não tivesse ido, teria vindo erro. */
  async function salvar() {
    setSalvando(true); setErro(null); setAviso(null)
    const { error } = await salvarTemplate({ key: chave, language: lang, body: corpo })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setSalvo(corpo)
    setAviso('Template salvo.')
  }

  const previa = corpo.replace(/\{(\w+)\}/g, (todo, v: string) => EXEMPLO[v] ?? todo)
  const desconhecidas = [...corpo.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((v, i, a) => !(VARIAVEIS as readonly string[]).includes(v) && a.indexOf(v) === i)

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-surface border border-line rounded-xl px-4 py-3 flex flex-col gap-3">
        <header className="flex items-center gap-3 flex-wrap">
          <h2 className="text-[13.5px] font-bold text-brand">
            {CHAVES[0].rotulo} · WhatsApp
          </h2>
          <div className="flex-1" />
          <div className="flex gap-1">
            {(['pt', 'en'] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
                className={`rounded-lg px-3 py-1 text-[12px] border ${
                  lang === l ? 'bg-brand border-brand text-cream font-semibold'
                             : 'bg-surface border-line text-ink-2 hover:border-brand'}`}>
                {l === 'pt' ? 'Português' : 'English'}
              </button>
            ))}
          </div>
        </header>

        {podeEditar && (
          <div>
            <div className="text-[11.5px] font-semibold text-ink-2 mb-1">
              Variáveis · clique para inserir
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {VARIAVEIS.map((v) => (
                <button key={v} onClick={() => inserir(v)}
                  className="bg-leaf-bg border border-leaf-line text-leaf rounded-full px-2.5 py-0.5 text-[11px] font-semibold hover:bg-leaf-line">
                  {'{' + v + '}'}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Template</span>
          <textarea ref={area} value={corpo} readOnly={!podeEditar} rows={16}
            aria-label={`Template em ${lang === 'pt' ? 'português' : 'inglês'}`}
            onChange={(e) => { setCorpo(e.target.value); setAviso(null) }}
            className="border border-line-strong rounded-lg px-3 py-2 text-[12.5px] leading-relaxed bg-surface-alt outline-none focus:border-brand font-mono" />
        </label>

        {desconhecidas.length > 0 && (
          <div role="alert"
            className="bg-warn-bg border border-warn-line text-warn rounded-lg px-3 py-2 text-[12px]">
            ⚠️ {desconhecidas.map((v) => `{${v}}`).join(', ')}{' '}
            {desconhecidas.length === 1 ? 'não é uma variável conhecida' : 'não são variáveis conhecidas'} —
            {desconhecidas.length === 1 ? ' vai chegar' : ' vão chegar'} assim mesmo, entre chaves,
            na mensagem do cliente.
          </div>
        )}

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

        {podeEditar && (
          <div className="flex gap-2 items-center">
            <button onClick={salvar} disabled={salvando || corpo === salvo}
              className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
              {salvando ? 'Salvando…' : 'Salvar template'}
            </button>
            {corpo !== salvo && (
              <button onClick={() => setCorpo(salvo)} className="text-[12px] text-ink-3">
                Desfazer
              </button>
            )}
          </div>
        )}
      </section>

      {/* Prévia no formato da conversa, como na tela 6p: o texto é lido no
          WhatsApp, não num campo de formulário. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[13.5px] font-bold text-brand">Prévia</h2>
        <div className="bg-[#0b141a] rounded-xl p-4 max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-full bg-brand text-cream grid place-items-center text-[11px] font-bold">
              LB
            </span>
            <div className="text-cream text-[12px] font-semibold">
              LifeBox Foods
              <span className="block text-[10px] text-cream/60 font-normal">online</span>
            </div>
          </div>
          <div className="bg-[#005c4b] text-white rounded-xl rounded-tr-sm px-3 py-2 text-[12.5px] whitespace-pre-wrap leading-relaxed">
            {previa || '—'}
            <div className="text-[10px] text-white/60 text-right mt-1">✓✓</div>
          </div>
        </div>
        <p className="text-[11px] text-ink-muted">
          Os valores da prévia são de exemplo. A mensagem sempre pede o comprovante — é
          ele que alimenta a fila de conferência na Semana.
        </p>
      </section>
    </div>
  )
}
