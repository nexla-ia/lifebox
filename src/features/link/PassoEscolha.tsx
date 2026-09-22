import { useMemo, useState } from 'react'
import { money } from '../../lib/supabase'
import type { AdicionalLink, CatalogoLink, PlanoLink, PratoLink } from './api'
import { descr, nome, rotulo, type Idioma, type Textos } from './i18n'
import { Aviso, BotaoPrincipal, Chip, Contador, Foto, Voltar } from './ui'

/* Passos 2, 3 e 4 do link (telas 6a, 6c, 6b, 6d, 6h).
 *
 * Quantidade aqui é CONTAGEM, não preço: a tela conta refeições para mostrar
 * o progresso e avisar que passou do plano, e o total continua vindo do
 * servidor (§2). O unitário da faixa que aparece no aviso de extra vem do
 * catálogo, não de conta feita aqui. */

export type Escolha = {
  /** `addons_only` saiu do link na reunião de 22/09/2026: Detox virou adicional
   *  dentro de um plano, não um tipo de pedido. A equipe ainda lança pelo
   *  sistema quando precisar. */
  kind: 'plan' | 'custom'
  plan_id: string | null
  size_id: string | null
}

/** chave `dishId:sizeId` — no Personalizado a mesma pessoa pede Small e Large
 *  do mesmo prato (tela 6c), então a quantidade é por par. */
export type MapaQtd = Record<string, number>

export const chave = (dish: string, size: string) => `${dish}:${size}`

export function itensDoPedido(pratos: MapaQtd, addons: MapaQtd) {
  const itens = []
  for (const [k, qty] of Object.entries(pratos)) {
    if (qty <= 0) continue
    const [dish_id, size_id] = k.split(':')
    itens.push({ type: 'dish' as const, dish_id, size_id, qty })
  }
  for (const [addon_id, qty] of Object.entries(addons)) {
    if (qty > 0) itens.push({ type: 'addon' as const, addon_id, qty })
  }
  return itens
}

// ------------------------------------------------------------- passo 2 · 6a
/** Tamanho ANTES do plano (reunião de 22/09/2026).
 *
 *  O preço do plano muda com o tamanho, então perguntar o plano primeiro
 *  obrigava a escolher no escuro e voltar. Com o tamanho definido, cada plano
 *  já mostra quanto custa PARA ESSA PESSOA.
 *
 *  "Só Detox / adicionais" saiu das opções de plano na mesma reunião: Detox
 *  virou adicional que entra dentro de um plano, não um tipo de pedido. */
