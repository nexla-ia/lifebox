import { expect, test } from '@playwright/test'
import './env'
import { criarFixturePedido, criarPedidoDireto, limparFixturePedido } from './supabaseTest'

/** Produção da cozinha. Ref: protótipo 3a, 3b, 3c, 3d.
 *
 *  O teste mais importante aqui não é a contagem: é o que a Cozinha NÃO
 *  alcança. §3 diz que ela vê só a Produção, sem valores, contatos ou
 *  endereços — e quem garante isso é a RLS, não o menu. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const emailCozinha = process.env.E2E_COZINHA_EMAIL
const senhaCozinha = process.env.E2E_COZINHA_SENHA
const marca = Date.now().toString().slice(-6)

let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null

async function login(page: import('@playwright/test').Page, e: string, s: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(e)
  await page.getByLabel('Senha').fill(s)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview|semana|producao/, { timeout: 20_000 })
}

test.describe('produção', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(async () => {
    fx = await criarFixturePedido(marca)
    if (fx) {
      // 11 refeições + 5 breakfasts, com kitchen notes no cliente
      await criarPedidoDireto(fx, 11, 5, 'Sem cebola em nenhum prato')
    }
  })
  test.afterAll(async () => { if (fx) await limparFixturePedido(marca, fx.telefone) })

  test('agregada soma por prato e tamanho', async ({ page }) => {
    await login(page, email!, senha!)
    await page.goto('/producao')

    await expect(page.getByRole('heading', { name: 'Produção da cozinha' }))
      .toBeVisible({ timeout: 20_000 })
    // 11 + 5 = 16 itens que a cozinha produz
    await expect(page.getByText(/16 itens/)).toBeVisible()

    // linha da tabela, não a div do bloco: papel semântico não muda com o layout
    const linha = page.getByRole('row').filter({ hasText: `Prato ${marca}` })
    await expect(linha).toContainText('11', { timeout: 20_000 })
    const bkf = page.getByRole('row').filter({ hasText: `Bkf ${marca}` })
    await expect(bkf).toContainText('5')
  })

  test('kitchen notes aparecem no topo da folha', async ({ page }) => {
    await login(page, email!, senha!)
    await page.goto('/producao')
    await expect(page.getByText('KITCHEN NOTES')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Sem cebola em nenhum prato')).toBeVisible()
  })

  test('adicionais não entram na folha — saem do estoque (§5.4)', async ({ page }) => {
    await login(page, email!, senha!)
    await page.goto('/producao')
    await expect(page.getByText(/não entram na folha/)).toBeVisible({ timeout: 20_000 })
  })

  test('matriz mostra prato × cliente para a Operação', async ({ page }) => {
    await login(page, email!, senha!)
    await page.goto('/producao')
    await page.getByRole('button', { name: 'matriz' }).click()

    await expect(page.getByRole('cell', { name: `Prato ${marca}` }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Cliente/).first()).toBeVisible()
  })

  test.describe('perfil Cozinha', () => {
    test.skip(!emailCozinha || !senhaCozinha,
      'defina E2E_COZINHA_EMAIL e E2E_COZINHA_SENHA para rodar')

    test('entra direto na Produção e o menu não tem mais nada', async ({ page }) => {
      await login(page, emailCozinha!, senhaCozinha!)
      await expect(page).toHaveURL(/producao/)

      const menu = await page.locator('nav').innerText()
      expect(menu).toContain('Produção')
      // §3: nada além da Produção
      for (const proibido of ['Overview', 'Semana', 'Clientes', 'Catálogo', 'Configurações']) {
        expect(menu, `Cozinha não pode ver ${proibido} no menu`).not.toContain(proibido)
      }
    })

    test('vê a contagem e as restrições, sem valores', async ({ page }) => {
      await login(page, emailCozinha!, senhaCozinha!)
      // esperar a folha carregar antes de ler o texto, senão o assert pega
      // "Carregando a semana…" e falha sem haver bug
      await expect(page.getByText('KITCHEN NOTES')).toBeVisible({ timeout: 20_000 })
      const texto = await page.locator('main').innerText()

      expect(texto).toContain('PRODUÇÃO')
      expect(texto).toContain('Sem cebola em nenhum prato')
      // sem valor nenhum na tela
      expect(texto, 'a Cozinha não pode ver preço').not.toMatch(/\$\d/)
    })

    test('não tem a matriz, que mostraria nome de cliente', async ({ page }) => {
      await login(page, emailCozinha!, senhaCozinha!)
      await expect(page.getByRole('button', { name: 'matriz' })).toHaveCount(0)
    })

    test('URL de outra tela devolve acesso negado, não os dados', async ({ page }) => {
      await login(page, emailCozinha!, senhaCozinha!)
      await page.goto('/semana')
      await expect(page.getByText('Esta tela não é do seu perfil'))
        .toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(`Cliente ${marca}`)).toHaveCount(0)
    })
  })
})
