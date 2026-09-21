import { expect, test } from '@playwright/test'

/** Login de verdade contra o Supabase configurado.
 *
 *  Só roda quando E2E_EMAIL e E2E_SENHA estão no ambiente — credencial não vai
 *  para o repositório. Sem elas o teste é pulado, então o CI não quebra.
 *
 *    E2E_EMAIL=... E2E_SENHA=... npm run e2e
 */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA

test.describe('login', () => {
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test('entra e cai na tela inicial do perfil, com o menu do papel', async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))

    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()

    // §3: cada perfil entra direto na sua tela
    await page.waitForURL(/overview|semana|producao/, { timeout: 20_000 })

    const menu = await page.locator('nav').innerText()
    // o menu tem que refletir o papel — nem mais, nem menos (§3, screens.ts)
    if (new URL(page.url()).pathname === '/overview') {
      for (const item of ['Overview', 'Semana', 'Clientes', 'Produção', 'Configurações']) {
        expect(menu, `Administrador deveria ver ${item}`).toContain(item)
      }
    }

    expect(erros, `erro de JS na sessão: ${erros.join(' | ')}`).toEqual([])
  })

  test('credencial errada não revela qual campo falhou', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill('senha-que-nao-e-a-certa')
    await page.getByRole('button', { name: 'Entrar' }).click()

    // e não um 500 mudo: o usuário precisa ver o motivo
    await expect(page.getByText('E-mail ou senha inválidos')).toBeVisible({ timeout: 15_000 })
  })
})
