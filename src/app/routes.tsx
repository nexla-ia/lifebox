import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from '../ui/AppLayout'
import { DeniedState, Loading } from '../ui/states'
import { HOME_BY_ROLE, useAuth } from '../lib/auth'
import { canAccess, SCREENS } from './screens'
import { Login } from './pages/Login'
import { EmDesenvolvimento } from './pages/EmDesenvolvimento'
import { CatalogoPage } from '../features/catalogo/CatalogoPage'
import { ConfigPage } from '../features/config/ConfigPage'
import { ClientesPage } from '../features/clientes/ClientesPage'

/** O guarda é a segunda camada; quem manda de verdade é a RLS no Supabase
 *  (§3). Aqui só evitamos mostrar tela vazia para quem não deveria chegar. */
function Guard({ path, children }: { path: string; children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <Loading label="Carregando seu acesso…" />
  if (!profile) return <Navigate to="/login" replace />
  if (!canAccess(profile.role, path)) return <DeniedState />
  return <>{children}</>
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Loading label="Carregando…" />
  if (!session || !profile) return <Navigate to="/login" replace state={{ from: loc }} />
  return <>{children}</>
}

function HomeRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return <Loading label="Carregando…" />
  if (!profile) return <Navigate to="/login" replace />
  return <Navigate to={HOME_BY_ROLE[profile.role]} replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireSession>
            <AppLayout />
          </RequireSession>
        }
      >
        <Route index element={<HomeRedirect />} />
        {SCREENS.map((s) => (
          <Route
            key={s.path}
            path={s.path}
            element={
              <Guard path={s.path}>
                {s.path === '/catalogo' ? <CatalogoPage />
                  : s.path === '/config' ? <ConfigPage />
                  : s.path === '/clientes' ? <ClientesPage />
                  : <EmDesenvolvimento screen={s} />}
              </Guard>
            }
          />
        ))}
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  )
}
