import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { money } from '../../lib/supabase'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import {
  codigoDoErro, criarPedidoLink, fetchCatalogoLink, fetchSemanaLink,
  type Identificacao,
} from './api'
import {
  CLIENTE_VAZIO, PassoIdentificacao, type DadosCliente,
} from './PassoIdentificacao'
import {
  itensDoPedido, PassoAdicionais, PassoPlano, PassoPratos,
  type Escolha, type MapaQtd,
} from './PassoEscolha'
import { PassoConfirmado, PassoRevisao } from './PassoRevisao'
import { dataCurta, quandoCutoff, T, type Idioma } from './i18n'
import { Aviso } from './ui'

/* Tela 9.7 · Link público. Ref: protótipo 6e, 6g, 6f, 6a, 6c, 6b, 6d, 6h, 6i,
 * 6j, 6k, 6m.
 *
 * Única rota do sistema sem login, e por isso fora do AppLayout: não tem menu,
 * não tem perfil, não tem guarda de rota. O que protege é o servidor — o role
 * anon só alcança as funções fn_link_* (migration 1400).
 *
 * O passo mora no estado, não na URL: o fluxo é uma conversa e voltar pelo
 * botão do navegador no meio de um pedido perderia a seleção. Os "Editar" da
 * revisão levam de volta ao passo certo (tela 6i). */

type Passo = 'identificacao' | 'plano' | 'pratos' | 'adicionais' | 'revisao' | 'pronto'

