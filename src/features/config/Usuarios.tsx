import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useQuery } from '../../lib/useQuery'
import { EmptyState, ErrorState, Loading } from '../../ui/states'
import {
  convidarUsuario, definirPapel, definirStatus, fetchUsuarios, reenviarConvite,
  type Usuario,
} from './api'

/* Configurações · Usuários. Ref: protótipo 9d e 9e.
 *
 * §3: convite com prazo, senha definida no primeiro acesso, troca de perfil e
 * desativação. O convite sai daqui como LINK — a equipe se fala por WhatsApp,
 * e mandar e-mail exigiria SMTP no projeto.
 *
 * Desativar preserva o histórico: a pessoa continua sendo a autora dos pedidos
 * que lançou. O acesso cai de verdade, não só o menu — current_role_of() só
 * enxerga quem está 'ativo', então a RLS para de devolver linha. */

const PAPEIS = [
  {
    id: 'admin', rotulo: 'Administrador',
    alcance: 'Tudo: Overview, Semana, Clientes, Catálogo (edita preços), Produção, Montagem, Bags e Configurações.',
  },
  {
    id: 'operacao', rotulo: 'Operação',
    alcance: 'Semana, Clientes, Catálogo (lê preço, edita prato e menu), Produção, Montagem e Bags. Sem Overview e sem Configurações.',
  },
  {
    id: 'cozinha', rotulo: 'Cozinha',
    alcance: 'Só Produção, com Kitchen Notes. Sem valores, contatos ou endereços.',
  },
] as const

const SELO = {
  ativo: { rotulo: 'ativo', cls: 'bg-ok-bg border-ok-line text-ok' },
  convite_pendente: { rotulo: 'convite pendente', cls: 'bg-warn-bg border-warn-line text-warn' },
  desativado: { rotulo: 'desativado', cls: 'bg-muted-bg border-line text-ink-3' },
} as const

