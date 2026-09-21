import { expect, test } from '@playwright/test'
import { limparPratos } from './supabaseTest'

/** Menus do ciclo e cadastro de prato. Ref: protótipo 5c, 5d, 5e.
 *
 *  Cria dados reais no Supabase e apaga no fim, com sufixo único. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const sufixo = `zzt-${Date.now().toString(36)}`

// PNG 1x1 válido — só para exercitar o upload ao bucket de verdade
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function entrar(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview/, { timeout: 20_000 })
  await page.goto('/catalogo')
  await page.getByRole('button', { name: 'Menus do ciclo' }).click()
}

test.describe('menus do ciclo', () => {
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  // hook, não try/finally: quando um teste estoura o timeout o Playwright
  // aborta o corpo e o finally não chega a rodar — aí sobra lixo no banco.
  test.afterAll(() => limparPratos(sufixo))

  test('mostra os 4 menus em rotação', async ({ page }) => {
    await entrar(page)
    for (const n of ['Menu 1', 'Menu 2', 'Menu 3', 'Menu 4']) {
      await expect(page.getByRole('button', { name: new RegExp(n) })).toBeVisible()
    }
    await expect(page.getByText(/O ciclo repete a cada 4 semanas/)).toBeVisible()
  })

  test('cadastra prato com nutrição, tag e alérgeno, e liga no menu', async ({ page }) => {
    await entrar(page)
    {
      await page.getByRole('button', { name: '＋ Adicionar prato' }).click()

      await page.getByLabel(/Nome PT/).fill(`Prato ${sufixo}`)
      await page.getByLabel(/Nome EN/).fill(`Dish ${sufixo}`)
      await page.getByLabel('Descrição PT').fill('Descrição de teste')
      await page.getByLabel('Cal').fill('448')
      await page.getByLabel('Prot (g)').fill('33')
      await page.getByLabel('Carbs (g)').fill('44')
      await page.getByLabel('Fat (g)').fill('14')

      // tag e alérgeno vêm do seed base
      await page.getByRole('button', { name: /Sem glúten/ }).click()
      await page.getByRole('button', { name: /Leite/ }).click()

      await page.getByRole('button', { name: 'Salvar prato' }).click()

      const item = page.getByRole('listitem').filter({ hasText: `Prato ${sufixo}` })
      await expect(item).toBeVisible({ timeout: 20_000 })
      await expect(item).toContainText('448 cal')
      await expect(item).toContainText('GF')

      // §5.5: o prato entra ativo no menu aberto
      await expect(item.getByRole('button', { name: /Tirar .* do menu/ })).toBeVisible()

      // persistiu?
      await page.reload()
      await page.getByRole('button', { name: 'Menus do ciclo' }).click()
      await expect(
        page.getByRole('listitem').filter({ hasText: `Prato ${sufixo}` }),
      ).toBeVisible({ timeout: 20_000 })
    }
  })

  test('envia a foto para o Storage e mostra na lista', async ({ page }) => {
    await entrar(page)
    {
      await page.getByRole('button', { name: '＋ Adicionar prato' }).click()
      await page.getByLabel(/Nome PT/).fill(`Foto ${sufixo}`)
      await page.getByLabel(/Nome EN/).fill(`Photo ${sufixo}`)
      await page.getByLabel('Foto do prato').setInputFiles({
        name: 'prato.png', mimeType: 'image/png', buffer: PNG_1PX,
      })
      await page.getByRole('button', { name: 'Salvar prato' }).click()

      const item = page.getByRole('listitem').filter({ hasText: `Foto ${sufixo}` })
      await expect(item).toBeVisible({ timeout: 20_000 })

      // depois do reload a imagem vem do bucket, não do blob local
      await page.reload()
      await page.getByRole('button', { name: 'Menus do ciclo' }).click()
      const img = page.getByRole('listitem').filter({ hasText: `Foto ${sufixo}` }).locator('img')
      await expect(img).toBeVisible({ timeout: 20_000 })
      const src = await img.getAttribute('src')
      expect(src, 'a foto deveria estar no bucket dish-photos').toContain('dish-photos')
    }
  })

  test('tirar prato do menu não apaga o prato', async ({ page }) => {
    await entrar(page)
    {
      await page.getByRole('button', { name: '＋ Adicionar prato' }).click()
      await page.getByLabel(/Nome PT/).fill(`Toggle ${sufixo}`)
      await page.getByLabel(/Nome EN/).fill(`Toggle ${sufixo}`)
      await page.getByRole('button', { name: 'Salvar prato' }).click()

      const item = page.getByRole('listitem').filter({ hasText: `Toggle ${sufixo}` })
      await expect(item).toBeVisible({ timeout: 20_000 })

      // sem pedidos usando, sai direto, sem modal
      await item.getByRole('button', { name: /Tirar .* do menu/ }).click()
      await expect(
        page.getByRole('listitem').filter({ hasText: `Toggle ${sufixo}` })
          .getByRole('button', { name: /Pôr .* no menu/ }),
      ).toBeVisible({ timeout: 20_000 })
    }
  })
})
