/** Mostrada quando o build subiu sem as variáveis do Supabase.
 *  Existe para que falta de configuração apareça como tela legível e não como
 *  página em branco com erro só no console. */
export function ConfigMissing() {
  return (
    <div className="min-h-screen grid place-items-center bg-cream px-6 py-10">
      <div className="w-full max-w-lg bg-surface border border-line rounded-2xl p-8 shadow-[0_4px_18px_rgba(36,81,59,.07)]">
        <div className="flex items-center gap-0.5 font-bold text-2xl tracking-wide text-brand">
          LIFE
          <span className="inline-flex items-center justify-center w-6 h-6 bg-brand text-lime text-base mx-[3px] rounded-[7px_7px_7px_2px]">
            ✓
          </span>
          BOX
        </div>

        <div className="flex gap-2 bg-warn-bg border border-warn-line text-warn rounded-lg px-3 py-2.5 text-[12.5px] leading-snug mt-5">
          <span aria-hidden>⏰</span>
          <span>
            <strong>Falta conectar ao banco.</strong> Este ambiente subiu sem as
            variáveis do Supabase, então não há de onde carregar os dados.
          </span>
        </div>

        <p className="text-[13px] text-ink-3 leading-relaxed mt-5">
          Defina as duas variáveis abaixo no ambiente onde o app está publicado
          (na Vercel: <strong>Settings → Environment Variables</strong>) e
          publique de novo — a Vercel só injeta variável em build novo.
        </p>

        <ul className="mt-3 space-y-1.5">
          {['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].map((k) => (
            <li
              key={k}
              className="font-mono text-[12.5px] bg-surface-alt border border-line rounded-lg px-3 py-2 text-ink"
            >
              {k}
            </li>
          ))}
        </ul>

        <p className="text-[12px] text-ink-muted leading-relaxed mt-4">
          Os dois valores estão no painel do Supabase, em <strong>Project
          Settings → API</strong>. A <em>anon key</em> é pública e pode ir para o
          front: quem protege os dados é a RLS. A <em>service role key</em> nunca
          entra no front.
        </p>

        <p className="text-[12px] text-ink-muted leading-relaxed mt-3">
          Rodando local, copie <code className="font-mono">.env.example</code> para{' '}
          <code className="font-mono">.env.local</code> e preencha os mesmos dois campos.
        </p>
      </div>
    </div>
  )
}
