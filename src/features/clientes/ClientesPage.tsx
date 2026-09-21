import { useMemo, useState } from 'react'
import { useQuery } from '../../lib/useQuery'
import { formatarTelefone } from '../../lib/telefone'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import { fetchClientes, type Cliente, type StatusCliente } from './api'
import { FormCliente } from './FormCliente'
import { FichaCliente } from './FichaCliente'
import { SeloLead, SeloStatus } from './selos'
import { filtrarClientes } from './filtro'

/* Tela 9.4 · Clientes. Ref: protótipo 4a, 4b, 4c, 4d.
 *
 * Admin e Operação; a Cozinha não chega aqui (§3). O cliente é permanente e
 * nunca se duplica: 1 cliente → N pedidos ao longo das semanas (§1, §6.1). */

const FILTROS: { id: StatusCliente | 'todos'; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'ativo', rotulo: 'Ativos' },
  { id: 'pausado', rotulo: '⏰ Pausados' },
  { id: 'cancelado', rotulo: '❌ Cancelados' },
  { id: 'lead', rotulo: '🧲 Leads' },
]

type Vista =
  | { tela: 'lista' }
  | { tela: 'ficha'; id: string }
  | { tela: 'form'; cliente: Cliente | null; nomeInicial?: string }

export function ClientesPage() {
  const { data, loading, error, reload } = useQuery(fetchClientes, [])
  const [vista, setVista] = useState<Vista>({ tela: 'lista' })
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<StatusCliente | 'todos'>('todos')
  const [rotaFiltro, setRotaFiltro] = useState('')

  const clientes = data?.clientes ?? []

  const visiveis = useMemo(
    () => filtrarClientes(clientes, { busca, status: filtro, rotaId: rotaFiltro }),
    [clientes, busca, filtro, rotaFiltro],
  )

  if (loading) return <div className="p-5"><Loading shape="rows" label="Carregando clientes…" /></div>
  if (error) return <div className="p-5"><ErrorState message={error} onRetry={reload} /></div>
  if (!data) return null

  if (vista.tela === 'form') {
    return (
      <div className="p-5">
        <FormCliente
          dados={data}
          cliente={vista.cliente}
          nomeInicial={vista.nomeInicial}
          onCancelar={() => setVista(vista.cliente ? { tela: 'ficha', id: vista.cliente.id } : { tela: 'lista' })}
          onSalvo={(id) => { reload(); setVista({ tela: 'ficha', id }) }}
        />
      </div>
    )
  }

  if (vista.tela === 'ficha') {
    const cliente = clientes.find((c) => c.id === vista.id)
    if (!cliente) return <div className="p-5"><Loading label="Carregando ficha…" /></div>
    return (
      <div className="p-5">
        <FichaCliente
          cliente={cliente}
          dados={data}
          onVoltar={() => setVista({ tela: 'lista' })}
          onEditar={() => setVista({ tela: 'form', cliente })}
        />
      </div>
    )
  }

  const contar = (id: StatusCliente | 'todos') =>
    id === 'todos' ? clientes.length : clientes.filter((c) => c.status === id).length

  return (
    <div className="p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">Clientes</h1>
        <span className="text-[12.5px] text-ink-3">
          {clientes.length} cadastro{clientes.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        <input
          aria-label="Buscar cliente"
          placeholder="Buscar por nome, telefone ou ZIP…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="border border-line rounded-lg px-3 py-1.5 text-[12.5px] bg-surface outline-none focus:border-brand w-64"
        />
        <button
          onClick={() => setVista({ tela: 'form', cliente: null })}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[13px] font-semibold whitespace-nowrap"
        >
          ＋ Novo cliente
        </button>
      </header>

      <div className="flex gap-2 items-center flex-wrap">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-3 py-1 text-[12px] border ${
              filtro === f.id
                ? 'bg-brand border-brand text-cream font-semibold'
                : 'bg-surface border-line text-ink-2 hover:border-brand'
            }`}
          >
            {f.rotulo} · {contar(f.id)}
          </button>
        ))}
        <span className="w-px h-5 bg-line mx-1" />
        <select
          aria-label="Filtrar por rota"
          value={rotaFiltro}
          onChange={(e) => setRotaFiltro(e.target.value)}
          className="border border-line rounded-lg px-3 py-1 text-[12px] bg-surface outline-none focus:border-brand"
        >
          <option value="">Rota: todas</option>
          {data.rotas.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <section className="bg-surface border border-line rounded-xl overflow-hidden">
        {clientes.length === 0 ? (
          <EmptyState
            icon="👤"
            title="Nenhum cliente cadastrado"
            body="Cadastre aqui, ou deixe o link público criar sozinho quando alguém fizer o primeiro pedido."
            action={
              <button
                onClick={() => setVista({ tela: 'form', cliente: null })}
                className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Cadastrar o primeiro
              </button>
            }
          />
        ) : visiveis.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={busca ? `Nenhum cliente para “${busca}”` : 'Nenhum cliente com esses filtros'}
            body="Limpe os filtros ou cadastre agora — o cadastro já abre com o nome buscado."
            action={
              <div className="flex gap-2">
                <button
                  onClick={() => { setBusca(''); setFiltro('todos'); setRotaFiltro('') }}
                  className="bg-surface border border-line-strong text-ink-2 rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  Limpar filtros
                </button>
                {busca && (
                  <button
                    onClick={() => setVista({ tela: 'form', cliente: null, nomeInicial: busca })}
                    className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    ＋ Cadastrar “{busca}”
                  </button>
                )}
              </div>
            }
          />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-surface-alt text-[10.5px] uppercase tracking-wide text-ink-muted">
                <th className="text-left font-semibold px-4 py-2.5">Cliente</th>
                <th className="text-left font-semibold px-3">Telefone</th>
                <th className="text-left font-semibold px-3">Cidade</th>
                <th className="text-left font-semibold px-3">Rota</th>
                <th className="text-left font-semibold px-3">Status</th>
                <th className="px-3" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.id} className="border-t border-line-soft hover:bg-cream/60">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-ink">
                      {c.first_name} {c.last_name ?? ''}
                    </div>
                    <div className="mt-0.5"><SeloLead tipo={c.lead_type} /></div>
                  </td>
                  <td className="px-3 text-ink-2 tnum whitespace-nowrap">
                    {formatarTelefone(c.phone_e164)}
                  </td>
                  <td className="px-3 text-ink-2">
                    {c.city ?? '—'}
                    {c.zip_code && <span className="text-ink-muted tnum"> · {c.zip_code}</span>}
                  </td>
                  <td className="px-3 text-ink-2">
                    {data.rotas.find((r) => r.id === c.route_id)?.name ?? '—'}
                  </td>
                  <td className="px-3"><SeloStatus status={c.status} /></td>
                  <td className="px-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setVista({ tela: 'ficha', id: c.id })}
                      className="text-[12px] text-brand-mid hover:underline"
                    >
                      Abrir ficha
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
