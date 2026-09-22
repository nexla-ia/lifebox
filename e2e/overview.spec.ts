import { expect, test, type Page } from '@playwright/test'
import './env'
import {
  criarFixturePedido, criarPedidoDireto, lerOverviewSemana, limparFixturePedido,
  limparMeta,
} from './supabaseTest'

/** Overview · Módulo 2 (§10). Ref: protótipo 8a, 8b, 8c.
 *
 *  O que se prova aqui é a promessa do §10: todo número tem de onde ser
 *  explicado. O drill-down abre a lista por trás do número, e a aba Tabela
 *  mostra a mesma série — se os dois divergissem, um estaria mentindo e não
 *  haveria como saber qual. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = Date.now().toString().slice(-6)

let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null
/** A semana pode já ter pedido de verdade da LifeBox. O teste mede o que o
 *  PRÓPRIO pedido acrescenta — total absoluto quebraria no dia em que alguém
 *  usasse o sistema, sem haver bug. */
let antes = { total_cents: 0, pedidos: 0 }
const money = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

async function entrar(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview|semana/, { timeout: 20_000 })
  await page.goto('/overview')
  await expect(page.getByRole('heading', { name: 'Overview' }))
    .toBeVisible({ timeout: 20_000 })
}

test.describe('overview', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(async () => {
    antes = await lerOverviewSemana()
    fx = await criarFixturePedido(marca)
    if (fx) await criarPedidoDireto(fx, 10, 5)
  })
  test.afterAll(async () => {
    if (fx) {
      await limparFixturePedido(marca, fx.telefone)
      await limparMeta(fx.isoCode)
    }
  })

  test('o Administrador cai na semana corrente com os números do período', async ({ page }) => {
    await entrar(page)

    // §5.6: o pedido do teste acrescenta 128.60 + tax 9.00 + delivery 10.00
    await expect(page.getByLabel('Faturamento', { exact: true }))
      .toHaveText(money(antes.total_cents + 14760), { timeout: 20_000 })
    await expect(page.getByLabel('Total Pedidos', { exact: true }))
      .toHaveText(String(antes.pedidos + 1))
    // ninguém pagou o do teste: ele fica todo em "a receber"
    await expect(page.getByText(`a receber ${money(antes.total_cents + 14760)}`))
      .toBeVisible()
    // sem pedido pago não há ticket médio — e não é zero, é ausência de conta
    await expect(page.getByLabel('Ticket médio', { exact: true })).toHaveText('—')
    await expect(page.getByText('nenhum pedido pago ainda')).toBeVisible()
  })

  test('a meta é o único número digitado, e o card mostra o percentual', async ({ page }) => {
    await entrar(page)

    // meta = o dobro do faturamento da semana, para o card mostrar 50,0%
    const meta = (antes.total_cents + 14760) * 2
    await page.getByLabel('Meta do período').fill((meta / 100).toFixed(2))
    await page.getByRole('button', { name: 'Salvar meta' }).click()
    // getByText, e não getByRole('status'): o cabeçalho tem o "atualizando…",
    // que também é status, e o strict mode acusaria dois
    await expect(page.getByText('Meta salva.')).toBeVisible({ timeout: 20_000 })

    await expect(page.getByText(`50,0% da meta de ${money(meta)}`))
      .toBeVisible({ timeout: 20_000 })
  })

  test('clicar no número abre a lista que o compõe (tela 8c)', async ({ page }) => {
    await entrar(page)

    await page.getByLabel('Total Pedidos', { exact: true }).click()
    const gaveta = page.getByRole('dialog')
    await expect(gaveta).toBeVisible({ timeout: 20_000 })
    await expect(gaveta).toContainText('Total Pedidos')
    await expect(gaveta).toContainText('Novo + Renovação')
    await expect(gaveta).toContainText(`Cliente ${marca}`)
    await expect(gaveta).toContainText('$147.60')

    await gaveta.getByRole('button', { name: 'Fechar' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('a aba Tabela mostra a mesma série, e exporta', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: 'Tabela', exact: true }).click()

    const linha = page.getByRole('row').filter({ hasText: 'Faturamento' })
    await expect(linha).toContainText(money(antes.total_cents + 14760), { timeout: 20_000 })
    await expect(page.getByRole('row').filter({ hasText: 'Total Pedidos' }))
      .toContainText(String(antes.pedidos + 1))
    // o que está fora do total precisa aparecer como linha própria (§6.4)
    await expect(page.getByRole('row').filter({ hasText: '🕒 Skip' })).toBeVisible()

    const baixa = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar CSV' }).click()
    const arquivo = await baixa
    expect(arquivo.suggestedFilename()).toMatch(/lifebox-overview-week-.*\.csv/)
  })

  test('a visão Mês soma as semanas, sem inventar período', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: 'Mês', exact: true }).click()

    // o mês contém a semana do pedido, então o faturamento é pelo menos o dele
    await expect(page.getByLabel('Faturamento', { exact: true }))
      .toContainText('$', { timeout: 20_000 })
    const mes = await page.getByLabel('Faturamento', { exact: true }).innerText()
    expect(Number(mes.replace(/[^0-9.,]/g, '').replace(/,/g, '')))
      .toBeGreaterThanOrEqual((antes.total_cents + 14760) / 100)
  })
})
