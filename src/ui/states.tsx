import { Link } from 'react-router-dom'
import { HOME_BY_ROLE, useAuth } from '../lib/auth'

/* Estados que TODA tela precisa ter (§8 e tela 9f):
   vazio · carregando · erro · acesso negado.
   O skeleton respeita a FORMA do conteúdo: linhas na Semana, cards + barras no
   Overview, 3 blocos na Produção. Por isso `shape` em vez de um spinner só. */

type Shape = 'rows' | 'cards' | 'blocks'

export function Loading({ shape = 'rows', label }: { shape?: Shape; label?: string }) {
  return (
    <div className="p-4" role="status" aria-live="polite" aria-busy="true">
      {shape === 'rows' && (
        <div className="flex flex-col gap-3">
          {['96%', '88%', '93%', '80%', '91%', '85%'].map((w, i) => (
            <div key={i} className="skeleton h-5 rounded-md" style={{ width: w }} />
          ))}
        </div>
      )}
      {shape === 'cards' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
          </div>
          <div className="flex items-end gap-2 h-24">
            {[52, 74, 88, 64, 36].map((h, i) => (
              <div key={i} className="skeleton flex-1 rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      )}
      {shape === 'blocks' && (
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton flex-1 h-40 rounded-xl" />)}
        </div>
      )}
      <p className="text-center text-xs text-ink-muted pt-3">{label ?? 'Carregando…'}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Centered
      icon="📡"
      tone="danger"
      title="Sem conexão com o servidor"
      body={message ?? 'Não foi possível carregar os dados.'}
    >
      {onRetry && (
        <button
          onClick={onRetry}
          className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
        >
          Tentar novamente
        </button>
      )}
    </Centered>
  )
}

export function EmptyState({
  icon = '📋', title, body, action,
}: { icon?: string; title: string; body?: string; action?: React.ReactNode }) {
  return <Centered icon={icon} tone="muted" title={title} body={body}>{action}</Centered>
}

/** Estado vazio ≠ erro. Acesso negado nunca é tela branca: sempre oferece a
 *  tela inicial do perfil (§3). Itens bloqueados nem aparecem no menu — isto
 *  aqui é para quem digitou a URL direto. */
export function DeniedState() {
  const { profile } = useAuth()
  const home = profile ? HOME_BY_ROLE[profile.role] : '/login'
  return (
    <Centered
      icon="🔒"
      tone="warn"
      title="Esta tela não é do seu perfil"
      body={
        profile
          ? `Seu acesso é ${roleLabel(profile.role)} e esta tela é de outro perfil. Peça a troca ao administrador se precisar.`
          : 'Entre para continuar.'
      }
    >
      <Link
        to={home}
        className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-sm font-semibold"
      >
        Ir para a minha tela inicial
      </Link>
    </Centered>
  )
}

export function roleLabel(r: 'admin' | 'operacao' | 'cozinha') {
  return { admin: 'Administrador', operacao: 'Operação', cozinha: 'Cozinha' }[r]
}

function Centered({
  icon, title, body, tone, children,
}: {
  icon: string; title: string; body?: string
  tone: 'danger' | 'warn' | 'muted'; children?: React.ReactNode
}) {
  const bg = { danger: 'bg-danger-bg', warn: 'bg-warn-bg', muted: 'bg-muted-bg' }[tone]
  return (
    <div className="flex flex-col items-center gap-2 text-center px-6 py-14">
      <div className={`w-12 h-12 rounded-full grid place-items-center text-2xl ${bg}`}>{icon}</div>
      <h2 className="text-[15px] font-bold text-ink">{title}</h2>
      {body && <p className="text-[13px] text-ink-3 max-w-xs leading-relaxed">{body}</p>}
      {children && <div className="pt-2 flex gap-2">{children}</div>}
    </div>
  )
}
