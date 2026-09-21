import { readFileSync } from 'node:fs'

/** Carrega .env.local no process.env antes dos specs lerem.
 *
 *  Sem isto, esquecer de exportar E2E_EMAIL faz os testes PULAREM em silêncio:
 *  a saída fica verde e ninguém percebe que nada rodou. Variável de ambiente
 *  explícita continua tendo prioridade. */
export function carregarEnvLocal() {
  try {
    for (const linha of readFileSync('.env.local', 'utf8').split('\n')) {
      const l = linha.trim()
      if (!l || l.startsWith('#')) continue
      const i = l.indexOf('=')
      if (i < 0) continue
      const chave = l.slice(0, i)
      if (!(chave in process.env)) process.env[chave] = l.slice(i + 1)
    }
  } catch {
    // sem .env.local os testes que dependem de credencial se pulam sozinhos
  }
}

carregarEnvLocal()