export function Usuarios({ podeEditar }: { podeEditar: boolean }) {
  const { profile } = useAuth()
  const { data, loading, error, reload } = useQuery(fetchUsuarios, [])
  const [convidando, setConvidando] = useState(false)
  const [link, setLink] = useState<{ nome: string; url: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  if (loading) return <Loading shape="rows" label="Carregando usuários…" />
  if (error) return <ErrorState message={error} onRetry={reload} />

  const usuarios = data ?? []

  async function acao(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setErro(null)
    const { error } = await fn()
    // As recusas do servidor são escritas para quem está na tela ("Peça a outro
    // Administrador", "Precisa sobrar ao menos um"): engolir vira clique sem efeito.
    if (error) { setErro(error.message); return }
    reload()
  }

  return (
    <div className="flex flex-col gap-4">
      {podeEditar && (
        <section className="bg-surface border border-line rounded-xl px-4 py-3 flex flex-col gap-3">
          <header className="flex items-center gap-3">
            <h2 className="text-[13.5px] font-bold text-brand">Convidar usuário</h2>
            <div className="flex-1" />
            {!convidando && (
              <button onClick={() => { setConvidando(true); setLink(null) }}
                className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-3.5 py-1.5 text-[12px] font-semibold">
                ＋ Convidar
              </button>
            )}
          </header>

          {convidando && (
            <FormConvite
              onCancelar={() => setConvidando(false)}
              onConvidado={(nome, token) => {
                setConvidando(false)
                setLink({ nome, url: `${window.location.origin}/convite/${token}` })
                reload()
              }}
              onErro={setErro} />
          )}

          {link && <LinkDoConvite nome={link.nome} url={link.url} onFechar={() => setLink(null)} />}
        </section>
      )}

      {erro && (
        <div role="alert"
          className="bg-danger-bg border border-danger-line text-danger rounded-xl px-4 py-3 text-[12.5px]">
          {erro}
        </div>
      )}

      <section className="bg-surface border border-line rounded-xl overflow-x-auto">
        <header className="px-4 py-3 border-b border-line bg-surface-alt">
          <h2 className="text-[13.5px] font-bold text-brand">Usuários · {usuarios.length}</h2>
        </header>

        {usuarios.length === 0 ? (
          <EmptyState icon="👥" title="Nenhum usuário" />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-surface-alt text-[10px] uppercase tracking-wide text-ink-muted">
                <th className="text-left font-semibold px-4 py-2">Nome</th>
                <th className="text-left font-semibold px-3">E-mail</th>
                <th className="text-left font-semibold px-3 w-40">Perfil</th>
                <th className="text-left font-semibold px-3 w-32">Status</th>
                {podeEditar && <th className="text-left font-semibold px-3 w-48">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const euMesmo = u.id === profile?.id
                return (
                  <tr key={u.id} className="border-t border-line-soft">
                    <td className="px-4 py-2.5 font-semibold text-ink">
                      {u.full_name}
                      {euMesmo && <span className="text-[10.5px] text-ink-muted font-normal"> · você</span>}
                    </td>
                    <td className="px-3 text-ink-2">{u.email}</td>
                    <td className="px-3">
                      {podeEditar && !euMesmo ? (
                        <select value={u.role} aria-label={`Perfil de ${u.full_name}`}
                          onChange={(e) => acao(() =>
                            definirPapel(u.id, e.target.value as Usuario['role']))}
                          className="border border-line-strong rounded-lg px-2 py-1 text-[12px] bg-surface outline-none focus:border-brand">
                          {PAPEIS.map((p) => (
                            <option key={p.id} value={p.id}>{p.rotulo}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-ink-2">
                          {PAPEIS.find((p) => p.id === u.role)?.rotulo}
                        </span>
                      )}
                    </td>
                    <td className="px-3">
                      <span className={`border rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${SELO[u.status].cls}`}>
                        {SELO[u.status].rotulo}
                      </span>
                    </td>
                    {podeEditar && (
                      <td className="px-3 py-2">
                        {euMesmo ? (
                          <span className="text-[11px] text-ink-muted">
                            outro Administrador altera
                          </span>
                        ) : (
                          <div className="flex gap-2 flex-wrap">
                            {u.status === 'convite_pendente' && (
                              <button onClick={async () => {
                                setErro(null)
                                const { data, error } = await reenviarConvite(u.id)
                                if (error) { setErro(error.message); return }
                                const t = (data as { token: string }).token
                                setLink({
                                  nome: u.full_name,
                                  url: `${window.location.origin}/convite/${t}`,
                                })
                              }} className="text-[11.5px] text-brand-mid hover:underline">
                                novo link
                              </button>
                            )}
                            <button
                              onClick={() => acao(() => definirStatus(
                                u.id, u.status === 'desativado' ? 'ativo' : 'desativado'))}
                              className="text-[11.5px] text-ink-3 hover:text-brand">
                              {u.status === 'desativado' ? 'reativar' : 'desativar'}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid sm:grid-cols-3 gap-2.5">
        {PAPEIS.map((p) => (
          <div key={p.id} className="bg-surface border border-line rounded-xl px-3.5 py-3">
            <div className="text-[12.5px] font-bold text-brand">{p.rotulo}</div>
            <p className="text-[11.5px] text-ink-3 leading-snug mt-1">{p.alcance}</p>
          </div>
        ))}
      </section>
    </div>
  )
}

function FormConvite({
  onConvidado, onCancelar, onErro,
}: {
  onConvidado: (nome: string, token: string) => void
  onCancelar: () => void
  onErro: (m: string) => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Usuario['role']>('operacao')
  const [enviando, setEnviando] = useState(false)
  const campo = 'w-full border border-line-strong rounded-lg px-3 py-2 text-[13px] bg-surface-alt outline-none focus:border-brand'

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid sm:grid-cols-3 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Nome</span>
          <input value={nome} aria-label="Nome do convidado"
            onChange={(e) => setNome(e.target.value)} className={campo} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">E-mail</span>
          <input value={email} type="email" aria-label="E-mail do convidado"
            onChange={(e) => setEmail(e.target.value)} className={campo} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-2">Perfil</span>
          <select value={papel} aria-label="Perfil do convidado"
            onChange={(e) => setPapel(e.target.value as Usuario['role'])} className={campo}>
            {PAPEIS.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
          </select>
        </label>
      </div>

      <p className="text-[11.5px] text-ink-muted leading-snug">
        {PAPEIS.find((p) => p.id === papel)?.alcance}
      </p>

      <div className="flex gap-2">
        <button disabled={enviando || !nome.trim() || !email.trim()}
          onClick={async () => {
            setEnviando(true)
            const { data, error } = await convidarUsuario(email.trim(), nome.trim(), papel)
            setEnviando(false)
            if (error) { onErro(error.message); return }
            onConvidado(nome.trim(), (data as { token: string }).token)
          }}
          className="bg-brand hover:bg-brand-hover disabled:bg-line-strong text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold">
          {enviando ? 'Criando…' : 'Gerar convite'}
        </button>
        <button onClick={onCancelar} className="text-[12.5px] text-ink-3 px-2">Cancelar</button>
      </div>
    </div>
  )
}

/** O link aparece UMA vez. Não guardamos o token na tela nem o mostramos de
 *  novo na lista: quem perdeu pede "novo link", e o anterior morre junto —
 *  convite velho circulando é chave a mais na rua. */
function LinkDoConvite({
  nome, url, onFechar,
}: { nome: string; url: string; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)

  return (
    <div className="bg-leaf-bg border border-leaf-line rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="text-[12.5px] font-bold text-brand">
        Convite de {nome} criado. Mande este link para ela.
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <input readOnly value={url} aria-label="Link do convite"
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-64 border border-line-strong rounded-lg px-3 py-2 text-[12px] bg-surface font-mono outline-none" />
        <button onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopiado(true)
          } catch {
            // clipboard barrado (http, permissão): o campo já está aí para
            // copiar à mão, então o botão não pode fingir que deu certo
            setCopiado(false)
          }
        }} className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12px] font-semibold">
          {copiado ? 'Copiado ✓' : 'Copiar'}
        </button>
        <button onClick={onFechar} className="text-[12px] text-ink-3 px-1">Fechar</button>
      </div>
      <p className="text-[11.5px] text-ink-3">
        Vale por 7 dias e serve uma vez só. A pessoa define a própria senha ao abrir —
        ninguém, nem você, conhece a senha dela.
      </p>
    </div>
  )
}
