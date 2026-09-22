import { expect, test, type Page } from '@playwright/test'
import './env'
import {
  criarAdicionalTeste, criarFixturePedido, criarZipTeste, lerWebhookPedido,
  limparFixturePedido, limparMarca, limparPedidosECliente, limparTentativas,
  limparZip, setWebhookPedido,
} from './supabaseTest'

/** Link público de pedido (§9.7 · telas 6e a 6m).
 *
 *  É a única tela do sistema sem login, então o que se prova aqui é que ela
 *  funciona SEM sessão: o Playwright nunca faz login neste spec. Se algum
 *  caminho precisasse de usuário autenticado, quebraria aqui.
 *
 *  Os números são E.164 de verdade (+1 e 10 dígitos): o servidor recusa o
 *  resto, e o telefone é a chave que cruza cliente e conversa do WhatsApp. */

const marca = Date.now().toString().slice(-6)
const ZIP_OK = '02118'
const ZIP_FORA = '99999'
const telefone = `+1508${marca}1`
const digitado = `508${marca}1`

let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null
let webhookAntes = ''

async function abrir(page: Page, lang?: 'pt') {
  await page.goto(lang ? `/pedido?lang=${lang}` : '/pedido')
  await expect(page.getByRole('button', { name: /Português|English/ }))
    .toBeVisible({ timeout: 20_000 })
}

/** Passo 1 até liberar o botão. Repetido em quase todo teste porque o fluxo
 *  é uma conversa: não dá para entrar no meio por URL, e é de propósito. */
