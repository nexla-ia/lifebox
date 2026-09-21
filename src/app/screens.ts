import type { Role } from '../lib/auth'

/** Mapa de telas — fonte única. O menu lateral e o guarda de rota saem daqui,
 *  então não tem como uma tela aparecer no menu de quem não pode abri-la.
 *  Ref: LIFEBOX_PROJECT.md §3 e §8, tela 9g (mapa de telas). */
export type Screen = {
  path: string
  label: string
  icon: string
  roles: Role[]
  /** false = não aparece no menu lateral (mas a rota existe) */
  inNav?: boolean
}

export const SCREENS: Screen[] = [
  { path: '/overview',  label: 'Overview',         icon: '📊', roles: ['admin'] },
  { path: '/semana',    label: 'Semana',           icon: '📅', roles: ['admin', 'operacao'] },
  { path: '/clientes',  label: 'Clientes',         icon: '👤', roles: ['admin', 'operacao'] },
  { path: '/catalogo',  label: 'Catálogo e menus', icon: '🍽️', roles: ['admin', 'operacao'] },
  { path: '/producao',  label: 'Produção',         icon: '🔪', roles: ['admin', 'operacao', 'cozinha'] },
  { path: '/montagem',  label: 'Montagem',         icon: '📦', roles: ['admin', 'operacao'] },
  { path: '/bags',      label: 'Bags',             icon: '🧊', roles: ['admin', 'operacao'] },
  { path: '/config',    label: 'Configurações',    icon: '⚙️', roles: ['admin'] },
]

export const navFor = (role: Role) =>
  SCREENS.filter((s) => s.inNav !== false && s.roles.includes(role))

export const canAccess = (role: Role, path: string) =>
  SCREENS.find((s) => s.path === path)?.roles.includes(role) ?? false
