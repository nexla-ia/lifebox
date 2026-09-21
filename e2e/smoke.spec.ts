import { expect, test } from '@playwright/test'

/** Guarda-corpo contra o bug que derrubou o primeiro deploy: o app quebrava no
 *  import quando faltavam as variáveis do Supabase, e a página vinha em branco
 *  com o erro só no console. Nenhuma tela do sistema pode ser branca (§8, 9f).
 *
 *  Estes testes rodam SEM as variáveis de propósito — é o cenário do deploy
 *  recém-criado, antes de conectar o banco. */

test('sem configuração, mostra a tela de configuração e não uma página em branco', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/')

  await expect(page.getByText('Falta conectar ao banco.')).toBeVisible()
  await expect(page.getByText('VITE_SUPABASE_URL')).toBeVisible()
  await expect(page.getByText('VITE_SUPABASE_ANON_KEY')).toBeVisible()

  expect(erros, `erro de JS derrubou a página: ${erros.join(' | ')}`).toEqual([])
})

test('a página tem conteúdo visível, não um body vazio', async ({ page }) => {
  await page.goto('/')
  const texto = (await page.locator('body').innerText()).trim()
  expect(texto.length, 'body renderizou vazio — é a tela branca de novo').toBeGreaterThan(80)
})

test('rota profunda não devolve 404 (rewrite de SPA)', async ({ page }) => {
  const resp = await page.goto('/semana')
  expect(resp?.status()).toBeLessThan(400)
  await expect(page.getByText('Falta conectar ao banco.')).toBeVisible()
})