async function identificar(page: Page, tel = digitado) {
  await page.getByLabel('WhatsApp').fill(tel)
  await expect(page.getByLabel('First name')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('First name').fill('Cliente Link')

  // Cliente já cadastrado chega com o endereço salvo e o formulário fechado —
  // é o que a tela 6e promete. Os testes rodam em série sobre o mesmo número,
  // então a partir do primeiro pedido este caminho é o normal.
  if (await page.getByLabel('Delivery address').isVisible()) {
    await page.getByLabel('Delivery address').fill('1 Test St')
    await page.getByLabel('ZIP code').fill(ZIP_OK)
    await page.getByLabel('ZIP code').blur()
  }
  await expect(page.getByText('Delivery available')).toBeVisible({ timeout: 20_000 })
}

/** Sai do passo 1. O rótulo do botão muda quando a pessoa já tem pedido na
 *  semana — "Place another order" em vez de "Choose your plan" — e os testes
 *  rodam em série sobre o mesmo número. */
async function irParaOPlano(page: Page) {
  const b = page.getByRole('button', { name: /Choose your plan|Place another order/ })
  await expect(b).toBeEnabled({ timeout: 20_000 })
  await b.click()
}

test.describe('link público', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    fx = await criarFixturePedido(marca)
    await criarZipTeste(ZIP_OK, 'Boston')
    await criarAdicionalTeste(marca, 2990)
    // o teste fecha pedido de verdade: com o webhook ligado, a automação
    // tentaria mandar WhatsApp para um número inventado a cada rodada
    webhookAntes = await lerWebhookPedido()
    await setWebhookPedido('')
    // o teto por IP é o que trava: uma rodada faz dezenas de identificações
    // da mesma máquina, e duas rodadas em dez minutos estouram
    await limparTentativas()
  })
  test.afterAll(async () => {
    await setWebhookPedido(webhookAntes)
    await limparPedidosECliente(telefone)
    await limparPedidosECliente(`+1508${marca}2`)
    if (fx) await limparFixturePedido(marca, fx.telefone)
    await limparMarca(marca)
    await limparZip(ZIP_OK)
  })

  test('abre sem login, com a semana e o cutoff na faixa', async ({ page }) => {
    await abrir(page)
    await expect(page.getByText(/Week W\d+/)).toBeVisible()
    await expect(page.getByText(/order by/)).toBeVisible()
    await expect(page.getByText(/delivery Sunday/)).toBeVisible()
    // nada de menu da equipe numa página pública
    await expect(page.getByRole('link', { name: 'Semana' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Clientes' })).toHaveCount(0)
  })

  test('idioma troca a tela inteira e fica na URL', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Português' }).click()
    await expect(page.getByRole('heading', { name: 'Vamos começar pelos seus dados' }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/lang=pt/)
    // e volta
    await page.getByRole('button', { name: 'English' }).click()
    await expect(page.getByRole('heading', { name: "Let's start with your details" }))
      .toBeVisible()
  })

  test('ZIP fora da área bloqueia o pedido (tela 6f)', async ({ page }) => {
    await abrir(page)
    await page.getByLabel('WhatsApp').fill(digitado)
    await expect(page.getByLabel('First name')).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('First name').fill('Cliente Link')
    await page.getByLabel('Delivery address').fill('1 Test St')
    await page.getByLabel('ZIP code').fill(ZIP_FORA)
    await page.getByLabel('ZIP code').blur()

    await expect(page.getByText('We do not deliver to this ZIP yet.'))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Choose your plan' })).toBeDisabled()

    // corrigir o ZIP destrava — o bloqueio é do endereço, não do resto
    await page.getByLabel('ZIP code').fill(ZIP_OK)
    await page.getByLabel('ZIP code').blur()
    await expect(page.getByText('Delivery available')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Choose your plan' })).toBeEnabled()
  })

  test('passar do limite do plano avisa com o unitário da faixa (tela 6d)', async ({ page }) => {
    await abrir(page)
    await identificar(page)
    await irParaOPlano(page)

    // tamanho ANTES do plano (reunião de 22/09/2026): o preço de cada plano
    // depende dele, então perguntar o plano primeiro seria escolher no escuro
    await page.getByRole('button', { name: 'Small', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^Plan ${marca}`) }).click()
    await page.getByRole('button', { name: 'Choose your meals' }).click()

    // 10 refeições: o plano do fixture é 10 meals + 5 breakfasts
    const somar = page.getByRole('button', { name: `Somar um Dish ${marca}` })
    for (let i = 0; i < 10; i++) await somar.click()
    await expect(page.getByLabel('meals')).toHaveText(`10 of 10 meals`)
    await expect(page.getByText('You have already picked all the meals in your plan.'))
      .toBeVisible()

    // a 11ª não entra calada: aparece o unitário do catálogo ($10.75)
    await somar.click()
    await expect(page.getByText(/Over the plan/)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/\$10\.75/)).toBeVisible()

    // "Keep 10" não soma
    await page.getByRole('button', { name: /^Keep/ }).click()
    await expect(page.getByLabel('meals')).toHaveText(`10 of 10 meals`)
  })

  test('fluxo inteiro fecha o pedido e o total vem do servidor (telas 6i, 6j)', async ({ page }) => {
    await abrir(page)
    await identificar(page)
    await irParaOPlano(page)
    await page.getByRole('button', { name: 'Small', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^Plan ${marca}`) }).click()
    await page.getByRole('button', { name: 'Choose your meals' }).click()

    // 11 refeições: a 11ª entra como extra, de olho no valor (tela 6d)
    const somar = page.getByRole('button', { name: `Somar um Dish ${marca}` })
    for (let i = 0; i < 10; i++) await somar.click()
    await somar.click()
    await page.getByRole('button', { name: 'Add as extra' }).click()
    await expect(page.getByLabel('meals')).toHaveText('11 of 10 meals')

    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: `Somar um Bkf ${marca}` }).click()
    }
    await expect(page.getByLabel('breakfasts')).toHaveText('5 of 5 breakfasts')

    await page.getByRole('button', { name: 'See add-ons' }).click()
    await page.getByRole('button', { name: `Somar um Juice ${marca}` }).click()
    await page.getByRole('button', { name: 'Review order' }).click()

    // §5.6, o caso de $189.00 que o §11 manda testar:
    //   plano 128.60 + extra 10.75 = 139.35 · tax 7% = 9.75 · delivery 10.00
    //   + suco 29.90 (sem tax e sem delivery) = 189.00
    // Os números são do seed de exemplo; o que se testa é a fórmula.
    // o nome do adicional aparece no resumo E na conta; escopar na conta é o
    // que faz a asserção ser sobre o detalhamento, e não sobre o resumo acima
    const conta = page.locator('section').filter({ hasText: 'Subtotal' })
    await expect(conta).toContainText('$139.35', { timeout: 20_000 })
    await expect(conta).toContainText('$9.75')
    await expect(conta).toContainText('$10.00')
    await expect(conta).toContainText('Extra meal ×1')
    await expect(page.getByLabel('Total')).toHaveText('$189.00')

    // o adicional sem tax vem depois do delivery, com o aviso (tela 6i)
    await expect(conta).toContainText(`Juice ${marca} · no tax/delivery`)
    // e o rótulo saiu do catálogo em inglês, não do name_snapshot em português
    await expect(page.getByText(`Suco ${marca}`)).toHaveCount(0)

    await page.getByRole('button', { name: 'Place order' }).click()
    await expect(page.getByRole('heading', { name: 'Order placed!' }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/#W\d+-\d{4}/)).toBeVisible()
    await expect(page.getByText('$189.00')).toBeVisible()
  })

  test('o plano só aparece depois do tamanho, e já com o preço dele', async ({ page }) => {
    await abrir(page)
    await identificar(page)
    await irParaOPlano(page)

    // sem tamanho escolhido não há plano na tela: o preço seria um chute
    await expect(page.getByRole('button', { name: new RegExp(`^Plan ${marca}`) }))
      .toHaveCount(0)

    await page.getByRole('button', { name: 'Small', exact: true }).click()
    const plano = page.getByRole('button', { name: new RegExp(`^Plan ${marca}`) })
    await expect(plano).toBeVisible({ timeout: 20_000 })
    await expect(plano).toContainText('$128.60')

    // "Só Detox / adicionais" saiu: Detox virou adicional dentro de um plano
    await expect(page.getByRole('button', { name: /Detox \/ add-ons only/ })).toHaveCount(0)
  })

  test('breakfast só aparece quando o plano tem breakfast', async ({ page }) => {
    await abrir(page)
    await identificar(page)
    await irParaOPlano(page)
    await page.getByRole('button', { name: 'Small', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^Plan ${marca}`) }).click()
    await page.getByRole('button', { name: 'Choose your meals' }).click()

    // o plano do fixture tem 5 breakfasts, então o prato de breakfast aparece
    await expect(page.getByRole('button', { name: `Somar um Bkf ${marca}` }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel('breakfasts')).toContainText('of 5 breakfasts')
  })

  test('retirar na cozinha dispensa endereço e não cobra delivery', async ({ page }) => {
    await abrir(page)
    await page.getByLabel('WhatsApp').fill(`508${marca}2`)
    await expect(page.getByLabel('First name')).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('First name').fill('Vai Retirar')

    await page.getByRole('button', { name: /Pick-up at the kitchen/ }).click()
    // o endereço some: quem retira não vai para rota nenhuma
    await expect(page.getByLabel('Delivery address')).toHaveCount(0)
    await expect(page.getByLabel('ZIP code')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Choose your plan' })).toBeEnabled()

    await irParaOPlano(page)
    await page.getByRole('button', { name: 'Small', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^Plan ${marca}`) }).click()
    await page.getByRole('button', { name: 'Choose your meals' }).click()
    for (let i = 0; i < 10; i++) {
      await page.getByRole('button', { name: `Somar um Dish ${marca}` }).click()
    }
    await page.getByRole('button', { name: 'See add-ons' }).click()
    await page.getByRole('button', { name: 'Review order' }).click()

    // §6.6: 128.60 + tax 9.00, SEM os 10.00 de entrega
    const conta = page.locator('section').filter({ hasText: 'Subtotal' })
    await expect(page.getByLabel('Total')).toHaveText('$137.60', { timeout: 20_000 })
    await expect(conta).not.toContainText('Delivery')
  })

  test('quem já tem pedido vê o que existe e pode fazer outro (tela 6m)', async ({ page }) => {
    await abrir(page)
    await page.getByLabel('WhatsApp').fill(digitado)

    await expect(page.getByText('You already have an order this week'))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/#W\d+-\d{4}/)).toBeVisible()
    // não bloqueia mais: o botão vira "fazer outro" (reunião de 22/09/2026)
    await expect(page.getByRole('button', { name: 'Place another order' }))
      .toBeVisible()
  })
})
