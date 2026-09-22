import type { ReactNode } from 'react'

/* Peças pequenas do link público. Ficam à parte porque o fluxo tem seis
 * telas e todas repetem campo, contador e botão — e porque o link é a única
 * parte do sistema vista por quem não é da equipe: o que muda aqui muda em
 * todos os passos de uma vez. Cores e raios saem dos tokens da marca. */

export function Campo({
  label, ajuda, obrigatorio, children,
}: { label: string; ajuda?: string; obrigatorio?: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-ink-2">
        {label} {obrigatorio && <span className="text-danger">*</span>}
      </span>
      {children}
      {ajuda && <span className="text-[11px] text-ink-muted leading-snug">{ajuda}</span>}
    </label>
  )
}

/** Grupo de botões que funciona como escolha (entrega/retirada, forma de
 *  pagamento).
 *
 *  NÃO usa `<label>`: label envolvendo botões faz o texto dela entrar no nome
 *  acessível de CADA botão — "Como você quer receber? 🏠 Retirar…" — e aí dois
 *  botões diferentes passam a casar com o mesmo texto. Some no leitor de tela
 *  e quebra qualquer busca por nome. */
export function Grupo({
  label, ajuda, children,
}: { label: string; ajuda?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-ink-2">{label}</span>
      <div role="group" aria-label={label} className="flex gap-2 flex-wrap">
        {children}
      </div>
      {ajuda && <span className="text-[11px] text-ink-muted leading-snug">{ajuda}</span>}
    </div>
  )
}

export const inputCls =
  'w-full border border-line-strong rounded-lg px-3 py-2.5 text-[14px] bg-surface-alt ' +
  'outline-none focus:border-brand placeholder:text-ink-muted'

export function BotaoPrincipal({
  children, onClick, disabled, type = 'button',
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="w-full bg-brand hover:bg-brand-hover disabled:bg-line-strong
                 disabled:cursor-not-allowed text-cream rounded-xl px-5 py-3.5
                 text-[14.5px] font-semibold transition-colors">
      {children}
    </button>
  )
}

export function Voltar({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-[13px] text-ink-3 hover:text-brand flex items-center gap-1 self-start">
      ‹ {children}
    </button>
  )
}

/** −/＋ com o número no meio. `aria-label` nos dois botões porque o texto
 *  visível é só um símbolo: sem isso, quem usa leitor de tela ouve "menos". */
export function Contador({
  qty, onMudar, rotulo, max,
}: { qty: number; onMudar: (n: number) => void; rotulo: string; max?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onMudar(Math.max(0, qty - 1))} disabled={qty === 0}
        aria-label={`Tirar um ${rotulo}`}
        className="w-8 h-8 rounded-lg border border-line-strong bg-surface text-[16px]
                   text-ink-2 disabled:text-line-strong hover:border-brand">
        −
      </button>
      <span aria-label={`Quantidade de ${rotulo}`}
        className="w-7 text-center text-[14px] font-bold tnum">
        {qty}
      </span>
      <button onClick={() => onMudar(qty + 1)} disabled={max !== undefined && qty >= max}
        aria-label={`Somar um ${rotulo}`}
        className="w-8 h-8 rounded-lg border border-line-strong bg-surface text-[16px]
                   text-ink-2 disabled:text-line-strong hover:border-brand">
        ＋
      </button>
    </div>
  )
}

export function Chip({ children, tom = 'leaf' }: { children: ReactNode; tom?: 'leaf' | 'accent' | 'warn' }) {
  const cls = {
    leaf: 'bg-leaf-bg border-leaf-line text-leaf',
    accent: 'bg-accent-bg border-accent-line text-accent',
    warn: 'bg-warn-bg border-warn-line text-warn',
  }[tom]
  return (
    <span className={`border rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>
      {children}
    </span>
  )
}

export function Aviso({
  tom, children,
}: { tom: 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode }) {
  const cls = {
    ok: 'bg-ok-bg border-ok-line text-ok',
    warn: 'bg-warn-bg border-warn-line text-warn',
    danger: 'bg-danger-bg border-danger-line text-danger',
    info: 'bg-info-bg border-info-line text-info',
  }[tom]
  return (
    <div role={tom === 'danger' ? 'alert' : undefined}
      className={`border rounded-xl px-4 py-3 text-[12.5px] leading-snug ${cls}`}>
      {children}
    </div>
  )
}

/** Cartão de prato e de adicional: foto opcional, porque o catálogo da LifeBox
 *  começa sem foto e a tela não pode ficar quebrada por isso. */
export function Foto({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="w-full aspect-[4/3] rounded-lg bg-muted-bg grid place-items-center
                      text-[22px] text-ink-muted" aria-hidden="true">
        🍽️
      </div>
    )
  }
  return (
    <img src={src} alt={alt} loading="lazy"
      className="w-full aspect-[4/3] rounded-lg object-cover bg-muted-bg" />
  )
}
