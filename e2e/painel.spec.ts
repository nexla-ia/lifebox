import { expect, test } from '@playwright/test'
import { criarFixturePedido, limparFixturePedido, limparMeta } from './supabaseTest'

/** Painel da Semana. Ref: protótipo 10a e 9a.
 *
 *  Cria um pedido real, confere os cards, avança o pagamento pelo quadro e
 *  checa o modo planilha. Limpa tudo no afterAll. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = Date.now().toString().slice(-6)

let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null

test.describe('painel da semana', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(async () => { fx = await criarFixturePedido(marca) })
  test.afterAll(async () => {
    if (fx) {
      await limparFixturePedido(marca, fx.telefone)
      await limparMeta(fx.isoCode)
    }
  })

  async function entrar(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(email!)
    await page.getByLabel('Senha').fill(senha!)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.waitForURL(/overview|semana/, { timeout: 20_000 })
    await page.goto('/semana')
  }

  /** O nome do cliente aparece em dois lugares: na lista "Precisa de ação" e
   *  no quadro. Sem escopar, o strict mode acusa dois elementos. */
  const cartaoNoQuadro = (page: import('@playwright/test').Page) =>
    page.locator('section').filter({ hasText: 'Quadro por pagamento' })
      .getByRole('listitem').filter({ hasText: `Cliente ${marca}` })

  async function lancarPedido(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: '＋ Novo pedido' }).click()
    await page.getByLabel('Buscar cliente').fill(`Cliente ${marca}`)
    await page.getByRole('button', { name: new RegExp(`Cliente ${marca}`) }).click()
    await page.getByRole('button', { name: new RegExp(`^Plano ${marca}`) }).click()
    for (let i = 0; i < 10; i++) {
      await page.getByRole('button', { name: `Somar um Prato ${marca}` }).click()
    }
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: `Somar um Bkf ${marca}` }).click()
    }
    await expect(page.getByRole('button', { name: /Salvar pedido · \$147\.60/ }))
      .toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /Salvar pedido/ }).click()
    await expect(page.getByText(/criado/)).toBeVisible({ timeout: 20_000 })
  }

  test('semana vazia mostra "tudo em dia" e nenhum pedido', async ({ page }) => {
    await entrar(page)
    await expect(page.getByRole('heading', { name: 'Precisa de ação agora' }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Tudo em dia')).toBeVisible()
  })

  test('define a meta e o card mostra o percentual', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: /definir meta|editar meta/ }).click()
    await page.getByLabel('Meta da semana').fill('1200.00')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByText(/% da meta de \$1,200\.00/)).toBeVisible({ timeout: 20_000 })
  })

  test('pedido lançado aparece nos cards e no quadro', async ({ page }) => {
    await entrar(page)
    await lancarPedido(page)

    // §6.4: Total Pedidos conta Novo + Renovação
    const total = page.locator('div').filter({ hasText: /^Total Pedidos/ }).first()
    await expect(total).toContainText('1', { timeout: 20_000 })
    await expect(total).toContainText('1 Novo')

    // Pedido novo nasce aguardando pagamento. Checamos pelo BOTÃO que o cartão
    // oferece — comportamento — em vez de pela estrutura da coluna, que é
    // detalhe de layout e muda sem o sistema mudar.
    const cartao = cartaoNoQuadro(page)
    await expect(cartao).toContainText('$147.60', { timeout: 20_000 })
    await expect(cartao.getByRole('button', { name: /→ Comprovante recebido/ })).toBeVisible()
  })

  test('avança o pagamento pelo quadro até confirmado', async ({ page }) => {
    await entrar(page)

    await expect(cartaoNoQuadro(page)).toBeVisible({ timeout: 20_000 })

    await cartaoNoQuadro(page).getByRole('button', { name: /Comprovante recebido/ }).click()
    await expect(cartaoNoQuadro(page).getByRole('button', { name: /Confirmado/ }))
      .toBeVisible({ timeout: 20_000 })

    await cartaoNoQuadro(page).getByRole('button', { name: /Confirmado/ }).click()

    // §6.4: faturado conta só pagamento confirmado — o valor migra de um para o outro
    await expect(page.getByLabel('Faturado')).toHaveText('$147.60', { timeout: 20_000 })
    await expect(page.getByLabel('A receber')).toHaveText('$0.00')
    // e o cartão não oferece mais avanço: confirmado é o fim da fila
    await expect(cartaoNoQuadro(page).getByRole('button', { name: /→/ })).toHaveCount(0)
  })

  test('modo planilha lista o mesmo conteúdo e oferece exportação', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: 'Planilha' }).click()

    const linha = page.getByRole('row').filter({ hasText: `Cliente ${marca}` })
    await expect(linha).toBeVisible({ timeout: 20_000 })
    await expect(linha).toContainText('$147.60')
    await expect(linha).toContainText('Confirmado')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar CSV' }).click()
    const arquivo = await download
    expect(arquivo.suggestedFilename()).toMatch(/lifebox-.*\.csv/)
  })

  test('busca filtra a semana', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: 'Planilha' }).click()
    await expect(page.getByRole('row').filter({ hasText: `Cliente ${marca}` }))
      .toBeVisible({ timeout: 20_000 })

    await page.getByLabel('Buscar na semana').fill('zzz-ninguem')
    await expect(page.getByText('Nenhuma linha nesta semana')).toBeVisible()
  })
})
