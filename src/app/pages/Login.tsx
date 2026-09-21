import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

/** Tela de acesso da equipe. Ref: protótipo cartão 1a.
 *  Erro de credencial não revela qual campo errou; "esqueci minha senha"
 *  responde sempre igual, tenha o e-mail acesso ou não. */
export function Login() {
  const { session, profile, error: authError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const loc = useLocation()

  /** Quem chegou aqui por link direto volta para onde queria ir, não para a
   *  tela inicial do perfil.
   *
   *  `search` e `hash` junto, não só o `pathname`: sem eles, recarregar uma
   *  tela com parâmetro na URL (uma aba de Configurações, uma busca) voltava
   *  para a mesma rota sem o parâmetro — a pessoa perdia o lugar e parecia que
   *  o sistema tinha ignorado o clique. */
  const de = (loc.state as { from?: Partial<Location> } | null)?.from
  const destino = de?.pathname
    ? `${de.pathname}${de.search ?? ''}${de.hash ?? ''}`
    : null
  if (session && profile) return <Navigate to={destino ?? '/'} replace />

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr('E-mail ou senha inválidos. Confira os dados e tente de novo.')
    setBusy(false)
  }

  async function esqueci() {
    setSent(true)
    if (email) await supabase.auth.resetPasswordForEmail(email)
  }

  const mensagem = err ?? authError

  return (
    <div className="min-h-screen grid place-items-center bg-cream px-6">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm bg-surface border border-line rounded-2xl p-9 shadow-[0_4px_18px_rgba(36,81,59,.07)]"
      >
        <div className="flex items-center gap-0.5 font-bold text-2xl tracking-wide text-brand">
          LIFE
          <span className="inline-flex items-center justify-center w-6 h-6 bg-brand text-lime text-base mx-[3px] rounded-[7px_7px_7px_2px]">
            ✓
          </span>
          BOX
        </div>
        <p className="text-xs text-ink-muted mt-1.5 mb-6">Sistema operacional · acesso da equipe</p>

        {mensagem && (
          <div
            role="alert"
            className="flex gap-2 bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2.5 text-[12.5px] leading-snug mb-4"
          >
            <span aria-hidden>❌</span>
            <span>{mensagem}</span>
          </div>
        )}

        {sent && (
          <div className="bg-ok-bg border border-ok-line text-ok rounded-lg px-3 py-2.5 text-[12.5px] leading-snug mb-4">
            Se este e-mail tiver acesso, enviamos o link de redefinição.
          </div>
        )}

        <label htmlFor="email" className="block text-xs font-semibold text-ink-2 mb-1.5">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-line-strong rounded-lg px-3 py-2.5 text-sm bg-surface-alt outline-none focus:border-brand mb-4"
        />

        <div className="flex justify-between items-baseline mb-1.5">
          <label htmlFor="senha" className="text-xs font-semibold text-ink-2">Senha</label>
          <button type="button" onClick={esqueci} className="text-xs text-brand-mid hover:underline">
            Esqueci minha senha
          </button>
        </div>
        <input
          id="senha"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-line-strong rounded-lg px-3 py-2.5 text-sm bg-surface-alt outline-none focus:border-brand mb-6"
        />

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-cream rounded-lg py-3 text-[14.5px] font-semibold"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="text-center text-[11.5px] text-ink-muted mt-4">
          Cada perfil entra direto na sua tela.
        </p>
      </form>
    </div>
  )
}
