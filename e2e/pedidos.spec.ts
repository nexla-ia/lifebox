import { expect, test } from '@playwright/test'
import './env'
import { criarFixturePedido, lerOverviewSemana, limparFixturePedido } from './supabaseTest'

/** Pedido ponta a ponta: monta na tela e confere o total.
 *
 *  É o teste mais importante do projeto — prova a corrente inteira: menu da
 *  semana → seleção → trava de quantidade → cálculo NO SERVIDOR → gravação com
 *  snapshot. O total esperado vem do §5.6, não de somar no teste. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = Date.now().toString().slice(-6)

let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null
// a semana é da cliente e já tem pedido dela: mede-se a diferença
let antes = { total_cents: 0, pedidos: 0 }

test.describe('pedidos', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(async () => {
    antes = await lerOverviewSemana()
    fx = await criarFixturePedido(marca)
  })
  test.afterAll(async () => {
    if (fx) await limparFixturePedido(marca, fx.telefone)
  })

  async function abrirFicha(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/overview|semana/, { timeout: 20_000 })
    await page.goto('/semana')
    await page.getByRole('button', { name: '＋ Novo pedido' }).click()
    await expect(page.getByRole('heading', { name: 'Ficha do pedido' })).toBeVisible()
  }

  /** O valor aparece no resumo E no botão de salvar, então o seletor precisa
   *  ser escopado — senão o strict mode acusa dois elementos. */
  const totalNoResumo = (page: import('@playwright/test').Page) =>
    page.locator('section').filter({ hasText: 'Resumo' }).getByText(/^\$/).last()

  async function montarPlano(page: import('@playwright/test').Page, refeicoes: number) {
    await page.getByLabel('Buscar cliente').fill(`Cliente ${marca}`)
    await page.getByRole('button', { name: new RegExp(`Cliente ${marca}`) }).click()
    await page.getByRole('button', { name: new RegExp(`^Plano ${marca}`) }).click()
    for (let i = 0; i < refeicoes; i++) {
      await page.getByRole('button', { name: `Somar um Prato ${marca}` }).click()
    }
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: `Somar um Bkf ${marca}` }).click()
    }
  }

  test('plano exato: total = base + tax + delivery, calculado no servidor', async ({ page }) => {
    await abrirFicha(page)
    await montarPlano(page, 10)

    // §5.1/§5.6 — 12860 + 7% (900) + 1000 = 14760
    await expect(totalNoResumo(page)).toHaveText('$147.60', { timeout: 20_000 })
    await expect(page.getByText('10 de 10 refeições')).toBeVisible()
    // sem extra, nenhum aviso
    await expect(page.getByText('Passou do plano.')).toHaveCount(0)
  })

  test('passar do limite avisa e cobra o extra da faixa', async ({ page }) => {
    await abrirFicha(page)
    await montarPlano(page, 11)

    // §9.2: a trava não aceita em silêncio
    await expect(page.getByText('Passou do plano.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('11 de 10 refeições · 1 extra')).toBeVisible()
    // 12860 + 1075 = 13935 tributável → tax 975 → +1000 = 15910
    await expect(totalNoResumo(page)).toHaveText('$159.10')
  })

  test('grava o pedido com o total do servidor e classifica como Novo Pedido',
    async ({ page }) => {
      await abrirFicha(page)
      await montarPlano(page, 11)
      await expect(totalNoResumo(page)).toHaveText('$159.10', { timeout: 20_000 })

      await page.getByRole('button', { name: /Salvar pedido · \$159\.10/ }).click()

      // volta para a Semana com o código do pedido. Não checamos "-0001": a
      // numeração é por semana e depende de quantos pedidos já existem, o que
      // faria o teste depender de estado global.
      await expect(page.getByText(/Pedido \w+-\d{4} criado/)).toBeVisible({ timeout: 20_000 })

      // o pedido aparece no quadro por pagamento, classificado (§6.3)
      const cartao = page.locator('section').filter({ hasText: 'Quadro por pagamento' })
        .getByRole('listitem').filter({ hasText: `Cliente ${marca}` })
      await expect(cartao).toContainText('Novo Pedido', { timeout: 20_000 })
      await expect(cartao).toContainText('$159.10')

      // §6.4: Skip, Cancelamento e Parceria ficam fora; este conta
      await expect(page.getByText(/Total Pedidos/)).toBeVisible()
    })

  // Reunião de 22/09/2026: o mesmo cliente pode ter mais de um pedido na
  // semana — pedir para si e depois para alguém da casa é o caso real. O que
  // importa provar é que o segundo NÃO some do dinheiro: a versão anterior do
  // resumo somava atravessando customer_weeks.order_id, que aponta para um só.
  test('segundo pedido do mesmo cliente entra, e o dinheiro dos dois aparece', async ({ page }) => {
    await abrirFicha(page)
    await montarPlano(page, 10)
    await expect(totalNoResumo(page)).toHaveText('$147.60', { timeout: 20_000 })
    await page.getByRole('button', { name: /Salvar pedido/ }).click()
    await expect(page.getByText(/Pedido \w+-\d{4} criado/)).toBeVisible({ timeout: 20_000 })

    // o card conta PEDIDOS; o rodapé diz de quantos CLIENTES, para o número
    // não parecer erro de conta. Os dois pedidos deste spec são do MESMO
    // cliente: +2 pedidos, +1 cliente.
    const total = page.locator('div').filter({ hasText: /^Total Pedidos/ }).first()
    await expect(total).toContainText(String(antes.pedidos + 2), { timeout: 20_000 })
    await expect(total).toContainText('clientes — alguém pediu mais de uma vez')

    // nenhum dos dois foi pago, então os dois estão em "A receber": é aí que
    // o segundo sumiria se o resumo continuasse somando por customer_weeks
    const money = (c: number) =>
      (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    await expect(page.getByLabel('A receber'))
      .toHaveText(money(antes.total_cents + 15910 + 14760))
  })
})
