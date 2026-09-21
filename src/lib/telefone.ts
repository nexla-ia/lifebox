/* Telefone em E.164 — o identificador que cruza cliente e conversa do WhatsApp
 * (§2). Errar aqui não dá erro visível: cria cliente duplicado e faz a
 * automação do n8n não achar o pedido de quem mandou o comprovante.
 *
 * A planilha real da W37 tem os três formatos convivendo na mesma coluna:
 *   "(781) 518-6457"   "774-239-8922"   "7819291049"
 * Todos precisam virar +17815186457. */

/** Normaliza para E.164. null quando não dá para ter certeza — melhor recusar
 *  do que gravar um número que não existe. */
export function normalizarTelefone(bruto: string): string | null {
  const texto = (bruto ?? '').trim()
  if (!texto) return null

  // internacional explícito: confia no que veio, só limpa a formatação
  if (texto.startsWith('+')) {
    const d = texto.slice(1).replace(/\D/g, '')
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null
  }

  const d = texto.replace(/\D/g, '')

  // 10 dígitos = número dos EUA sem o código do país
  if (d.length === 10) return `+1${d}`

  // 11 começando em 1 = EUA com código do país
  if (d.length === 11 && d.startsWith('1')) return `+${d}`

  // qualquer outro tamanho é ambíguo: pode ser erro de digitação ou número de
  // outro país sem o +. Recusar é mais seguro do que chutar o código do país.
  return null
}

/** +15085550164 → "(508) 555-0164". Número não americano volta como está,
 *  porque não sabemos o formato local dele. */
export function formatarTelefone(e164: string): string {
  if (!e164?.startsWith('+1') || e164.length !== 12) return e164 ?? ''
  const d = e164.slice(2)
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

/** Link direto para a conversa no WhatsApp (tela 4b). */
export const linkWhatsApp = (e164: string) =>
  `https://wa.me/${(e164 ?? '').replace(/\D/g, '')}`
