import { expect, test } from '@playwright/test'
import './env'

/** Guarda-corpo contra o bug que derrubou o primeiro deploy: o app quebrava no
 *  import quando faltavam as variáveis do Supabase, e a página vinha em branco
 *  com o erro só no console.
 *
 *  A invariante é "nenhuma tela em branco" (§8, tela 9f), e ela vale nos DOIS
 *  estados — com e sem Supabase configurado. Por isso os testes não exigem uma
 *  tela específica: exigem que alguma tela legível apareça e que nada tenha
 *  estourado. Assim eles passam no CI (sem .env) e na máquina de quem já
 *  configurou, sem virar teste frágil. */

const TELAS_VALIDAS = [
  'Falta conectar ao banco.',   // ConfigMissing · sem variáveis
  'acesso da equipe',           // Login · com variáveis
]

async function telaVisivel(page: import('@playwright/test').Page) {
  for (const t of TELAS_VALIDAS) {
    if (await page.getByText(t).isVisible().catch(() => false)) return t
  }
  return null
}

test('a home renderiza uma tela legível, nunca em branco', async ({ page }) => {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push(e.message))

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  expect(erros, `erro de JS derrubou a página: ${erros.join(' | ')}`).toEqual([])

  const tela = await telaVisivel(page)
  expect(tela, 'nem ConfigMissing nem Login apareceram — é a tela branca de novo').not.toBeNull()

  const texto = (await page.locator('body').innerText()).trim()
  expect(texto.length, 'body renderizou vazio').toBeGreaterThan(40)
})

test('rota profunda não devolve 404 (rewrite de SPA)', async ({ page }) => {
  const resp = await page.goto('/semana')
  expect(resp?.status(), 'sem o rewrite do vercel.json, F5 em /semana dá 404').toBeLessThan(400)
  await page.waitForLoadState('networkidle')
  expect(await telaVisivel(page)).not.toBeNull()
})

test('a identidade da marca chegou no bundle', async ({ page }) => {
  await page.goto('/')
  // verde-escuro da marca, token --color-brand do protótipo aprovado
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
  )
  expect(brand.toLowerCase()).toBe('#24513b')
})
