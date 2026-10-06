/* CSV para a equipe abrir no Excel.
 *
 * O BOM não é detalhe: sem ele o Excel no Windows lê o arquivo como ANSI e
 * "Frango assado com creme de espinafre" vira "FranÃ§o assado". A equipe
 * recebe a folha ilegível e acha que o sistema corrompeu o cardápio.
 *
 * O separador é vírgula e todo campo vai entre aspas: nome de prato tem
 * vírgula dentro ("Chicken pesto and pasta bowl (frango, espinafre, ...)") e
 * sem aspas ele quebra a linha em duas colunas, desalinhando a planilha
 * inteira a partir dali. */

export const escaparCSV = (v: unknown) =>
  `"${String(v ?? '').replace(/"/g, '""')}"`

export function montarCSV(cabecalho: string[], linhas: unknown[][]): string {
  return [
    cabecalho.map(escaparCSV).join(','),
    ...linhas.map((l) => l.map(escaparCSV).join(',')),
  ].join('\n')
}

/** Entrega o arquivo ao navegador. */
export function baixarCSV(nomeArquivo: string, conteudo: string) {
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nomeArquivo.endsWith('.csv') ? nomeArquivo : `${nomeArquivo}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
