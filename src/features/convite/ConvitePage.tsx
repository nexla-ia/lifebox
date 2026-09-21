import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { useQuery } from '../../lib/useQuery'
import { Loading } from '../../ui/states'
import { aceitarConvite, lerConvite, type Convite } from './api'

/* Primeiro acesso por convite. Ref: protótipo 9e.
 *
 * Rota pública, fora do AppLayout: quem abre ainda não tem conta. O token é a
 * única credencial, e é ele que diz de quem é o convite — a pessoa nunca
 * digita o próprio e-mail aqui.
 *
 * Ao terminar, entra já logada. Mandar para a tela de login depois de definir
 * a senha faria a pessoa digitar duas vezes o que acabou de escolher. */

const PAPEL = {
  admin: 'Administradora(o)',
  operacao: 'Operação',
  cozinha: 'Cozinha',
} as const

export function ConvitePage() {
  const { token = '' } = useParams()
  const { session, profile } = useAuth()
  const { data, loading } = useQuery(
    async () => {
      const { data, error } = await lerConvite(token)
      if (error) return { data: null, error: { message: error.message } }
      return { data: data as Convite, error: null }
    },
    [token],
  )

  const [senha, setSenha] = useState('')
  const [repetir, setRepetir] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (session && profile) return <Navigate to="/" replace />
  if (loading) return <Moldura><Loading label="Abrindo seu convite…" /></Moldura>

  if (!data || !data.valido) {
    return (
      <Moldura>
        <div className="text-center flex flex-col gap-2">
          <div className="text-[28px]">⏳</div>
          <h1 className="text-[17px] font-bold text-brand">Convite inválido ou expirado</h1>
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Convites valem por 7 dias e servem uma vez só. Peça um novo link ao
            Administrador da LifeBox.
          </p>
        </div>
      </Moldura>
    )
  }

  const c = data
  const oito = senha.length >= 8
  const conferem = senha.length > 0 && senha === repetir
  const pode = oito && conferem && !enviando

  async function definir(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const { error } = await aceitarConvite(token, senha)
    if (error) {
      setEnviando(false)
      setErro(error.message)
      return
    }
    // já entra: a senha acabou de ser escolhida, pedir para digitá-la de novo
    // numa tela de login seria só atrito
    const { error: erroLogin } = await supabase.auth.signInWithPassword({
      email: c.email, password: senha,
    })
    setEnviando(false)
    if (erroLogin) {
      setErro('Sua senha foi definida. Entre pela tela de acesso.')
      return
    }
    // o AuthProvider assume daqui; o <Navigate> no topo leva para a tela
    // inicial do perfil
  }

  return (
    <Moldura>
      <h1 className="text-[19px] font-bold text-brand">
        Bem-vinda(o), {c.nome.split(' ')[0]} 👋
      </h1>
      <p className="text-[13px] text-ink-2 leading-relaxed mt-1 mb-5">
        {c.convidou ? <><strong>{c.convidou}</strong> te convidou</> : 'Você foi convidada(o)'}
        {' '}como <strong>{PAPEL[c.papel]}</strong>. Defina sua senha para entrar.
      </p>

      {erro && (
        <div role="alert"
          className="bg-danger-bg border border-danger-line text-danger rounded-lg px-3 py-2.5 text-[12.5px] mb-4">
          {erro}
        </div>
      )}

      <form onSubmit={definir} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">E-mail</span>
          <input value={c.email} readOnly aria-label="E-mail"
            className="border border-line rounded-lg px-3 py-2.5 text-[13px] bg-muted-bg text-ink-3 outline-none" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Criar senha</span>
          <input type="password" value={senha} autoComplete="new-password" aria-label="Criar senha"
            onChange={(e) => setSenha(e.target.value)}
            className="border border-line-strong rounded-lg px-3 py-2.5 text-[13px] bg-surface-alt outline-none focus:border-brand" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Repetir senha</span>
          <input type="password" value={repetir} autoComplete="new-password" aria-label="Repetir senha"
            onChange={(e) => setRepetir(e.target.value)}
            className="border border-line-strong rounded-lg px-3 py-2.5 text-[13px] bg-surface-alt outline-none focus:border-brand" />
        </label>

        {/* o que falta, enquanto falta: a pessoa não deve descobrir a regra
            só depois de apertar o botão */}
        <div role="status" className={`rounded-lg px-3 py-2 text-[12px] border ${
          oito && conferem
            ? 'bg-ok-bg border-ok-line text-ok'
            : 'bg-muted-bg border-line text-ink-3'}`}>
          {oito && conferem
            ? '✅ Mínimo de 8 caracteres · as duas senhas conferem'
            : !oito
              ? 'A senha precisa de pelo menos 8 caracteres.'
              : 'As duas senhas ainda não conferem.'}
        </div>

        <button type="submit" disabled={!pode}
          className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-xl px-5 py-3 text-[14px] font-semibold">
          {enviando ? 'Entrando…' : 'Definir senha e entrar'}
        </button>
      </form>

      <p className="text-[11px] text-ink-muted mt-4 text-center leading-relaxed">
        Convite válido por 7 dias · expirou? peça um novo ao Administrador.
      </p>
    </Moldura>
  )
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center bg-cream px-6 py-10">
      <div className="w-full max-w-sm bg-surface border border-line rounded-2xl p-8 shadow-[0_4px_18px_rgba(36,81,59,.07)]">
        <div className="flex items-center gap-0.5 font-bold text-2xl tracking-wide text-brand mb-6">
          LIFE
          <span className="inline-flex items-center justify-center w-6 h-6 bg-brand text-lime text-base mx-[3px] rounded-[7px_7px_7px_2px]">
            ✓
          </span>
          BOX
        </div>
        {children}
      </div>
    </div>
  )
}
