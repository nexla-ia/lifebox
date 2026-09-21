import { expect, test } from '@playwright/test'
import { criarZipTeste, limparClientes, limparZip } from './supabaseTest'

/** Clientes. Ref: protótipo 4a, 4b, 4c, 4d.
 *
 *  Telefones de teste ficam numa faixa fictícia (+1 555 01xx xxxx) para nunca
 *  colidir com cliente real. Limpeza em afterAll, nunca em finally. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = Date.now().toString().slice(-4)

const ZIP_ATENDIDO = '09999'
const criados: string[] = []

async function entrar(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview/, { timeout: 20_000 })
  await page.goto('/clientes')
}

test.describe('clientes', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(() => criarZipTeste(ZIP_ATENDIDO, 'Cidade Teste'))
  test.afterAll(async () => {
    await limparClientes(criados)
    await limparZip(ZIP_ATENDIDO)
  })

  test('ZIP atendido preenche cidade e sugere a rota', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: '＋ Novo cliente' }).click()

    await page.getByLabel('ZIP Code').fill(ZIP_ATENDIDO)
    await page.getByLabel('ZIP Code').blur()

    await expect(page.getByText(/Delivery Available/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/rota .* sugerida/)).toBeVisible()
    await expect(page.getByLabel('Cidade')).toHaveValue('Cidade Teste')
  })

  test('ZIP fora da área avisa, mas deixa cadastrar como lead', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: '＋ Novo cliente' }).click()

    // 02151 é Revere de verdade; a consulta externa traz a cidade mesmo não
    // estando na nossa lista de atendimento
    await page.getByLabel('ZIP Code').fill('02151')
    await page.getByLabel('ZIP Code').blur()

    await expect(page.getByText(/Fora da área de entrega/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/link público recusará o pedido/)).toBeVisible()
    await expect(page.getByLabel('Cidade')).toHaveValue('Revere')
  })

  test('telefone bagunçado vira E.164 e a ficha mostra formatado', async ({ page }) => {
    const fone = `+1555010${marca}`
    criados.push(fone)

    await entrar(page)
    await page.getByRole('button', { name: '＋ Novo cliente' }).click()
    await page.getByLabel('Nome *').fill(`Cliente ${marca}`)
    // digitado do jeito que aparece na planilha real
    await page.getByLabel(/Telefone/).fill(`(555) 010-${marca}`)
    await page.getByLabel('Kitchen Notes').fill('Sem cebola em nenhum prato')
    await page.getByRole('button', { name: 'Salvar cadastro' }).click()

    // caiu na ficha
    await expect(page.getByRole('heading', { name: new RegExp(`Cliente ${marca}`) }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(`(555) 010-${marca}`)).toBeVisible()

    // §6.8: kitchen notes em destaque, porque vão para a folha da cozinha
    await expect(page.getByText('Sem cebola em nenhum prato')).toBeVisible()

    // §6.2: nasce como New Lead
    await expect(page.getByTitle('Primeiro contato')).toBeVisible()
  })

  test('recusa telefone ambíguo em vez de gravar errado', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: '＋ Novo cliente' }).click()
    await page.getByLabel('Nome *').fill('Telefone Curto')
    await page.getByLabel(/Telefone/).fill('555-0164')   // sem DDD
    await page.getByRole('button', { name: 'Salvar cadastro' }).click()

    await expect(page.getByRole('alert')).toContainText(/Telefone inválido/)
  })

  test('telefone repetido avisa em vez de duplicar o cliente', async ({ page }) => {
    await entrar(page)
    await page.getByRole('button', { name: '＋ Novo cliente' }).click()
    await page.getByLabel('Nome *').fill('Clone')
    await page.getByLabel(/Telefone/).fill(`(555) 010-${marca}`)   // mesmo do teste anterior
    await page.getByRole('button', { name: 'Salvar cadastro' }).click()

    // §1: um cliente, muitos pedidos — nunca duplicar cadastro
    await expect(page.getByRole('alert')).toContainText(/Já existe cliente com o telefone/)
  })

  test('busca sem resultado oferece cadastrar com o nome buscado', async ({ page }) => {
    await entrar(page)
    await page.getByLabel('Buscar cliente').fill('zzz-nao-existe')
    await expect(page.getByText(/Nenhum cliente para/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /Cadastrar .zzz-nao-existe./ })).toBeVisible()
  })
})
