import { useEffect, useState } from 'react'
import { money } from '../../lib/supabase'
import { linkWhatsApp } from '../../lib/telefone'
import { precificarLink, type CatalogoLink, type ItemPedido, type Preco } from './api'
import type { DadosCliente } from './PassoIdentificacao'
import type { Escolha } from './PassoEscolha'
import { dataCurta, nome, type Idioma, type Textos } from './i18n'
import { Aviso, BotaoPrincipal, Voltar } from './ui'

/* Passo 5 · tela 6i.
 *
 * Todo número desta tela veio do servidor. O front manda os itens e recebe
 * linhas e totais (§2) — se ele somasse, o valor da revisão poderia diferir do
 * que o pedido grava, e a diferença só apareceria depois de confirmado. */

export function PassoRevisao({
  t, lang, catalogo, dados, escolha, itens, semanaIso, entrega,
  onEditar, onConfirmar, confirmando, erro, onVoltar,
}: {
  t: Textos; lang: Idioma; catalogo: CatalogoLink
  dados: DadosCliente; escolha: Escolha; itens: ItemPedido[]
  semanaIso: string; entrega: string
  onEditar: (passo: 'plano' | 'pratos' | 'adicionais') => void
  onConfirmar: () => void
  confirmando: boolean
  erro: string | null
  onVoltar: () => void
}) {
  const [preco, setPreco] = useState<Preco | null>(null)
  const [erroPreco, setErroPreco] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setErroPreco(null)
    void precificarLink({
      kind: escolha.kind, plan_id: escolha.plan_id, size_id: escolha.size_id,
      fulfillment: dados.fulfillment, items: itens,
    }).then(({ data, error }) => {
      if (cancelado) return
      if (error || !data) {
        // a mensagem do banco explica o caso real ("só pode ser vendido com um
        // plano", "sem preço para o tamanho"); genérico aqui é pior
        setErroPreco(error?.message ?? t.erroGenerico)
        return
      }
      setPreco(data)
    })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(itens), escolha.kind, escolha.plan_id, escolha.size_id,
      dados.fulfillment])

  const plano = catalogo.plans.find((p) => p.id === escolha.plan_id)
  const tamanho = catalogo.sizes.find((s) => s.id === escolha.size_id)
  const linhaPlano = preco?.lines.find((l) => l.item_type === 'plan_base') ?? null

  /** Unitário da faixa, do mesmo lugar de onde o servidor tirou o preço
   *  (extra_prices, via catálogo). Não é conta feita aqui. */
  const unitExtra = (kind: 'meal' | 'breakfast') =>
    plano?.extras.find((e) => e.size_id === escolha.size_id && e.item_kind === kind)
      ?.unit_price_cents ?? 0

  const linhasAddon = (preco?.lines ?? []).filter(
    (l) => l.item_type === 'addon' && l.unit_price_cents > 0)
  const nomeAddon = (l: Preco['lines'][number]) => {
    const a = catalogo.addons.find((x) => x.id === l.addon_id)
    return `${a ? nome(a, lang) : l.name_snapshot}${l.qty > 1 ? ` ×${l.qty}` : ''}`
  }

  const listaPratos = itens
    .filter((i): i is Extract<ItemPedido, { type: 'dish' }> => i.type === 'dish')
    .map((i) => {
      const d = catalogo.dishes.find((x) => x.id === i.dish_id)
      const s = catalogo.sizes.find((x) => x.id === i.size_id)
      return d ? `${nome(d, lang)} ×${i.qty}${escolha.kind === 'custom' && s ? ` (${s.code})` : ''}` : null
    })
    .filter(Boolean)
    .join(' · ')

  const listaAddons = itens
    .filter((i): i is Extract<ItemPedido, { type: 'addon' }> => i.type === 'addon')
    .map((i) => {
      const a = catalogo.addons.find((x) => x.id === i.addon_id)
      return a ? `${nome(a, lang)} ×${i.qty}` : null
    })
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <Voltar onClick={onVoltar}>{t.voltar}</Voltar>
      <h1 className="text-[19px] font-bold text-brand">
        {t.revisarTitulo} · {semanaIso.replace(/^\d+-/, '')}
      </h1>

      <Bloco titulo={t.plano} onEditar={() => onEditar('plano')} rotuloEditar={t.editar}>
        {plano ? `${nome(plano, lang)}${tamanho ? ` · ${tamanho.name}` : ''}`
          : `${t.personalizado}${tamanho ? ` · ${tamanho.name}` : ''}`}
        {preco && preco.meals_extra + preco.breakfasts_extra > 0 && (
          <span className="text-late-text font-semibold">
            {' '}· +{preco.meals_extra + preco.breakfasts_extra} {t.extras}
          </span>
        )}
      </Bloco>

      {listaPratos && (
        <Bloco titulo={t.pratos} onEditar={() => onEditar('pratos')} rotuloEditar={t.editar}>
          {listaPratos}
        </Bloco>
      )}

      <Bloco titulo={t.entregaE} onEditar={() => onEditar('adicionais')} rotuloEditar={t.editar}>
        {listaAddons && <>{listaAddons} · </>}
        {dados.first_name} {dados.last_name} ·{' '}
        {dados.fulfillment === 'pickup'
          ? t.retirada
          : `${dados.street_address}, ${dados.city}`}
        {dados.payment_method_id && (
          <>
            {' · '}
            {nome(
              catalogo.payment_methods.find((f) => f.id === dados.payment_method_id)!,
              lang,
            )}
          </>
        )}
      </Bloco>

      {erroPreco && <Aviso tom="danger">{erroPreco}</Aviso>}

      {preco && (
        <section className="bg-surface border border-line rounded-xl px-4 py-3 flex flex-col gap-1.5">
          {/* O RÓTULO vem do catálogo no idioma da tela; o VALOR vem do
              servidor. `name_snapshot` é sempre português, porque é o que a
              cozinha lê (§5.5) — usá-lo aqui colocaria "Plano 10+5" no meio
              de uma tela em inglês. */}
          {linhaPlano && plano && (
            <Linha rotulo={`${nome(plano, lang)}${tamanho ? ` · ${tamanho.name}` : ''}`}
              valor={money(linhaPlano.unit_price_cents * linhaPlano.qty)} />
          )}

          {preco.meals_extra > 0 && (
            <Linha rotulo={`${t.refeicaoExtra} ×${preco.meals_extra}`}
              valor={money(unitExtra('meal') * preco.meals_extra)} />
          )}
          {preco.breakfasts_extra > 0 && (
            <Linha rotulo={`${t.breakfastExtra} ×${preco.breakfasts_extra}`}
              valor={money(unitExtra('breakfast') * preco.breakfasts_extra)} />
          )}

          {/* Adicional tributável entra no subtotal; o que não é tributável
              fica DEPOIS do delivery, como na tela 6i — misturar os dois faria
              o subtotal não bater com o tax ao lado. */}
          {linhasAddon.filter((l) => l.taxable).map((l, i) => (
            <Linha key={`t${i}`} rotulo={nomeAddon(l)} valor={money(l.unit_price_cents * l.qty)} />
          ))}

          <div className="border-t border-line-soft my-1" />
          <Linha rotulo={t.subtotal} valor={money(preco.taxable_cents)} />
          <Linha rotulo={`${t.tax} ${Math.round(catalogo.tax_rate * 100)}%`}
            valor={money(preco.tax_cents)} />
          {preco.delivery_cents > 0 && (
            <Linha rotulo={t.delivery} valor={money(preco.delivery_cents)} />
          )}

          {linhasAddon.filter((l) => !l.taxable).map((l, i) => (
            <Linha key={`n${i}`} rotulo={nomeAddon(l)} nota={t.semTaxDelivery}
              valor={money(l.unit_price_cents * l.qty)} />
          ))}

          <div className="border-t border-line-strong mt-1 pt-2 flex justify-between items-baseline">
            <span className="text-[14px] font-bold text-ink">{t.total}</span>
            <span aria-label={t.total} className="text-[20px] font-bold text-brand tnum">
              {money(preco.total_cents)}
            </span>
          </div>
        </section>
      )}

      {erro && <Aviso tom="danger">{erro}</Aviso>}

      <BotaoPrincipal onClick={onConfirmar}
        disabled={!preco || confirmando}>
        {confirmando ? t.enviando : t.confirmar}
      </BotaoPrincipal>

      <p className="text-[11px] text-ink-muted text-center">
        🚚 {t.entregaDom} {dataCurta(entrega, lang)}
      </p>
    </div>
  )
}

