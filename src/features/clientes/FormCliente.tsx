import { useEffect, useState } from 'react'
import { consultarZip, normalizarZip } from '../../lib/zip'
import { formatarTelefone, normalizarTelefone } from '../../lib/telefone'
import {
  conferirZip, salvarCliente,
  type Cliente, type DadosClientes, type Fulfillment, type StatusCliente,
} from './api'

/* Cadastro de cliente. Ref: protótipo 4d e 11d.
 *
 * Ao sair do campo de ZIP acontecem DUAS coisas, nessa ordem:
 *   1. a tabela zip_codes diz se atendemos e qual rota sugerir (§6.1)
 *   2. se o ZIP não está na tabela, a consulta externa preenche a cidade
 *      só para o cadastro ficar completo
 *
 * ZIP fora da área NÃO impede cadastrar aqui: a pessoa pode ser um lead de
 * região nova. Quem bloqueia o pedido é o link público (§6.1, tela 6f). */

type Props = {
  dados: DadosClientes
  cliente: Cliente | null
  nomeInicial?: string
  onCancelar: () => void
  onSalvo: (id: string) => void
}

type Area =
  | { estado: 'vazio' }
  | { estado: 'checando' }
  | { estado: 'atendido'; cidade: string; rotaId: string }
  | { estado: 'fora'; cidade: string | null }

