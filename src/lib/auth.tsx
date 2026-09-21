import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'admin' | 'operacao' | 'cozinha'

export type Profile = {
  id: string
  full_name: string
  email: string
  role: Role
  status: 'ativo' | 'convite_pendente' | 'desativado'
}

/** Tela inicial por perfil (§3). Também é para onde o "acesso negado" volta. */
export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/overview',
  operacao: '/semana',
  cozinha: '/producao',
}

type AuthValue = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // Enquanto a sessão do storage não foi lida, NÃO dá para dizer que a pessoa
  // está deslogada. Sem isto, abrir /catalogo direto (ou dar F5) manda para o
  // /login por um instante, e o destino original se perde: a pessoa reaparece
  // na tela inicial do perfil em vez da que pediu.
  const [booting, setBooting] = useState(true)
  const [carregandoPerfil, setCarregandoPerfil] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setCarregandoPerfil(false)
      return
    }
    let cancelled = false
    setCarregandoPerfil(true)
    supabase
      .from('profiles')
      .select('id, full_name, email, role, status')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        // Usuário desativado mantém histórico mas perde o acesso (tela 1a).
        else if (data?.status !== 'ativo') {
          setError('Este acesso foi desativado. Fale com o administrador da LifeBox.')
          setProfile(null)
        } else {
          setProfile(data as Profile)
          setError(null)
        }
        setCarregandoPerfil(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <AuthCtx.Provider
      value={{ session, profile, loading: booting || carregandoPerfil, error, signOut }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return v
}
