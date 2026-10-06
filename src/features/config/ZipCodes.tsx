import { useEffect, useMemo, useState } from 'react'
import { apenasDecimal } from '../../lib/numero'
import { parseMoney } from '../../lib/precos'
import { money } from '../../lib/supabase'
import { useQuery } from '../../lib/useQuery'
import { consultarZip, normalizarZip, zipsDaCidade, type LocalZip } from '../../lib/zip'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import {
  alternarZip, fetchZipsERotas, removerZip, salvarMinimoCidade, salvarMinimoZip,
  salvarZips, type Rota, type ZipRow,
} from './api'

/* Configurações · ZIP codes atendidos. Ref: protótipo 9d.
 *
 * O ZIP decide se o link público deixa fechar o pedido (§6.1), então esta lista
 * é regra de negócio: quem responde "entregamos aí?" é SEMPRE a tabela, nunca
 * uma API de fora. A consulta externa entra só para poupar digitação —
 * a equipe sabe as cidades, não os 84 CEPs.
 *
 * A rota continua editável por ZIP: ela não é estritamente geográfica
 * (Ashland é atendida pela South Shore). */

export function ZipCodes({ podeEditar }: { podeEditar: boolean }) {
  const { data, loading, error, reload } = useQuery(fetchZipsERotas, [])
  const [busca, setBusca] = useState('')

  if (loading) return <Loading shape="rows" label="Carregando ZIPs…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const zips = data?.zips ?? []
  const rotas = data?.rotas ?? []
  const filtro = busca.trim().toLowerCase()
  const visiveis = filtro
    ? zips.filter((z) => z.zip.includes(filtro) || z.city.toLowerCase().includes(filtro))
    : zips

  const nomeRota = (id: string) => rotas.find((r) => r.id === id)?.name ?? '—'

  return (
    <div className="flex flex-col gap-4">
      {podeEditar && <ImportarPorCidade rotas={rotas} jaCadastrados={zips.map((z) => z.zip)} onPronto={reload} />}
      {podeEditar && <AdicionarUm rotas={rotas} onPronto={reload} />}

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        <header className="px-4 py-3 border-b border-line bg-surface-alt flex items-center gap-3 flex-wrap">
          <h2 className="text-[13.5px] font-bold text-brand">
            ZIP codes atendidos · {zips.length}
          </h2>
          <div className="flex-1" />
          <input
            aria-label="Buscar ZIP ou cidade"
            placeholder="Buscar ZIP ou cidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="border border-line-strong rounded-lg px-3 py-1.5 text-[12.5px] bg-surface outline-none focus:border-brand w-56"
          />
        </header>

        {zips.length === 0 ? (
          <EmptyState
            icon="📍"
            title="Nenhum ZIP cadastrado"
            body="Enquanto a lista estiver vazia, o link público recusa todo pedido por estar fora da área. Importe pelas cidades que vocês atendem — é mais rápido do que digitar CEP por CEP."
          />
        ) : visiveis.length === 0 ? (
          <EmptyState icon="🔍" title={`Nenhum ZIP para "${busca}"`} />
        ) : (
          <ul className="divide-y divide-line-soft max-h-[420px] overflow-y-auto">
            {visiveis.map((z) => (
              <li key={z.zip} className={`flex items-center gap-3 px-4 py-2 ${z.active ? '' : 'opacity-50'}`}>
                <strong className="tnum text-[12.5px] text-ink w-14">{z.zip}</strong>
                <span className="flex-1 min-w-0 text-[12.5px] text-ink-2 truncate">
                  {z.city}, {z.state}
                </span>
                <span className="bg-muted-bg border border-line text-ink-3 rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                  {nomeRota(z.route_id)}
                </span>
                <Minimo zip={z} podeEditar={podeEditar} onSalvou={reload} />
                {podeEditar && (
                  <>
                    <button
                      onClick={async () => { await alternarZip(z.zip, !z.active); reload() }}
                      className="text-[11.5px] text-ink-3 hover:text-ink"
                    >
                      {z.active ? 'Desativar' : 'Reativar'}
                    </button>
                    <button
                      onClick={async () => { await removerZip(z.zip); reload() }}
                      className="text-danger text-[13px] leading-none"
                      aria-label={`Remover ${z.zip}`}
                      title="Remover"
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** O caminho principal: a equipe digita a cidade, o sistema traz os ZIPs. */
function ImportarPorCidade({
  rotas, jaCadastrados, onPronto,
}: { rotas: Rota[]; jaCadastrados: string[]; onPronto: () => void }) {
  const [cidade, setCidade] = useState('')
  const [rotaId, setRotaId] = useState('')
  const [previa, setPrevia] = useState<LocalZip[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [minimo, setMinimo] = useState('')

  const rota = rotaId || rotas[0]?.id || ''
  const novos = useMemo(
    () => (previa ?? []).filter((p) => !jaCadastrados.includes(p.zip)),
    [previa, jaCadastrados],
  )

  async function buscar() {
    setMsg(null)
    setPrevia(null)
    setBuscando(true)
    const r = await zipsDaCidade(cidade)
    setBuscando(false)
    if (!r) {
      setMsg(`Não encontramos "${cidade}" em Massachusetts. Confira a grafia ou adicione o ZIP direto abaixo.`)
      return
    }
    setPrevia(r)
  }

  async function importar() {
    if (!rota) return
    setSalvando(true)
    const { error } = await salvarZips(
      (previa ?? []).map((p) => ({ zip: p.zip, city: p.city, state: p.state, route_id: rota })),
    )
    if (error) { setSalvando(false); setMsg(error.message); return }

    // O mínimo vem JUNTO com a importação, não depois: a decisão "esta cidade
    // é longe" é tomada na hora de incluí-la, e marcar ZIP a ZIP depois são
    // cinco cliques para uma decisão só — bastaria esquecer um para a regra
    // ter buraco.
    const cents = minimo.trim() === '' ? null : parseMoney(minimo)
    if (minimo.trim() !== '' && (cents === null || cents <= 0)) {
      setSalvando(false)
      setMsg('O pedido mínimo precisa ser maior que zero — deixe em branco para não ter mínimo.')
      return
    }
    if (cents !== null) {
      const r = await salvarMinimoCidade(previa?.[0]?.city ?? cidade, cents)
      if (r.error) { setSalvando(false); setMsg(r.error.message); return }
    }
    setSalvando(false)
    setMsg(`${previa?.length} ZIPs de ${previa?.[0]?.city} importados${
      cents !== null ? `, com pedido mínimo de ${money(cents)}` : ''}.`)
    setMinimo('')
    setPrevia(null)
    setCidade('')
    onPronto()
  }

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-line bg-surface-alt">
        <h2 className="text-[13.5px] font-bold text-brand">Importar por cidade</h2>
        <p className="text-[11.5px] text-ink-muted mt-0.5">
          Digite a cidade e o sistema traz todos os ZIPs dela. Framingham, por exemplo,
          tem 5. Depois dá para trocar a rota de qualquer ZIP individualmente.
        </p>
      </header>

      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="flex gap-2 flex-wrap items-end">
          <label className="flex-1 min-w-48">
            <span className="text-[11px] font-semibold text-ink-2">Cidade (Massachusetts)</span>
            <input
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
              placeholder="Framingham"
              className="w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand"
            />
          </label>
          <label>
            <span className="text-[11px] font-semibold text-ink-2">Pedido mínimo</span>
            <input
              aria-label="Pedido mínimo da cidade"
              value={minimo}
              inputMode="decimal"
              onChange={(e) => setMinimo(apenasDecimal(e.target.value))}
              placeholder="sem mínimo"
              title="Em branco = esta cidade não tem pedido mínimo"
              className="w-28 border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand tnum block"
            />
          </label>
          <label>
            <span className="text-[11px] font-semibold text-ink-2">Rota</span>
            <select
              value={rota}
              onChange={(e) => setRotaId(e.target.value)}
              className="block border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand"
            >
              {rotas.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button
            onClick={buscar}
            disabled={buscando || !cidade.trim()}
            className="bg-surface border border-line-strong hover:border-brand disabled:opacity-50 text-ink-2 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            {buscando ? 'Buscando…' : 'Buscar ZIPs'}
          </button>
        </div>

        {previa && (
          <div className="bg-leaf-bg border border-leaf-line rounded-lg px-3 py-2.5">
            <div className="text-[12.5px] text-leaf font-semibold">
              {previa.length} ZIPs em {previa[0]?.city}
              {novos.length !== previa.length && ` · ${previa.length - novos.length} já cadastrados`}
            </div>
            <div className="flex gap-1.5 flex-wrap mt-2">
              {previa.map((p) => (
                <span
                  key={p.zip}
                  className={`tnum rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                    jaCadastrados.includes(p.zip)
                      ? 'bg-muted-bg border-line text-ink-muted'
                      : 'bg-surface border-leaf-line text-leaf'
                  }`}
                >
                  {p.zip}
                </span>
              ))}
            </div>
            <button
              onClick={importar}
              disabled={salvando}
              className="mt-3 bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold"
            >
              {salvando ? 'Importando…' : `Importar para ${rotas.find((r) => r.id === rota)?.name}`}
            </button>
          </div>
        )}

        {msg && (
          <div className="bg-warn-bg border border-warn-line text-warn rounded-lg px-3 py-2 text-[12.5px]">
            {msg}
          </div>
        )}
      </div>
    </section>
  )
}

/** Escape hatch: um ZIP avulso que a busca por cidade não pegou. */
function AdicionarUm({ rotas, onPronto }: { rotas: Rota[]; onPronto: () => void }) {
  const [zip, setZip] = useState('')
  const [cidade, setCidade] = useState('')
  const [rotaId, setRotaId] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const rota = rotaId || rotas[0]?.id || ''

  async function aoSairDoZip() {
    const n = normalizarZip(zip)
    if (!n) return
    setZip(n)
    if (cidade.trim()) return
    const r = await consultarZip(n)
    // falhou? não é erro: a pessoa digita a cidade
    if (r) setCidade(r.city)
  }

  async function adicionar() {
    setErro(null)
    const n = normalizarZip(zip)
    if (!n) { setErro('ZIP precisa ter 5 dígitos.'); return }
    if (!cidade.trim()) { setErro('Informe a cidade.'); return }
    const { error } = await salvarZips([
      { zip: n, city: cidade.trim(), state: 'MA', route_id: rota },
    ])
    if (error) { setErro(error.message); return }
    setZip(''); setCidade(''); onPronto()
  }

  const campo = 'border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand'

  return (
    <section className="bg-surface border border-line rounded-xl px-4 py-3">
      <h2 className="text-[13.5px] font-bold text-brand mb-0.5">Adicionar um ZIP</h2>
      <p className="text-[11.5px] text-ink-muted mb-3">
        A cidade preenche sozinha ao sair do campo. Se a consulta não responder,
        digite à mão — nada trava.
      </p>
      <div className="flex gap-2 flex-wrap items-end">
        <label>
          <span className="text-[11px] font-semibold text-ink-2">ZIP</span>
          <input
            aria-label="ZIP"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            onBlur={aoSairDoZip}
            placeholder="01702"
            className={`${campo} w-28 tnum block`}
          />
        </label>
        <label className="flex-1 min-w-40">
          <span className="text-[11px] font-semibold text-ink-2">Cidade</span>
          <input
            aria-label="Cidade"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            className={`${campo} w-full block`}
          />
        </label>
        <label>
          <span className="text-[11px] font-semibold text-ink-2">Rota</span>
          <select value={rota} onChange={(e) => setRotaId(e.target.value)} className={`${campo} block`}>
            {rotas.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button
          onClick={adicionar}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold"
        >
          Adicionar
        </button>
      </div>
      {erro && (
        <div className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2 text-[12.5px] mt-3">
          {erro}
        </div>
      )}
    </section>
  )
}

/** Pedido mínimo deste ZIP (reunião de 22/09/2026).
 *
 *  "Alguns lugares são muito longe": nem toda parada compensa a viagem. Em
 *  branco = sem mínimo, e é diferente de zero — zero se leria como regra já
 *  decidida, e aí ninguém sabe se o ZIP foi analisado ou esquecido.
 *
 *  Salva no blur e mostra o estado enquanto grava: numa lista de 55 ZIPs, sair
 *  do campo sem retorno nenhum deixa a pessoa sem saber se pegou. */
function Minimo({ zip, podeEditar, onSalvou }: {
  zip: ZipRow; podeEditar: boolean; onSalvou: () => void
}) {
  const atual = zip.min_order_cents
  const [texto, setTexto] = useState(atual == null ? '' : (atual / 100).toFixed(2))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // o efeito depende do ZIP ABERTO, não do valor salvo: keyar pelo valor faria
  // o efeito zerar o que a pessoa acabou de digitar
  useEffect(() => {
    setTexto(zip.min_order_cents == null ? '' : (zip.min_order_cents / 100).toFixed(2))
  }, [zip.zip, zip.min_order_cents])

  if (!podeEditar) {
    return (
      <span className="text-[11.5px] tnum w-20 text-right text-ink-3">
        {atual == null ? '—' : money(atual)}
      </span>
    )
  }

  async function salvar() {
    const limpo = texto.trim()
    // parseMoney já devolve CENTAVOS e devolve null no que não é número
    const cents = limpo === '' ? null : parseMoney(limpo)
    if (limpo !== '' && (cents === null || cents <= 0)) {
      setErro('maior que zero, ou vazio')
      return
    }
    if (cents === atual) return
    setSalvando(true)
    setErro(null)
    const { error } = await salvarMinimoZip(zip.zip, cents)
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSalvou()
  }

  return (
    <span className="flex items-center gap-1">
      <span className="text-[11px] text-ink-muted">mín. $</span>
      <input
        aria-label={`Pedido mínimo em ${zip.zip}`}
        value={texto}
        disabled={salvando}
        inputMode="decimal"
        placeholder="—"
        onChange={(e) => setTexto(apenasDecimal(e.target.value))}
        onBlur={salvar}
        onKeyDown={(e) => { if (e.key === 'Enter') void salvar() }}
        title={erro ?? 'em branco = sem mínimo'}
        className={`w-16 text-right tnum text-[12px] border rounded-md px-1.5 py-0.5 outline-none ${
          erro ? 'border-danger text-danger'
            : salvando ? 'border-brand bg-leaf-bg'
            : 'border-line-strong bg-surface-alt focus:border-brand'}`}
      />
    </span>
  )
}
