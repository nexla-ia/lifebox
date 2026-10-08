import { Component, type ErrorInfo, type ReactNode } from 'react'

/* Rede de segurança contra a tela em branco (§8, tela 9f).
 *
 * Sem isto, UMA exceção de render em qualquer tela apaga o aplicativo inteiro:
 * o React desmonta a árvore e sobra `<body>` vazio. Foi assim que a Vercel
 * serviu a primeira versão — e é o que os testes de smoke guardam. Só que eles
 * cobrem um caso (falta de configuração); este cobre todos os outros.
 *
 * A pessoa não tem o que fazer com "Cannot read properties of undefined", mas
 * tem o que fazer com "recarregue" e "avise a Nexla". A mensagem técnica fica
 * aberta num detalhe, porque é o que transforma um chamado de "sumiu tudo" em
 * um chamado que dá para investigar.
 *
 * `key` na rota reseta o boundary ao navegar: sem isso, uma tela que quebrou
 * deixa o erro na tela mesmo depois de a pessoa clicar em outro item do menu,
 * e o aplicativo parece travado de vez. */

type Props = { children: ReactNode }
type State = { erro: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null }

  static getDerivedStateFromError(erro: Error): State {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // o console é onde o e2e e o navegador da equipe vão buscar
    console.error('Tela quebrou:', erro, info.componentStack)
  }

  render() {
    if (!this.state.erro) return this.props.children

    return (
      <div className="p-5">
        <div
          role="alert"
          className="bg-surface border border-danger-line rounded-xl px-5 py-6 max-w-xl mx-auto text-center"
        >
          <div className="text-2xl mb-2">⚠️</div>
          <h2 className="text-[15px] font-bold text-ink">Esta tela não abriu</h2>
          <p className="text-[12.5px] text-ink-3 mt-1">
            O resto do sistema continua funcionando — use o menu para ir a outra tela.
            Se voltar a acontecer, avise a Nexla com o texto abaixo.
          </p>

          <div className="flex gap-2 justify-center mt-4">
            <button
              onClick={() => this.setState({ erro: null })}
              className="bg-brand hover:bg-brand-hover text-cream rounded-lg px-4 py-2 text-[12.5px] font-semibold"
            >
              Tentar de novo
            </button>
            <button
              onClick={() => window.location.reload()}
              className="border border-line-strong text-ink-2 hover:bg-muted-bg rounded-lg px-4 py-2 text-[12.5px] font-semibold"
            >
              Recarregar
            </button>
          </div>

          <details className="mt-4 text-left">
            <summary className="text-[11.5px] text-ink-muted cursor-pointer">
              detalhe técnico
            </summary>
            {/* Com o STACK, não só a mensagem: "Cannot read properties of
                undefined" sem o lugar não dá para investigar, e quem copia
                isto para a Nexla copia tudo o que tem. */}
            <pre className="text-[11px] text-ink-3 whitespace-pre-wrap mt-1.5">
              {this.state.erro.message}
              {this.state.erro.stack && `

${this.state.erro.stack.slice(0, 1200)}`}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
