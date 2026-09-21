import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { navFor } from '../app/screens'
import { roleLabel } from './states'

/** Layout base: nav verde-escuro de 176px + conteúdo sobre creme.
 *  Ref: protótipo aprovado, cartões 10a / 1b / 3a / 5a. */
export function AppLayout() {
  const { profile, signOut } = useAuth()
  if (!profile) return null

  const initials = profile.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex min-h-screen bg-cream">
      <nav className="shrink-0 w-44 bg-brand flex flex-col pt-4 pb-3">
        <div className="flex items-center gap-0.5 font-bold text-[15px] tracking-wide text-cream px-4 pb-5">
          LIFE
          <span className="inline-flex items-center justify-center w-4 h-4 bg-lime text-brand text-[11px] mx-0.5 rounded-[5px_5px_5px_1px]">
            ✓
          </span>
          BOX
        </div>

        {navFor(profile.role).map((s) => (
          <NavLink
            key={s.path}
            to={s.path}
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 px-4 py-2 text-[13px] border-l-[3px] transition-colors',
                isActive
                  ? 'bg-lime/15 border-lime text-white font-semibold'
                  : 'border-transparent text-nav-item hover:text-white',
              ].join(' ')
            }
          >
            <span aria-hidden>{s.icon}</span>
            {s.label}
          </NavLink>
        ))}

        <div className="flex-1" />

        <div className="flex items-center gap-2 px-4 py-3">
          <div className="w-7 h-7 rounded-full bg-brand-mid text-cream grid place-items-center text-[11px] font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-white text-xs font-semibold leading-tight truncate">
              {profile.full_name}
            </div>
            <button
              onClick={signOut}
              className="text-nav-item text-[10.5px] hover:text-white"
              title="Sair"
            >
              {roleLabel(profile.role)} · sair
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
