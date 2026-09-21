import { expect, test } from '@playwright/test'
import './env'
import { limparMarca } from './supabaseTest'

/** Catálogo ponta a ponta contra o Supabase real.
 *
 *  Só roda com E2E_EMAIL / E2E_SENHA no ambiente. O teste cria dados de
 *  verdade e os apaga no fim — usa sufixo único para nunca colidir com o
 *  catálogo da LifeBox, e o cleanup roda mesmo se a asserção falhar.
 */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const sufixo = `zzt-${Date.now().toString(36)}`

test.describe('catálogo', () => {
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.afterAll(() => limparMarca(sufixo))

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/overview/, { timeout: 20_000 })
  })

  test('cria plano, define preço e mostra o total que o cliente paga', async ({ page }) => {
    await page.goto('/catalogo')
    await expect(page.getByRole('heading', { name: 'Catálogo e menus' })).toBeVisible()

    {
      // --- criar o plano
      await page.getByRole('button', { name: '＋ Novo plano' }).click()
      await page.getByLabel('Nome (PT) *').fill(`Plano ${sufixo}`)
      await page.getByLabel('Nome (EN) *').fill(`Plan ${sufixo}`)
      await page.getByLabel('Refeições no plano *').fill('10')
      await page.getByLabel('Breakfasts no plano').fill('5')
      await page.getByRole('button', { name: 'Salvar plano' }).click()

      // o nome do plano aparece na tabela de planos E na de extras, então o
      // seletor precisa ser escopado à seção, senão casa com duas linhas
      const secaoPlanos = page.locator('section').filter({ hasText: 'Fresh Plans' })
      const linha = secaoPlanos.getByRole('row').filter({ hasText: `Plano ${sufixo}` })
      await expect(linha).toBeVisible({ timeout: 15_000 })
      await expect(linha).toContainText('10 refeições + 5 breakfasts')

      // --- definir o preço base
      await linha.getByRole('button', { name: 'Editar' }).click()
      await linha.getByLabel(`Plano ${sufixo} Small`).fill('128.60')
      await linha.getByRole('button', { name: 'Salvar' }).click()

      // §5.1: base 128.60 + 7% + $10 = $147.60. O valor final é DERIVADO;
      // se um dia a taxa mudar em settings, este número muda junto.
      await expect(linha).toContainText('$128.60', { timeout: 15_000 })
      await expect(linha).toContainText('cliente paga $147.60')

      // --- persistiu mesmo? recarrega do banco
      await page.reload()
      const depois = page.locator('section').filter({ hasText: 'Fresh Plans' })
        .getByRole('row').filter({ hasText: `Plano ${sufixo}` })
      await expect(depois).toContainText('cliente paga $147.60', { timeout: 15_000 })
    }
  })

  test('cria adicional e respeita as chaves de tax, delivery e plano', async ({ page }) => {
    await page.goto('/catalogo')
    {
      await page.getByRole('button', { name: '＋ Adicionar' }).click()
      await page.getByLabel('Nome (PT) *').fill(`Sucos ${sufixo}`)
      await page.getByLabel('Nome (EN) *').fill(`Juices ${sufixo}`)
      await page.getByLabel('Preço *').fill('29.90')
      await page.getByLabel('Só pode ser vendido junto com um plano').check()
      await page.getByRole('button', { name: 'Salvar adicional' }).click()

      const item = page.getByRole('listitem').filter({ hasText: `Sucos ${sufixo}` })
      await expect(item).toBeVisible({ timeout: 15_000 })
      await expect(item).toContainText('$29.90')
      await expect(item).toContainText('sem tax · sem delivery')
      await expect(item).toContainText('só com plano')
    }
  })
})
