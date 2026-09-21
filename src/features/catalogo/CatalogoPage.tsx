import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useQuery } from '../../lib/useQuery'
import { ErrorState, Loading } from '../../ui/states'
import { fetchCatalogo } from './api'
import { PlanosPrecos } from './PlanosPrecos'
import { Adicionais } from './Adicionais'

/* Tela 9.5 · Catálogo e menus. Ref: protótipo 5a–5f.
 *
 * Administrador edita preço; Operação lê (§3). A trava real é a RLS — aqui só
 * escondemos o campo para não oferecer o que o banco vai recusar. */

type Aba = 'catalogo' | 'menus'

export function CatalogoPage() {
  const { profile } = useAuth()
  const [aba, setAba] = useState<Aba>('catalogo')
  const { data, loading, error, reload } = useQuery(fetchCatalogo, [])

  const podeEditarPrecos = profile?.role === 'admin'

  return (
    <div className="p-5 flex flex-col gap-4 min-h-screen">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">Catálogo e menus</h1>

        <div className="flex bg-surface border border-line rounded-lg p-0.5 gap-0.5">
          {([['catalogo', 'Catálogo'], ['menus', 'Menus do ciclo']] as const).map(([v, rotulo]) => (
            <button
              key={v}
              onClick={() => setAba(v)}
              className={`rounded-md px-3.5 py-1 text-[12px] ${
                aba === v ? 'bg-brand text-cream font-semibold' : 'text-ink-2 hover:bg-cream'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {podeEditarPrecos ? (
          <span className="text-[11.5px] text-ink-muted">
            Mudar preço afeta só pedidos novos — os lançados guardam o valor da semana
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-3 bg-muted-bg border border-line rounded-full px-3 py-1">
            🔒 Preços definidos pelo Administrador
          </span>
        )}
      </header>

      {aba === 'catalogo' ? (
        loading ? (
          <Loading shape="rows" label="Carregando catálogo…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data ? (
          <div className="flex flex-col gap-4">
            <PlanosPrecos catalogo={data} podeEditar={podeEditarPrecos} onSaved={reload} />
            <Adicionais podeEditar={podeEditarPrecos} />
          </div>
        ) : null
      ) : (
        <div className="bg-surface border border-line rounded-xl p-10 text-center">
          <div className="text-3xl mb-2">🗓️</div>
          <h2 className="text-[15px] font-bold text-ink">Menus do ciclo</h2>
          <p className="text-[13px] text-ink-3 max-w-md mx-auto leading-relaxed mt-1">
            Os 4 menus em rotação automática, com os pratos de cada um e a trava do menu
            em execução. É a próxima parte desta tela.
          </p>
        </div>
      )}
    </div>
  )
}