export function PassoPlano({
  t, lang, catalogo, escolha, setEscolha, onAvancar, onVoltar,
}: {
  t: Textos; lang: Idioma; catalogo: CatalogoLink
  escolha: Escolha; setEscolha: (e: Escolha) => void
  onAvancar: () => void; onVoltar: () => void
}) {
  const precoDe = (p: PlanoLink, sizeId: string | null) =>
    p.prices.find((x) => x.size_id === sizeId)?.base_price_cents ?? null

  const temPersonalizado = catalogo.custom_prices.length > 0

  // §5.1 o tamanho vale para o plano inteiro; só oferecemos os que têm preço
  const tamanhos = catalogo.sizes.filter((s) =>
    escolha.kind === 'custom'
      ? catalogo.custom_prices.some((c) => c.size_id === s.id)
      : catalogo.plans.some((p) => p.prices.some((x) => x.size_id === s.id)))

  const podeAvancar =
    (escolha.kind === 'custom' && Boolean(escolha.size_id)) ||
    (escolha.kind === 'plan' && Boolean(escolha.plan_id) && Boolean(escolha.size_id) &&
      precoDe(catalogo.plans.find((p) => p.id === escolha.plan_id)!, escolha.size_id) !== null)

  return (
    <div className="flex flex-col gap-4">
      <Voltar onClick={onVoltar}>{t.voltar}</Voltar>
      <h1 className="text-[19px] font-bold text-brand">{t.p2Titulo}</h1>

      {tamanhos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-2">{t.tamanho}</span>
          <div className="flex gap-2 flex-wrap">
            {tamanhos.map((s) => (
              <button key={s.id} onClick={() => setEscolha({ ...escolha, size_id: s.id })}
                aria-pressed={escolha.size_id === s.id}
                className={`rounded-lg px-5 py-2.5 text-[13.5px] border ${
                  escolha.size_id === s.id
                    ? 'bg-brand border-brand text-cream font-semibold'
                    : 'bg-surface border-line-strong text-ink-2 hover:border-brand'}`}>
                {s.name}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ink-muted">{t.tamanhoNota}</span>
        </div>
      )}

      {/* os planos só aparecem depois do tamanho: sem ele o preço de cada um
          seria um chute, e a pessoa teria de voltar para conferir */}
      {escolha.size_id && (
        <div className="flex flex-col gap-2">
          {catalogo.plans.map((p) => {
            const sel = escolha.kind === 'plan' && escolha.plan_id === p.id
            const preco = precoDe(p, escolha.size_id)
            if (preco === null) return null
            return (
              <button key={p.id}
                onClick={() => setEscolha({ ...escolha, kind: 'plan', plan_id: p.id })}
                aria-pressed={sel}
                className={`text-left rounded-xl border px-4 py-3 flex items-center gap-3 ${
                  sel ? 'border-brand bg-leaf-bg' : 'border-line bg-surface hover:border-brand'}`}>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14.5px] font-bold text-ink">{nome(p, lang)}</span>
                    {sel && <span className="text-brand font-bold">✓</span>}
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {p.meals_qty > 0 && `${p.meals_qty} ${t.refeicoes}`}
                    {p.meals_qty > 0 && p.breakfasts_qty > 0 && ' + '}
                    {p.breakfasts_qty > 0 && `${p.breakfasts_qty} ${t.breakfasts}`}
                    {' '}{t.aEscolher}
                  </div>
                </div>
                <span className="text-[14px] font-bold text-brand-mid tnum whitespace-nowrap">
                  {money(preco)}
                </span>
              </button>
            )
          })}

          {temPersonalizado && (
            <button onClick={() => setEscolha({ ...escolha, kind: 'custom', plan_id: null })}
              aria-pressed={escolha.kind === 'custom'}
              className={`text-left rounded-xl border px-4 py-3 ${
                escolha.kind === 'custom'
                  ? 'border-brand bg-leaf-bg' : 'border-line bg-surface hover:border-brand'}`}>
              <div className="text-[14.5px] font-bold text-ink">✎ {t.personalizado}</div>
              <div className="text-[12px] text-ink-3">{t.personalizadoAjuda}</div>
            </button>
          )}
        </div>
      )}

      {escolha.kind === 'custom' && <Aviso tom="info">✎ {t.personalizadoNota}</Aviso>}

      <BotaoPrincipal onClick={onAvancar} disabled={!podeAvancar}>
        {t.escolherPratos}
      </BotaoPrincipal>
    </div>
  )
}

// ------------------------------------------------------ passo 3 · 6b, 6c, 6d
export function PassoPratos({
  t, lang, catalogo, escolha, pratos, setPratos, onAvancar, onVoltar,
}: {
  t: Textos; lang: Idioma; catalogo: CatalogoLink; escolha: Escolha
  pratos: MapaQtd; setPratos: (m: MapaQtd) => void
  onAvancar: () => void; onVoltar: () => void
}) {
  const [filtro, setFiltro] = useState<string>('')
  const [avisoExtra, setAvisoExtra] = useState<{ dish: string; size: string } | null>(null)

  const plano = catalogo.plans.find((p) => p.id === escolha.plan_id) ?? null
  const custom = escolha.kind === 'custom'

  const tags = useMemo(() => {
    const m = new Map<string, { code: string; label_pt: string; label_en: string; icon: string | null }>()
    for (const d of catalogo.dishes) for (const tg of d.tags) m.set(tg.code, tg)
    return [...m.values()]
  }, [catalogo.dishes])


  /** Breakfast só aparece para plano que tem breakfast (reunião de
   *  22/09/2026): oferecer o que não entra no plano é convidar a escolher
   *  errado e descobrir na revisão, quando vira extra. No Personalizado tudo
   *  aparece, porque ali cada item é cobrado por unidade. */
  const doPlano = custom || (plano?.breakfasts_qty ?? 0) > 0
    ? catalogo.dishes
    : catalogo.dishes.filter((d) => d.category !== 'breakfast')

  const visiveis = filtro
    ? doPlano.filter((d) => d.tags.some((tg) => tg.code === filtro))
    : doPlano

  // contagem só para o progresso e para o aviso de extra — preço é do servidor
  const conta = (bkf: boolean) =>
    Object.entries(pratos).reduce((s, [k, q]) => {
      const d = catalogo.dishes.find((x) => x.id === k.split(':')[0])
      if (!d) return s
      return (d.category === 'breakfast') === bkf ? s + q : s
    }, 0)
  const refeicoes = conta(false)
  const breakfasts = conta(true)

  const unitExtra = (bkf: boolean, sizeId: string | null) =>
    plano?.extras.find(
      (e) => e.size_id === sizeId && e.item_kind === (bkf ? 'breakfast' : 'meal'),
    )?.unit_price_cents ?? null

  const unitCustom = (sizeId: string) =>
    catalogo.custom_prices.find((c) => c.size_id === sizeId)?.unit_price_cents ?? null

  /** No plano, passar do limite não é erro: é extra, e o cliente decide de
   *  olho no valor (tela 6d). Sem o aviso a conta só apareceria na revisão. */
  function somar(d: PratoLink, sizeId: string, alvo: number) {
    const k = chave(d.id, sizeId)
    const atual = pratos[k] ?? 0
    const bkf = d.category === 'breakfast'
    const limite = bkf ? (plano?.breakfasts_qty ?? 0) : (plano?.meals_qty ?? 0)
    const total = bkf ? breakfasts : refeicoes

    if (!custom && plano && alvo > atual && total >= limite) {
      setAvisoExtra({ dish: d.id, size: sizeId })
      return
    }
    setPratos({ ...pratos, [k]: alvo })
  }

  const tamanhosCustom = catalogo.sizes.filter((s) =>
    catalogo.custom_prices.some((c) => c.size_id === s.id))

  const totalEscolhido = Object.values(pratos).reduce((a, b) => a + b, 0)
  const podeAvancar = custom ? totalEscolhido > 0 : refeicoes + breakfasts > 0

  return (
    <div className="flex flex-col gap-4">
      <Voltar onClick={onVoltar}>{t.voltar}</Voltar>

      {plano && (
        <h1 className="text-[17px] font-bold text-brand">
          {nome(plano, lang)}
          {escolha.size_id && ` · ${catalogo.sizes.find((s) => s.id === escolha.size_id)?.name}`}
        </h1>
      )}
      {custom && <h1 className="text-[17px] font-bold text-brand">✎ {t.personalizado}</h1>}

      {plano && refeicoes >= plano.meals_qty && plano.meals_qty > 0 && (
        <Aviso tom="ok">✅ {t.limiteAtingido}</Aviso>
      )}

      {tags.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltro('')} aria-pressed={filtro === ''}
            className={`rounded-full px-3 py-1 text-[12px] border ${
              filtro === '' ? 'bg-brand border-brand text-cream' : 'bg-surface border-line text-ink-2'}`}>
            {t.todos}
          </button>
          {tags.map((tg) => (
            <button key={tg.code} onClick={() => setFiltro(tg.code)} aria-pressed={filtro === tg.code}
              className={`rounded-full px-3 py-1 text-[12px] border ${
                filtro === tg.code ? 'bg-brand border-brand text-cream' : 'bg-surface border-line text-ink-2'}`}>
              {tg.icon} {rotulo(tg, lang)}
            </button>
          ))}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visiveis.map((d) => (
          <article key={d.id} className="bg-surface border border-line rounded-xl p-3 flex flex-col gap-2">
            <Foto src={d.photo} alt={nome(d, lang)} />
            <div>
              <h2 className="text-[13.5px] font-bold text-ink leading-tight">{nome(d, lang)}</h2>
              {descr(d, lang) && (
                <p className="text-[11.5px] text-ink-3 leading-snug mt-0.5">{descr(d, lang)}</p>
              )}
            </div>

            {d.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {d.tags.map((tg) => <Chip key={tg.code}>{tg.icon} {rotulo(tg, lang)}</Chip>)}
              </div>
            )}

            {d.calories !== null && (
              <div className="flex gap-2.5 text-[10.5px] text-ink-3 tnum">
                <span>Cal <strong>{d.calories}</strong></span>
                {d.protein_g !== null && <span>Prot <strong>{d.protein_g}g</strong></span>}
                {d.carbs_g !== null && <span>Carbs <strong>{d.carbs_g}g</strong></span>}
                {d.fat_g !== null && <span>Fat <strong>{d.fat_g}g</strong></span>}
              </div>
            )}

            {d.allergens.length > 0 && (
              <div className="text-[10.5px] text-ink-muted">
                {t.contains} {d.allergens.map((a) => `${a.icon ?? ''} ${rotulo(a, lang)}`).join(', ')}
              </div>
            )}

            <div className="mt-auto pt-1">
              {custom ? (
                <div className="flex flex-col gap-1.5">
                  {tamanhosCustom.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-ink-2">
                        {s.name}
                        <span className="text-ink-muted tnum">
                          {' '}{money(unitCustom(s.id) ?? 0)}/un
                        </span>
                      </span>
                      <Contador qty={pratos[chave(d.id, s.id)] ?? 0}
                        rotulo={`${nome(d, lang)} ${s.name}`}
                        onMudar={(n) => setPratos({ ...pratos, [chave(d.id, s.id)]: n })} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex justify-end">
                  <Contador qty={pratos[chave(d.id, escolha.size_id ?? '')] ?? 0}
                    rotulo={nome(d, lang)}
                    onMudar={(n) => somar(d, escolha.size_id ?? '', n)} />
                </div>
              )}
            </div>

            {avisoExtra?.dish === d.id && plano && (
              <Aviso tom="warn">
                ⏰ {t.extraAviso}{' '}
                <strong className="tnum">
                  {money(unitExtra(d.category === 'breakfast', escolha.size_id) ?? 0)}
                </strong>{' '}
                ({t.extraUnitario}).
                <div className="flex gap-2 mt-2">
                  <button onClick={() => {
                    const k = chave(d.id, escolha.size_id ?? '')
                    setPratos({ ...pratos, [k]: (pratos[k] ?? 0) + 1 })
                    setAvisoExtra(null)
                  }} className="bg-brand text-cream rounded-lg px-3 py-1.5 text-[11.5px] font-semibold">
                    {t.adicionarExtra}
                  </button>
                  <button onClick={() => setAvisoExtra(null)}
                    className="text-[11.5px] text-ink-3 px-2">
                    {t.manter} {d.category === 'breakfast' ? breakfasts : refeicoes}
                  </button>
                </div>
              </Aviso>
            )}
          </article>
        ))}
      </div>

      <div className="sticky bottom-0 bg-cream/95 backdrop-blur pt-3 pb-4 flex flex-col gap-2">
        {plano && (
          <div className="flex gap-4 text-[12.5px] font-semibold text-ink-2">
            {plano.meals_qty > 0 && (
              <span aria-label={t.refeicoes}>
                {refeicoes} {t.de} {plano.meals_qty} {t.refeicoes}
              </span>
            )}
            {plano.breakfasts_qty > 0 && (
              <span aria-label={t.breakfasts}>
                {breakfasts} {t.de} {plano.breakfasts_qty} {t.breakfasts}
              </span>
            )}
          </div>
        )}
        {!custom && <p className="text-[11px] text-ink-muted">{t.semPreco}</p>}
        <BotaoPrincipal onClick={onAvancar} disabled={!podeAvancar}>
          {t.verAdicionais}
        </BotaoPrincipal>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- passo 4 · 6h
export function PassoAdicionais({
  t, lang, catalogo, escolha, addons, setAddons, onAvancar, onVoltar,
}: {
  t: Textos; lang: Idioma; catalogo: CatalogoLink; escolha: Escolha
  addons: MapaQtd; setAddons: (m: MapaQtd) => void
  onAvancar: () => void; onVoltar: () => void
}) {
  // §5.4: o que exige plano some do fluxo "Só Detox / adicionais" — e o
  // servidor recusaria de qualquer jeito, então some antes de frustrar
  const visiveis: AdicionalLink[] = catalogo.addons.filter(
    (a) => !a.requires_plan || escolha.kind === 'plan')

  return (
    <div className="flex flex-col gap-4">
      <Voltar onClick={onVoltar}>{t.voltar}</Voltar>
      <h1 className="text-[19px] font-bold text-brand">{t.adicionais}</h1>
      <p className="text-[12px] text-ink-3">{t.adicionaisAjuda}</p>

      {visiveis.length === 0 ? (
        <Aviso tom="info">—</Aviso>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {visiveis.map((a) => (
            <article key={a.id} className="bg-surface border border-line rounded-xl p-3 flex gap-3">
              <div className="w-20 shrink-0"><Foto src={a.photo} alt={nome(a, lang)} /></div>
              <div className="flex-1 flex flex-col gap-1">
                <h2 className="text-[13.5px] font-bold text-ink leading-tight">{nome(a, lang)}</h2>
                {descr(a, lang) && (
                  <p className="text-[11.5px] text-ink-3 leading-snug">{descr(a, lang)}</p>
                )}
                <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                  <span className="text-[13px] font-bold text-brand-mid tnum">
                    {money(a.price_cents)}
                  </span>
                  <Contador qty={addons[a.id] ?? 0} rotulo={nome(a, lang)}
                    onMudar={(n) => setAddons({ ...addons, [a.id]: n })} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="text-[11px] text-ink-muted">{t.semTax}</p>
      <BotaoPrincipal onClick={onAvancar}>{t.revisar}</BotaoPrincipal>
    </div>
  )
}
