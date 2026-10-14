import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { navFor } from '../app/screens'
import { roleLabel } from './states'

/** Layout base: nav verde-escuro de 176px + conteúdo sobre creme.
 *  Ref: protótipo aprovado, cartões 10a / 1b / 3a / 5a.
 *
 *  NO CELULAR A NAV É GAVETA, e no computador é a barra do protótipo — a
 *  mesma, sem nenhuma diferença.
 *
 *  Medido no Chromium a 375px (iPhone SE/13 mini): a barra fixa ficava com
 *  176px dos 375, e sobravam 199px de conteúdo em TODA tela. Overview, Semana,
 *  Clientes e Configurações estouravam a largura; o resto não estourava só
 *  porque as tabelas rolam por dentro — numa janela de 199px, que não serve
 *  para conferir nada.
 *
 *  Com a nav fora do caminho, as 15 telas couberam em 375px com zero estouro:
 *  o conteúdo já era fluido, o problema era um só. Por isso o conserto é aqui
 *  e não espalhado pelas telas.
 *
 *  Quem usa isso no celular é a equipe na cozinha e no carro — a folha de
 *  montagem e a de produção são para imprimir, mas conferir pedido e marcar
 *  Montado acontece de pé, com o celular na mão. */
export function AppLayout() {
  const { profile, signOut } = useAuth()
  const [aberta, setAberta] = useState(false)

  // Esc fecha, como qualquer coisa que cobre a tela — e é o que o teclado tem
  useEffect(() => {
    if (!aberta) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberta(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [aberta])

  if (!profile) return null

  const initials = profile.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  const marca = (
    <div className="flex items-center gap-0.5 font-bold text-[15px] tracking-wide text-cream">
      LIFE
      <span className="inline-flex items-center justify-center w-4 h-4 bg-lime text-brand text-[11px] mx-0.5 rounded-[5px_5px_5px_1px]">
        ✓
      </span>
      BOX
    </div>
  )

  return (
    <div className="md:flex min-h-screen bg-cream">
      {/* Barra de cima só no celular. `sticky`, não `fixed`: fixed exigiria
          padding no conteúdo para não ficar por baixo, e esse padding sobra
          no computador se alguém esquecer o breakpoint. */}
      <header className="md:hidden sticky top-0 z-30 bg-brand flex items-center gap-3 px-4 h-12 print:hidden">
        <button
          onClick={() => setAberta((v) => !v)}
          aria-expanded={aberta}
          aria-controls="menu-lateral"
          aria-label={aberta ? 'Fechar menu' : 'Abrir menu'}
          className="text-cream text-xl leading-none w-9 h-9 -ml-2 grid place-items-center rounded-lg hover:bg-white/10"
        >
          {aberta ? '✕' : '☰'}
        </button>
        {marca}
      </header>

      {/* Fundo escuro atrás da gaveta: fecha ao toque e deixa claro que o que
          está atrás não responde enquanto ela está aberta. */}
      {aberta && (
        <button
          aria-hidden
          tabIndex={-1}
          onClick={() => setAberta(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/40"
        />
      )}

      <nav
        id="menu-lateral"
        className={[
          'bg-brand flex flex-col pt-4 pb-3',
          // celular: gaveta por cima, fora da tela quando fechada
          'fixed inset-y-0 left-0 z-40 w-56 transition-transform duration-200',
          aberta ? 'translate-x-0' : '-translate-x-full',
          // computador: a barra do protótipo, 176px, sem transformação nenhuma
          'md:static md:z-auto md:w-44 md:shrink-0 md:translate-x-0 md:transition-none',
        ].join(' ')}
      >
        <div className="px-4 pb-5 flex items-center justify-between">
          {marca}
          {/* fechar de dentro da gaveta: quem abriu olhando a lista não
              precisa achar o ☰ atrás do fundo escuro */}
          <button
            onClick={() => setAberta(false)}
            aria-label="Fechar menu"
            className="md:hidden text-cream text-lg w-8 h-8 grid place-items-center rounded-lg hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        {navFor(profile.role).map((s) => (
          <NavLink
            key={s.path}
            to={s.path}
            // Fecha no CLIQUE, não num efeito sobre a rota: sem isto a pessoa
            // toca no item, a tela troca por trás e a gaveta continua cobrindo
            // justamente o que ela foi ver. O efeito faria o mesmo, mas ele
            // reage à consequência em vez de à causa — e aí reabrir a gaveta
            // na mesma tela dispararia de novo.
            onClick={() => setAberta(false)}
            className={({ isActive }) =>
              [
                // py-2.5 no celular: alvo de toque de 44px é o mínimo que a
                // Apple e o Google pedem, e dedo não acerta linha de 30px
                'flex items-center gap-2.5 px-4 py-2.5 md:py-2 text-[13px] border-l-[3px] transition-colors',
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
          <div className="w-7 h-7 shrink-0 rounded-full bg-brand-mid text-cream grid place-items-center text-[11px] font-semibold">
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
