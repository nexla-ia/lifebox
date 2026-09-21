import { expect, test } from '@playwright/test'
import './env'
import { limparZips } from './supabaseTest'

/** Importação de ZIPs por cidade. Ref: protótipo 9d.
 *
 *  A LifeBox sabe as cidades que atende, não os CEPs — este é o caminho que
 *  transforma 27 nomes de cidade em ~84 ZIPs. Bate numa API pública de
 *  verdade (api.zippopotam.us); se ela estiver fora, o teste falha e isso é
 *  informação útil, não ruído. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA

// Medway tem poucos ZIPs — teste rápido e limpeza trivial
const CIDADE = 'Medway'
const paraLimpar: string[] = []

test.describe('ZIP codes', () => {
  // em série e nesta ordem: um teste exige a lista vazia e o outro a enche.
  // Em paralelo eles disputam o mesmo estado e um falha sem haver bug.
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  // hook em vez de finally: timeout de teste aborta o corpo antes do finally
  test.afterAll(() => limparZips(paraLimpar))

  test('lista vazia avisa que o link público recusa tudo', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/overview/, { timeout: 20_000 })
    await page.goto('/config')
    // a aba inicial passou a ser o Link público, que é o que a equipe mais abre
    await page.getByRole('button', { name: 'ZIP Codes', exact: true }).click()

    await expect(page.getByText('Nenhum ZIP cadastrado')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/recusa todo pedido por estar fora da área/)).toBeVisible()
  })

  test('importa todos os ZIPs de uma cidade de uma vez', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/overview/, { timeout: 20_000 })

    await page.getByRole('link', { name: /Configurações/ }).click()
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
    await page.getByRole('button', { name: 'ZIP Codes', exact: true }).click()

    {
      await page.getByLabel('Cidade (Massachusetts)').fill(CIDADE)
      await page.getByRole('button', { name: 'Buscar ZIPs' }).click()

      const previa = page.locator('section').filter({ hasText: 'Importar por cidade' })
      await expect(previa.getByText(new RegExp(`ZIPs em ${CIDADE}`))).toBeVisible({ timeout: 15_000 })

      await previa.getByRole('button', { name: /^Importar para/ }).click()

      // a lista passa a contar os ZIPs — prova que gravou no banco
      const lista = page.locator('section').filter({ hasText: 'ZIP codes atendidos' })
      await expect(lista.getByText(new RegExp(`ZIP codes atendidos · [1-9]`))).toBeVisible({ timeout: 15_000 })
      await expect(lista.getByText(CIDADE).first()).toBeVisible()

      const importados = await lista.locator('li strong').allInnerTexts()
      paraLimpar.push(...importados)
      expect(importados.length).toBeGreaterThan(0)

      // persistiu? recarrega do banco
      await page.reload()
      await expect(
        page.locator('section').filter({ hasText: 'ZIP codes atendidos' })
          .getByText(CIDADE).first(),
      ).toBeVisible({ timeout: 15_000 })
    }
  })

})
