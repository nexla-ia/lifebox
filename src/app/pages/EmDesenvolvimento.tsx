import type { Screen } from '../screens'
import { EmptyState } from '../../ui/states'

/** Placeholder até a tela existir. A fundação (§11.1) entrega auth, perfis,
 *  RLS, layout e rotas protegidas; cada tela entra nas etapas seguintes. */
export function EmDesenvolvimento({ screen }: { screen: Screen }) {
  return (
    <div className="p-6">
      <h1 className="text-base font-bold text-brand mb-1">
        {screen.icon} {screen.label}
      </h1>
      <EmptyState
        icon="🚧"
        title="Tela ainda não construída"
        body="A fundação está de pé: acesso, perfis, RLS, layout e rotas. Esta tela entra na próxima etapa."
      />
    </div>
  )
}
