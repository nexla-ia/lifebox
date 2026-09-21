/* Campos numéricos.
 *
 * `inputMode="numeric"` só escolhe o teclado do celular — no computador a
 * pessoa digita letra igual. E `type="number"` traz junto as setinhas, o
 * scroll que muda o valor sem querer e um comportamento de vírgula que varia
 * com o idioma do navegador.
 *
 * Então o campo continua sendo texto e o que não é número é descartado na
 * digitação: a letra simplesmente não aparece. Recusar na hora é mais claro do
 * que aceitar e reclamar no "Salvar" — ali a pessoa já esqueceu o que digitou.
 */

/** Quantidade: só dígitos. Serve para refeições no plano, bags, calorias. */
export function apenasDigitos(bruto: string): string {
  return bruto.replace(/\D/g, '')
}

/** Dinheiro e medida: dígitos com UM separador decimal.
 *
 *  Aceita vírgula e ponto porque a equipe é brasileira e o teclado do celular
 *  costuma dar vírgula; devolve sempre com o ponto, que é o que `Number()` lê.
 *  Segundo separador é ignorado — "12.3.4" vira "12.34", não NaN. */
export function apenasDecimal(bruto: string, casas = 2): string {
  const limpo = bruto.replace(/[^\d.,]/g, '').replace(/,/g, '.')
  const [inteira, ...resto] = limpo.split('.')
  if (resto.length === 0) return inteira
  return `${inteira}.${resto.join('').slice(0, casas)}`
}