function Bloco({
  titulo, onEditar, rotuloEditar, children,
}: { titulo: string; onEditar: () => void; rotuloEditar: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
          {titulo}
        </h2>
        <button onClick={onEditar} className="text-[11.5px] text-brand-mid hover:underline">
          {rotuloEditar}
        </button>
      </header>
      <div className="text-[12.5px] text-ink-2 leading-snug mt-1">{children}</div>
    </section>
  )
}

function Linha({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex justify-between gap-3 text-[12.5px]">
      <span className="text-ink-2">
        {rotulo}
        {nota && <span className="text-ink-muted"> · {nota}</span>}
      </span>
      <span className="text-ink font-semibold tnum">{valor}</span>
    </div>
  )
}

// ------------------------------------------------------------- passo 6 · 6j
export function PassoConfirmado({
  t, lang, pedido, telefone,
}: {
  t: Textos; lang: Idioma
  pedido: { code: string; total_cents: number; entrega: string; first_name: string }
  telefone: string
}) {
  return (
    <div className="flex flex-col gap-4 items-center text-center py-6">
      <div className="w-14 h-14 rounded-full bg-ok-bg border-2 border-ok grid place-items-center
                      text-[26px] text-ok">
        ✓
      </div>
      <h1 className="text-[21px] font-bold text-brand">{t.confirmado}</h1>
      <p className="text-[13px] text-ink-2">
        {t.pedidoNum} <strong>#{pedido.code}</strong> ·{' '}
        <strong className="tnum">{money(pedido.total_cents)}</strong> ·{' '}
        {t.entregaDom} {dataCurta(pedido.entrega, lang)}
      </p>

      <div className="bg-surface border border-line rounded-xl px-4 py-3 text-left flex flex-col gap-2">
        <p className="text-[12.5px] text-ink-2">💬 {t.receberaWhats}</p>
        <p className="text-[12.5px] text-ink-2">📸 {t.envieComprovante}</p>
      </div>

      <a href={linkWhatsApp(telefone)} target="_blank" rel="noreferrer"
        className="bg-brand hover:bg-brand-hover text-cream rounded-xl px-6 py-3
                   text-[14px] font-semibold">
        {t.abrirWhats}
      </a>
    </div>
  )
}
