import { expect, test, type Page } from '@playwright/test'
import './env'
import {
  lerCutoff, lerTemplate, limparFormas, limparOrigens, setCutoff, setTemplate,
} from './supabaseTest'

/** Configurações · Origens, Cutoff, Formas de pagamento e Mensagens (§9.8).
 *
 *  Duas destas abas mexem em configuração GLOBAL, sem dono: cutoff e template.
 *  O teste guarda o que estava lá e devolve no afterAll — deixar o cutoff em
 *  segunda 08:00 fecharia o link público da cliente na vida real. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = `zzt-${Date.now().toString().slice(-6)}`

let cutoffAntes = { weekday: 4, hora: '18:00' }
let templateAntes = ''

async function entrar(page: Page, aba: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview|semana/, { timeout: 20_000 })
  await page.goto('/config')
  await expect(page.getByRole('heading', { name: 'Configurações' }))
    .toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: aba, exact: true }).click()
}

test.describe('configurações', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(async () => {
    cutoffAntes = await lerCutoff()
    templateAntes = await lerTemplate('order_confirmation', 'pt')
  })
  test.afterAll(async () => {
    await setCutoff(cutoffAntes.weekday, cutoffAntes.hora)
    if (templateAntes) await setTemplate('order_confirmation', 'pt', templateAntes)
    await limparOrigens(marca)
    await limparFormas(marca)
  })

  test('o link público tem de onde ser copiado, e diz o que falta', async ({ page }) => {
    await entrar(page, 'Link público')

    // o endereço que a equipe manda no WhatsApp
    await expect(page.getByLabel('Link principal'))
      .toHaveValue(/\/pedido$/, { timeout: 20_000 })
    await expect(page.getByLabel('Abrindo direto em português'))
      .toHaveValue(/\/pedido\?lang=pt$/)

    // sem catálogo nem ZIP, o link não fecha pedido — e a tela diz por quê,
    // em vez de deixar a equipe descobrir pelo cliente reclamando
    const checagens = page.getByRole('listitem')
    await expect(checagens.filter({ hasText: 'ZIP code' })).toBeVisible()
    await expect(checagens.filter({ hasText: 'forma' })).toBeVisible()
    await expect(checagens.filter({ hasText: 'prato' })).toBeVisible()

    // e o estado da janela de pedido, que vem do cutoff no servidor
    await expect(page.getByText(/Aberto agora|Fechado/)).toBeVisible()
  })

  test('a aba fica na URL, então recarregar não perde o lugar', async ({ page }) => {
    await entrar(page, 'Mensagens')
    await expect(page).toHaveURL(/aba=mensagens/)
    await page.reload()
    await expect(page.getByLabel('Template em português'))
      .toBeVisible({ timeout: 20_000 })
  })

  test('origem nova entra na lista e o nome repetido é recusado', async ({ page }) => {
    await entrar(page, 'Origens')

    await page.getByLabel('Nome da origem').fill(`Influencer ${marca}`)
    await page.getByRole('button', { name: /Influenciador/ }).click()
    await page.getByRole('button', { name: 'Adicionar' }).click()

    const linha = page.getByRole('listitem').filter({ hasText: `Influencer ${marca}` })
    await expect(linha).toBeVisible({ timeout: 20_000 })
    await expect(linha).toContainText('Influenciador')

    // o nome é único de propósito: repetido somaria a mesma origem em duas
    // linhas do ranking do Overview
    await page.getByLabel('Nome da origem').fill(`Influencer ${marca}`)
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.getByRole('alert')).toContainText('Já existe uma origem', { timeout: 20_000 })
  })

  test('origem sem cliente nenhum pode sair de vez', async ({ page }) => {
    await entrar(page, 'Origens')
    const linha = page.getByRole('listitem').filter({ hasText: `Influencer ${marca}` })
    await linha.getByRole('button', { name: `Remover Influencer ${marca}` }).click()
    await expect(linha).toHaveCount(0, { timeout: 20_000 })
  })

  test('mudar o cutoff move a semana em andamento', async ({ page }) => {
    await entrar(page, 'Cutoff')

    await page.getByLabel('Dia do cutoff').selectOption('3')
    await page.getByLabel('Hora do cutoff').fill('16:30')
    await page.getByRole('button', { name: 'Salvar' }).click()

    // o aviso é o que diz à equipe que a semana ABERTA passou a valer o novo
    // horário — sem ele, parece que só a próxima muda
    await expect(page.getByRole('status')).toContainText(/semana/, { timeout: 20_000 })
    await expect(page.getByRole('status')).toContainText('quarta às 16:30')

    await page.reload()
    await page.getByRole('button', { name: 'Cutoff', exact: true }).click()
    await expect(page.getByLabel('Dia do cutoff')).toHaveValue('3')
    await expect(page.getByLabel('Hora do cutoff')).toHaveValue('16:30')
  })

  test('forma de pagamento nova aparece com instruções nos dois idiomas', async ({ page }) => {
    await entrar(page, 'Formas de pagamento')

    await page.getByRole('button', { name: '＋ Adicionar' }).click()
    await page.getByLabel('Nome da forma em português').fill(`Zelle ${marca}`)
    await page.getByLabel('Instruções em português').fill('Envie para pagamentos@exemplo')
    await page.getByLabel('Instruções em inglês').fill('Send to pagamentos@exemplo')
    await page.getByLabel('Destinatários reconhecidos').fill('pagamentos@exemplo, +15550000000')
    await page.getByRole('button', { name: 'Salvar' }).click()

    const item = page.getByRole('listitem').filter({ hasText: `Zelle ${marca}` })
    await expect(item).toBeVisible({ timeout: 20_000 })
    await expect(item).toContainText('PT: Envie para pagamentos@exemplo')
    await expect(item).toContainText('EN: Send to pagamentos@exemplo')
    await expect(item).toContainText('pagamentos@exemplo, +15550000000')

    // sem nome em inglês, cai no português — Zelle e Venmo se chamam igual
    await expect(item).not.toContainText('EN: Zelle')

    await item.getByRole('button', { name: 'desativar' }).click()
    await expect(item).toContainText('inativo no link público', { timeout: 20_000 })
  })

  test('template: variável entra no cursor e a prévia substitui', async ({ page }) => {
    await entrar(page, 'Mensagens')

    const area = page.getByLabel('Template em português')
    await expect(area).toContainText('{numero_pedido}', { timeout: 20_000 })

    // a prévia mostra o texto como o cliente vai ler, com as chaves resolvidas
    await expect(page.getByText('#W39-0142')).toBeVisible()
    await expect(page.getByText('#W39-0142')).not.toHaveText(/\{/)

    await area.fill('Oi ')
    await page.getByRole('button', { name: '{nome}' }).click()
    await expect(area).toHaveValue('Oi {nome}')
    await expect(page.getByText('Oi Maria')).toBeVisible()

    // variável inventada não passa calada: chegaria entre chaves no WhatsApp
    await area.fill('Oi {nome_do_cliente}')
    await expect(page.getByRole('alert'))
      .toContainText('não é uma variável conhecida', { timeout: 20_000 })

    await page.getByRole('button', { name: 'Salvar template' }).click()
    await expect(page.getByRole('status')).toContainText('Template salvo', { timeout: 20_000 })

    await page.reload()
    await page.getByRole('button', { name: 'Mensagens', exact: true }).click()
    await expect(page.getByLabel('Template em português'))
      .toHaveValue('Oi {nome_do_cliente}', { timeout: 20_000 })
  })
})
