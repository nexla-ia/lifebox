import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { Cutoff } from './Cutoff'
import { FormasPagamento } from './FormasPagamento'
import { Mensagens } from './Mensagens'
import { Origens } from './Origens'
import { Usuarios } from './Usuarios'
import { ZipCodes } from './ZipCodes'

/* Tela 9.8 · Configurações. Ref: protótipo 9d. Exclusiva do Administrador (§3).
 *
 * É aqui que o princípio do projeto se paga: ZIP, origem, cutoff, forma de
 * pagamento e mensagem são cadastro da LifeBox, editáveis em tela. Nenhum
 * deles pode virar constante no código.
 *
 * ZIPs vêm primeiro porque sem a lista o link público recusa todo pedido. */

const ABAS = [
  { id: 'zips', rotulo: 'ZIP Codes' },
  { id: 'origens', rotulo: 'Origens' },
  { id: 'cutoff', rotulo: 'Cutoff' },
  { id: 'pagamento', rotulo: 'Formas de pagamento' },
  { id: 'mensagens', rotulo: 'Mensagens' },
  { id: 'usuarios', rotulo: 'Usuários' },
] as const

type AbaId = (typeof ABAS)[number]['id']

export function ConfigPage() {
  const { profile } = useAuth()
  const [aba, setAba] = useState<AbaId>('zips')
  const podeEditar = profile?.role === 'admin'

  return (
    <div className="p-5 flex flex-col gap-4 min-h-screen">
      <header className="flex items-center gap-3 flex-wrap">
        <h1 className="text-base font-bold text-brand">Configurações</h1>
        <span className="bg-accent-bg border border-accent-line text-accent rounded-full px-3 py-0.5 text-[11.5px] font-semibold">
          🔒 Só Administrador
        </span>
      </header>

      <nav className="flex gap-1 flex-wrap">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`rounded-lg px-3.5 py-1.5 text-[12.5px] ${
              aba === a.id
                ? 'bg-brand text-cream font-semibold'
                : 'bg-surface border border-line text-ink-2 hover:border-brand'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === 'zips' ? <ZipCodes podeEditar={podeEditar} />
        : aba === 'origens' ? <Origens podeEditar={podeEditar} />
        : aba === 'cutoff' ? <Cutoff podeEditar={podeEditar} />
        : aba === 'pagamento' ? <FormasPagamento podeEditar={podeEditar} />
        : aba === 'mensagens' ? <Mensagens podeEditar={podeEditar} />
        : aba === 'usuarios' ? <Usuarios podeEditar={podeEditar} />
        : (
          <div className="bg-surface border border-line rounded-xl p-10 text-center">
            <div className="text-3xl mb-2">🚧</div>
            <h2 className="text-[15px] font-bold text-ink">
              {ABAS.find((a) => a.id === aba)?.rotulo}
            </h2>
            <p className="text-[13px] text-ink-3 max-w-md mx-auto leading-relaxed mt-1">
              Entra na próxima etapa.
            </p>
          </div>
        )}
    </div>
  )
}
