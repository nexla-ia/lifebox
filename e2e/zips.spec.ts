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

  test('a lista explica o que a falta de ZIP faz com o link público', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/overview/, { timeout: 20_000 })
    await page.goto('/config')
    // a aba inicial passou a ser o Link público, que é o que a equipe mais abre
    await page.getByRole('button', { name: 'ZIP Codes', exact: true }).click()

    const lista = page.locator('section').filter({ hasText: 'ZIP codes atendidos' })
    await expect(lista).toBeVisible({ timeout: 15_000 })

    // O banco é o da cliente: ela já pode ter cadastrado as cidades dela, e
    // esvaziar a tabela para forçar o estado vazio seria apagar dado real.
    // Então o teste confere o estado que EXISTE, sem criar nem apagar nada.
    if (await page.getByText('Nenhum ZIP cadastrado').isVisible()) {
      await expect(page.getByText(/recusa todo pedido por estar fora da área/)).toBeVisible()
    } else {
      await expect(lista.getByText(/ZIP codes atendidos · [1-9]/)).toBeVisible()
      await expect(page.getByText('Nenhum ZIP cadastrado')).toHaveCount(0)
    }
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

      // SÓ os ZIPs da cidade importada. Varrer a lista inteira faria o afterAll
      // apagar os ZIPs que a LifeBox já tinha cadastrado — o teste destruiria
      // dado real da cliente para limpar o próprio rastro.
      const importados = await lista.locator('li')
        .filter({ hasText: CIDADE }).locator('strong').allInnerTexts()
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
