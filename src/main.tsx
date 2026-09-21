import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { AppRoutes } from './app/routes'
import { ConfigMissing } from './app/pages/ConfigMissing'
import { isConfigured } from './lib/supabase'
import './styles/theme.css'

// Sem Supabase configurado o app não sobe — mas mostra por quê, em vez de
// deixar a página em branco.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    ) : (
      <ConfigMissing />
    )}
  </StrictMode>,
)