export function LinkPage() {
  const [params, setParams] = useSearchParams()
  const lang: Idioma = params.get('lang') === 'pt' ? 'pt' : 'en'
  const t = T[lang]

  const semana = useQuery(fetchSemanaLink, [])
  const catalogo = useQuery(fetchCatalogoLink, [])

  const [passo, setPasso] = useState<Passo>('identificacao')
  const [dados, setDados] = useState<DadosCliente>(CLIENTE_VAZIO)
  const [escolha, setEscolha] = useState<Escolha>({ kind: 'plan', plan_id: null, size_id: null })
  const [pratos, setPratos] = useState<MapaQtd>({})
  const [addons, setAddons] = useState<MapaQtd>({})
  const [jaTemPedido, setJaTemPedido] = useState<NonNullable<Identificacao['pedidos']>>([])
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState<{
    code: string; total_cents: number; entrega: string; first_name: string
  } | null>(null)

  const itens = useMemo(() => itensDoPedido(pratos, addons), [pratos, addons])

  const trocarIdioma = () => {
    params.set('lang', lang === 'pt' ? 'en' : 'pt')
    setParams(params, { replace: true })
  }

  if (semana.loading || catalogo.loading) {
    return <Moldura lang={lang} onTrocarIdioma={trocarIdioma}>
      <Loading shape="cards" label="…" />
    </Moldura>
  }
  if (semana.error || !semana.data) {
    return <Moldura lang={lang} onTrocarIdioma={trocarIdioma}>
      <ErrorState message={semana.error ?? t.erroGenerico} onRetry={semana.reload} />
    </Moldura>
  }
  if (catalogo.error || !catalogo.data) {
    return <Moldura lang={lang} onTrocarIdioma={trocarIdioma}>
      <ErrorState message={catalogo.error ?? t.erroGenerico} onRetry={catalogo.reload} />
    </Moldura>
  }

  const s = semana.data
  const cat = catalogo.data

  // tela 6k · quem fecha é o cutoff no servidor, não o botão sumir da tela
  if (!s.aberto && passo !== 'pronto') {
    return (
      <Moldura lang={lang} onTrocarIdioma={trocarIdioma}>
        <div className="flex flex-col gap-4 items-center text-center py-8">
          <div className="text-[32px]">⏰</div>
          <h1 className="text-[20px] font-bold text-brand">{t.fechadoTitulo}</h1>
          <p className="text-[13px] text-ink-2 max-w-sm">
            {s.iso_code.replace(/^\d+-/, '')} ({dataCurta(s.starts_on, lang)}–
            {dataCurta(s.ends_on, lang)}) {t.fechadoCorpo1}{' '}
            <strong>{quandoCutoff(s.cutoff_at, lang)}</strong>.{' '}
            {t.fechadoCorpo2} <strong>{dataCurta(s.proxima_abertura, lang)}</strong>,{' '}
            {t.semana} {s.proxima_iso.replace(/^\d+-/, '')}.
          </p>
        </div>
      </Moldura>
    )
  }

  async function confirmar() {
    setConfirmando(true)
    setErro(null)
    const { data, error } = await criarPedidoLink({
      phone: dados.telefone,
      first_name: dados.first_name,
      lang,
      last_name: dados.last_name || undefined,
      street_address: dados.street_address || undefined,
      zip_code: dados.zip_code,
      delivery_notes: dados.delivery_notes || undefined,
      payment_method_id: dados.payment_method_id || null,
      kind: escolha.kind,
      plan_id: escolha.plan_id,
      size_id: escolha.size_id,
      items: itens,
    })
    setConfirmando(false)

    if (error || !data) {
      // O valor conferido na revisão é o mesmo que o servidor recalcula ao
      // gravar; se divergir, quem manda é o servidor (§2).
      const cod = codigoDoErro(error)
      setErro(
        cod === 'LB429' ? t.erroLimite
          : cod === 'LB423' ? t.erroFechado
          : cod === 'LB422' ? t.naoEntregamos
          : cod === 'LB400' ? t.erroTelefone
          : error?.message ?? t.erroGenerico,
      )
      return
    }
    setPronto(data)
    setPasso('pronto')
  }

  return (
    <Moldura lang={lang} onTrocarIdioma={trocarIdioma}
      faixa={passo === 'pronto' ? undefined : (
        <>
          <strong>{t.semana} {s.iso_code.replace(/^\d+-/, '')}</strong>
          {' · ⏰ '}{t.ateQuinta} {quandoCutoff(s.cutoff_at, lang)}
          {' · 🚚 '}{t.entregaDomingo} {dataCurta(s.entrega, lang)}
        </>
      )}>
      {/* tela 6m · já tem pedido nesta semana. Não bloqueia: mostra o que
          existe e deixa fazer outro, separado (reunião de 22/09/2026). */}
      {jaTemPedido.length > 0 && passo === 'identificacao' && (
        <Aviso tom="warn">
          ✋ <strong>{t.jaTemPedido}</strong>
          <ul className="mt-1">
            {jaTemPedido.map((o) => (
              <li key={o.code}>
                #{o.code}
                {o.plano && ` · ${o.plano}`}
                {o.tamanho && ` · ${o.tamanho}`}
                {' · '}{money(o.total_cents)}
              </li>
            ))}
          </ul>
          <div className="mt-1">{t.jaTemPedidoAjuda}</div>
        </Aviso>
      )}

      {passo === 'identificacao' && (
        <PassoIdentificacao
          t={t} lang={lang} catalogo={cat} dados={dados}
          setDados={setDados}
          onPedidoExistente={setJaTemPedido}
          jaTemPedido={jaTemPedido.length > 0}
          onAvancar={() => setPasso('plano')} />
      )}

      {passo === 'plano' && (
        <PassoPlano t={t} lang={lang} catalogo={cat} escolha={escolha}
          setEscolha={(e) => {
            // trocar plano ou tamanho invalida o que já estava escolhido: a
            // chave do prato carrega o tamanho, e o limite do plano muda
            if (e.plan_id !== escolha.plan_id || e.size_id !== escolha.size_id
                || e.kind !== escolha.kind) setPratos({})
            setEscolha(e)
          }}
          onVoltar={() => setPasso('identificacao')}
          onAvancar={() => setPasso(escolha.kind === 'addons_only' ? 'adicionais' : 'pratos')} />
      )}

      {passo === 'pratos' && (
        <PassoPratos t={t} lang={lang} catalogo={cat} escolha={escolha}
          pratos={pratos} setPratos={setPratos}
          onVoltar={() => setPasso('plano')} onAvancar={() => setPasso('adicionais')} />
      )}

      {passo === 'adicionais' && (
        <PassoAdicionais t={t} lang={lang} catalogo={cat} escolha={escolha}
          addons={addons} setAddons={setAddons}
          onVoltar={() => setPasso(escolha.kind === 'addons_only' ? 'plano' : 'pratos')}
          onAvancar={() => setPasso('revisao')} />
      )}

      {passo === 'revisao' && (
        <PassoRevisao t={t} lang={lang} catalogo={cat} dados={dados} escolha={escolha}
          itens={itens} semanaIso={s.iso_code} entrega={s.entrega}
          confirmando={confirmando} erro={erro}
          onVoltar={() => setPasso('adicionais')}
          onEditar={(p) => setPasso(p)}
          onConfirmar={confirmar} />
      )}

      {passo === 'pronto' && pronto && (
        <PassoConfirmado t={t} lang={lang} pedido={pronto} telefone={dados.telefone} />
      )}
    </Moldura>
  )
}

/** Moldura do link: marca, faixa da semana e o seletor de idioma. Fica fora do
 *  AppLayout de propósito — quem abre o link não é da equipe e não tem menu. */
function Moldura({
  lang, onTrocarIdioma, faixa, children,
}: {
  lang: Idioma; onTrocarIdioma: () => void
  faixa?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="bg-brand text-cream">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="font-bold tracking-wide text-[15px]">
            LIFE <span className="bg-lime text-brand rounded px-1">✓</span> BOX
          </span>
          <div className="flex-1" />
          <button onClick={onTrocarIdioma}
            className="border border-cream/40 rounded-lg px-2.5 py-1 text-[11.5px] hover:bg-cream/10">
            {T[lang].idioma}
          </button>
        </div>
        {faixa && (
          <div className="max-w-3xl mx-auto px-4 pb-3 text-[11.5px] text-cream/85">{faixa}</div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5">{children}</main>

      <footer className="max-w-3xl mx-auto px-4 pb-8 text-[10.5px] text-ink-muted text-center">
        LifeBox Foods
      </footer>
    </div>
  )
}