export function FormCliente({ dados, cliente, nomeInicial, onCancelar, onSalvo }: Props) {
  const [nome, setNome] = useState(cliente?.first_name ?? nomeInicial ?? '')
  const [sobrenome, setSobrenome] = useState(cliente?.last_name ?? '')
  const [telefone, setTelefone] = useState(
    cliente ? formatarTelefone(cliente.phone_e164) : '',
  )
  const [email, setEmail] = useState(cliente?.email ?? '')
  const [zip, setZip] = useState(cliente?.zip_code ?? '')
  const [endereco, setEndereco] = useState(cliente?.street_address ?? '')
  const [cidade, setCidade] = useState(cliente?.city ?? '')
  const [rotaId, setRotaId] = useState(cliente?.route_id ?? '')
  const [origemId, setOrigemId] = useState(cliente?.source_id ?? '')
  const [status, setStatus] = useState<StatusCliente>(cliente?.status ?? 'lead')
  const [fulfillment, setFulfillment] = useState<Fulfillment>(
    cliente?.fulfillment_preference ?? 'delivery',
  )
  const [planoId, setPlanoId] = useState(cliente?.default_plan_id ?? '')
  const [tamanhoId, setTamanhoId] = useState(cliente?.default_size_id ?? '')
  const [notasEntrega, setNotasEntrega] = useState(cliente?.delivery_notes ?? '')
  const [notasCozinha, setNotasCozinha] = useState(cliente?.kitchen_notes ?? '')
  const [notasInternas, setNotasInternas] = useState(cliente?.office_notes ?? '')

  const [area, setArea] = useState<Area>({ estado: 'vazio' })
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // ZIP já cadastrado: confere a área na abertura, para editar mostrar o estado
  useEffect(() => {
    if (cliente?.zip_code) void checarZip(cliente.zip_code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checarZip(bruto: string) {
    const n = normalizarZip(bruto)
    if (!n) { setArea({ estado: 'vazio' }); return }
    setZip(n)
    setArea({ estado: 'checando' })

    const nossa = await conferirZip(n)
    if (nossa.atendido && nossa.linha) {
      setArea({ estado: 'atendido', cidade: nossa.linha.city, rotaId: nossa.linha.route_id })
      if (!cidade.trim()) setCidade(nossa.linha.city)
      if (!rotaId) setRotaId(nossa.linha.route_id)   // sugestão, segue editável
      return
    }

    // fora da nossa lista: a consulta externa ainda preenche a cidade
    const externo = await consultarZip(n)
    setArea({ estado: 'fora', cidade: externo?.city ?? null })
    if (externo && !cidade.trim()) setCidade(externo.city)
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    if (!nome.trim()) { setErro('Nome é obrigatório.'); return }
    const fone = normalizarTelefone(telefone)
    if (!fone) {
      setErro(
        `Telefone inválido: "${telefone}". Use 10 dígitos com DDD — é o número que cruza com o WhatsApp.`,
      )
      return
    }

    setSalvando(true)
    const { data, error } = await salvarCliente({
      ...(cliente?.id ? { id: cliente.id } : { lead_type: 'new' }),
      first_name: nome.trim(),
      last_name: sobrenome.trim() || null,
      phone_e164: fone,
      email: email.trim() || null,
      street_address: endereco.trim() || null,
      city: cidade.trim() || null,
      state: 'MA',
      zip_code: normalizarZip(zip),
      route_id: rotaId || null,
      source_id: origemId || null,
      status,
      fulfillment_preference: fulfillment,
      default_plan_id: planoId || null,
      default_size_id: tamanhoId || null,
      delivery_notes: notasEntrega.trim() || null,
      kitchen_notes: notasCozinha.trim() || null,
      office_notes: notasInternas.trim() || null,
    })
    setSalvando(false)

    if (error) {
      setErro(
        error.code === '23505'
          ? `Já existe cliente com o telefone ${formatarTelefone(fone)}. Um cliente, muitos pedidos — não duplique o cadastro.`
          : error.message,
      )
      return
    }
    onSalvo((data as { id: string }).id)
  }

  const campo = 'w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand'
  const rot = 'text-[11px] font-semibold text-ink-2'

  return (
    <form onSubmit={submeter} className="bg-surface border border-line rounded-xl p-5 flex flex-col gap-4">
      <h2 className="text-[15px] font-bold text-brand">
        {cliente ? `Editando ${cliente.first_name}` : 'Novo cliente'}
      </h2>

      <div className="grid md:grid-cols-2 gap-3">
        <label><span className={rot}>Nome *</span>
          <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label><span className={rot}>Sobrenome</span>
          <input className={campo} value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} /></label>

        <label>
          <span className={rot}>Telefone / WhatsApp *</span>
          <input
            className={campo}
            value={telefone}
            placeholder="(508) 555-0164"
            onChange={(e) => setTelefone(e.target.value)}
            onBlur={() => {
              const n = normalizarTelefone(telefone)
              if (n) setTelefone(formatarTelefone(n))
            }}
          />
          <span className="text-[10.5px] text-ink-muted">
            É por ele que o sistema acha a conversa no WhatsApp.
          </span>
        </label>

        <label><span className={rot}>E-mail</span>
          <input className={campo} type="email" value={email}
                 onChange={(e) => setEmail(e.target.value)} placeholder="opcional" /></label>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <label>
          <span className={rot}>ZIP Code</span>
          <input
            aria-label="ZIP Code"
            className={`${campo} tnum`}
            value={zip}
            placeholder="01702"
            onChange={(e) => setZip(e.target.value)}
            onBlur={() => void checarZip(zip)}
          />
        </label>
        <label className="md:col-span-2"><span className={rot}>Endereço</span>
          <input className={campo} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></label>
        <label><span className={rot}>Cidade</span>
          <input aria-label="Cidade" className={campo} value={cidade}
                 onChange={(e) => setCidade(e.target.value)} /></label>
      </div>

      <AvisoArea area={area} rotas={dados.rotas} />

      <div className="grid md:grid-cols-4 gap-3">
        <label>
          <span className={rot}>Rota <span className="font-normal text-ink-muted">· editável</span></span>
          <select className={campo} value={rotaId} onChange={(e) => setRotaId(e.target.value)}>
            <option value="">—</option>
            {dados.rotas.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label><span className={rot}>Origem</span>
          <select className={campo} value={origemId} onChange={(e) => setOrigemId(e.target.value)}>
            <option value="">—</option>
            {dados.origens.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
        <label><span className={rot}>Status</span>
          <select className={campo} value={status}
                  onChange={(e) => setStatus(e.target.value as StatusCliente)}>
            <option value="lead">Lead</option>
            <option value="ativo">Ativo</option>
            <option value="pausado">Pausado</option>
            <option value="cancelado">Cancelado</option>
          </select></label>
        <div>
          <span className={rot}>Recebimento</span>
          <div className="flex gap-1.5 mt-1">
            {([['delivery', '🚚 Entrega'], ['pickup', '🏠 Pick-up']] as const).map(([v, r]) => (
              <button key={v} type="button" onClick={() => setFulfillment(v)}
                className={`flex-1 rounded-lg py-2 text-[11.5px] border ${
                  fulfillment === v ? 'bg-leaf-bg border-brand text-brand font-semibold'
                                    : 'bg-surface border-line-strong text-ink-2'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 items-end">
        <label><span className={rot}>Plano padrão <span className="font-normal text-ink-muted">· puxa na renovação</span></span>
          <select className={campo} value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
            <option value="">—</option>
            {dados.planos.map((p) => <option key={p.id} value={p.id}>{p.name_pt}</option>)}
          </select></label>
        <label><span className={rot}>Tamanho padrão</span>
          <select className={campo} value={tamanhoId} onChange={(e) => setTamanhoId(e.target.value)}>
            <option value="">—</option>
            {dados.tamanhos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
      </div>

      <label>
        <span className={rot}>🚚 Instruções de entrega</span>
        <input className={campo} value={notasEntrega}
               onChange={(e) => setNotasEntrega(e.target.value)}
               placeholder="Ex.: deixar na porta lateral" />
      </label>

      {/* §6.8: vai direto para o topo da folha da cozinha, por isso o destaque */}
      <label className="block">
        <span className="text-[11px] font-bold text-warn">
          🔪 Kitchen Notes <span className="font-normal text-ink-muted">· restrições e alergias, vão para a cozinha</span>
        </span>
        <input
          aria-label="Kitchen Notes"
          className="w-full border-2 border-warn-line rounded-lg px-3 py-2 text-[13px] bg-warn-bg/30 outline-none focus:border-warn"
          value={notasCozinha}
          onChange={(e) => setNotasCozinha(e.target.value)}
          placeholder="Ex.: sem cebola em nenhum prato"
        />
      </label>

      <label>
        <span className={rot}>🗒️ Observações internas</span>
        <input className={campo} value={notasInternas}
               onChange={(e) => setNotasInternas(e.target.value)} />
      </label>

      {erro && (
        <div role="alert" className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2 text-[12.5px]">
          {erro}
        </div>
      )}

      <div className="flex justify-end gap-3 items-center">
        <button type="button" onClick={onCancelar} className="text-[12.5px] text-ink-3 hover:text-ink">
          Cancelar
        </button>
        <button type="submit" disabled={salvando}
          className="bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-lg px-5 py-2 text-[12.5px] font-semibold">
          {salvando ? 'Salvando…' : 'Salvar cadastro'}
        </button>
      </div>
    </form>
  )
}

function AvisoArea({ area, rotas }: { area: Area; rotas: DadosClientes['rotas'] }) {
  if (area.estado === 'vazio') return null
  if (area.estado === 'checando') {
    return <p className="text-[12px] text-ink-muted">Conferindo o ZIP…</p>
  }
  if (area.estado === 'atendido') {
    return (
      <div className="bg-ok-bg border border-ok-line text-ok rounded-lg px-3 py-2 text-[12.5px]">
        ✅ <strong>Delivery Available</strong> · {area.cidade} · rota{' '}
        {rotas.find((r) => r.id === area.rotaId)?.name ?? '—'} sugerida
      </div>
    )
  }
  return (
    <div className="bg-warn-bg border border-warn-line text-warn rounded-lg px-3 py-2 text-[12.5px] leading-relaxed">
      ❌ <strong>Fora da área de entrega.</strong>
      {area.cidade ? ` O ZIP é de ${area.cidade}, que` : ' Este ZIP'} não está na lista
      de ZIPs atendidos. Dá para cadastrar assim mesmo — o cliente fica registrado
      como lead —, mas o <strong>link público recusará o pedido</strong> até o ZIP
      ser incluído em Configurações.
    </div>
  )
}
