import { expect, test, type Locator, type Page } from '@playwright/test'
import './env'
import {
  criarFixturePedido, criarPedidoDireto, lerEstoqueBags,
  limparFixturePedido, setEstoqueBags,
} from './supabaseTest'

/** Montagem de domingo e bags térmicas. Ref: protótipo 11a, 11b, 11c, 11f.
 *
 *  O que se prova aqui: marcar Montado REGISTRA o envio das bags (§6.7). Se as
 *  duas coisas se separarem o saldo mente, e uma bag sumir do controle não dá
 *  erro nenhum — só aparece semanas depois, faltando bag na cozinha.
 *
 *  O ciclo de vida da bag vai num teste só, de ponta a ponta. Quebrado em
 *  vários, cada teste herdava o saldo do anterior e chegou a montar um estado
 *  que a operação não produz (devolução antes do envio, saldo negativo). O
 *  banco passou a recusar isso; o teste não precisa reproduzir.
 *
 *  Saldo e estoque são globais, então nada aqui assume que o banco começa
 *  zerado: mede-se a diferença que ESTE pedido causa. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = Date.now().toString().slice(-6)
const cliente = `Cliente ${marca}`

let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null
let estoqueAntes = 0

async function entrar(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview|semana/, { timeout: 20_000 })
}

const linhaDo = (page: Page) => page.getByRole('row').filter({ hasText: cliente })

/** `exact: true` não é preciosismo aqui: getByRole casa o nome por SUBSTRING,
 *  e "Marcar X como montado" está inteiro dentro de "Desmarcar X como montado".
 *  Sem isso, esperar o botão voltar para "Marcar" passa na hora, com o pedido
 *  ainda montado — o teste seguia e a asserção não valia nada. */
const botao = (dentro: Locator | Page, nome: string) =>
  dentro.getByRole('button', { name: nome, exact: true })

/** Abre a folha e deixa visível a linha do pedido do teste.
 *
 *  A aba padrão é a primeira rota em ordem alfabética e o cliente de teste não
 *  tem rota — cai em "Sem rota", que pode estar em qualquer posição. Procurar
 *  nas abas é o que a equipe faz, e não prende o teste à ordem das rotas
 *  cadastradas na LifeBox. */
async function abrirFolha(page: Page) {
  await page.goto('/montagem')
  await expect(page.getByRole('heading', { name: 'Montagem de domingo' }))
    .toBeVisible({ timeout: 20_000 })

  const linha = linhaDo(page)
  const abas = page.getByRole('button', { name: /parada/ })
  await expect(abas.first()).toBeVisible({ timeout: 20_000 })

  for (let i = 0; i < (await abas.count()); i++) {
    await abas.nth(i).click()
    if (await linha.isVisible()) return linha
  }
  throw new Error(`a parada de ${cliente} não apareceu em nenhuma aba da folha`)
}

async function abrirBags(page: Page) {
  await page.goto('/bags')
  await expect(page.getByRole('heading', { name: /Bags térmicas/ }))
    .toBeVisible({ timeout: 20_000 })
}

const naRua = (page: Page) => page.getByLabel('Na rua')

test.describe('montagem e bags', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.beforeAll(async () => {
    estoqueAntes = await lerEstoqueBags()
    fx = await criarFixturePedido(marca)
    // kitchen notes e delivery notes no mesmo cliente: as duas vão para folhas
    // diferentes, e é justamente isso que o primeiro teste confere.
    if (fx) await criarPedidoDireto(fx, 10, 5, 'Sem cebola', 'Deixar na porta lateral')
  })

  // afterAll, nunca try/finally: teste que estoura o timeout tem o corpo
  // abortado e deixaria pedido e estoque errado no banco da cliente.
  test.afterAll(async () => {
    await setEstoqueBags(estoqueAntes)
    if (fx) await limparFixturePedido(marca, fx.telefone)
  })

  test('folha lista a parada com o pedido inteiro', async ({ page }) => {
    await entrar(page)
    const linha = await abrirFolha(page)

    // o que vai na sacola tem de estar na linha, senão a folha não serve
    await expect(linha).toContainText(`Prato ${marca} ×10`)
    await expect(linha).toContainText(`Bkf ${marca} ×5`)
    await expect(linha).toContainText(`Plano ${marca}`)
    // nota de ENTREGA: é o que o motorista precisa ler
    await expect(linha).toContainText('Deixar na porta lateral')
    // kitchen notes NÃO: essas são da folha da cozinha (§6.8)
    await expect(linha).not.toContainText('Sem cebola')
  })

  test('gelo é conferência separada de montado', async ({ page }) => {
    await entrar(page)
    const linha = await abrirFolha(page)

    await botao(linha, `Marcar gelo de ${cliente}`).click()
    await expect(botao(linha, `Desmarcar gelo de ${cliente}`))
      .toBeVisible({ timeout: 20_000 })
    // montado continua em aberto: marcar gelo não monta o pedido
    await expect(botao(linha, `Marcar ${cliente} como montado`))
      .toBeVisible()

    await page.reload()
    const depois = await abrirFolha(page)
    await expect(botao(depois, `Desmarcar gelo de ${cliente}`))
      .toBeVisible({ timeout: 20_000 })
  })

  test('desmarcar montado desfaz o envio da bag', async ({ page }) => {
    await entrar(page)
    await abrirBags(page)
    const antes = Number(await naRua(page).innerText())

    const linha = await abrirFolha(page)
    await botao(linha, `Marcar ${cliente} como montado`).click()
    await expect(botao(linha, `Desmarcar ${cliente} como montado`))
      .toBeVisible({ timeout: 20_000 })

    await botao(linha, `Desmarcar ${cliente} como montado`).click()
    await expect(botao(linha, `Marcar ${cliente} como montado`))
      .toBeVisible({ timeout: 20_000 })

    // clique errado desfeito por inteiro: o envio sai junto
    await abrirBags(page)
    await expect(naRua(page)).toHaveText(String(antes), { timeout: 20_000 })
    await expect(page.getByRole('listitem').filter({ hasText: cliente })).toHaveCount(0)
  })

  test('ciclo da bag: monta, corrige a quantidade, estoque avisa, devolve', async ({ page }) => {
    await entrar(page)
    await abrirBags(page)
    const antes = Number(await naRua(page).innerText())

    // --- monta: o envio entra junto (§6.7), no bag_qty do pedido (1)
    const linha = await abrirFolha(page)
    await botao(linha, `Marcar ${cliente} como montado`).click()
    await expect(botao(linha, `Desmarcar ${cliente} como montado`))
      .toBeVisible({ timeout: 20_000 })

    await abrirBags(page)
    await expect(naRua(page)).toHaveText(String(antes + 1), { timeout: 20_000 })
    const item = page.getByRole('listitem').filter({ hasText: cliente })
    await expect(item).toContainText('1 bag')

    // --- corrige: fecharam a sacola e foram 2 bags, não 1
    const folha = await abrirFolha(page)
    const campo = folha.getByLabel(`Bags de ${cliente}`)
    await campo.fill('2')
    // esperar a gravação antes de navegar — sair no meio perderia o número.
    // É esse o risco que o campo travado sinaliza para quem está usando.
    const gravou = page.waitForResponse((r) => r.url().includes('fn_marcar_montado'))
    await campo.blur()
    await gravou

    await abrirBags(page)
    await expect(naRua(page)).toHaveText(String(antes + 2), { timeout: 20_000 })

    // --- estoque menor do que o que está na rua: a conta não fecha
    await page.getByRole('button', { name: /informar quantas bags|^editar$/ }).click()
    await page.getByLabel('Estoque total de bags').fill(String(antes + 1))
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByLabel('Estoque total'))
      .toHaveText(String(antes + 1), { timeout: 20_000 })
    await expect(page.getByText(/mais bags na rua do que no estoque/)).toBeVisible()

    // --- devolve as duas
    await item.getByRole('button', { name: 'Registrar devolução' }).click()
    await item.getByLabel(`Bags devolvidas por ${cliente}`).fill('2')
    await item.getByRole('button', { name: 'Confirmar' }).click()

    await expect(naRua(page)).toHaveText(String(antes), { timeout: 20_000 })
    await expect(page.getByRole('listitem').filter({ hasText: cliente })).toHaveCount(0)
    await expect(page.getByText(/mais bags na rua do que no estoque/)).toHaveCount(0)
  })

  /** Depende do teste anterior: o pedido ficou montado e com devolução
   *  registrada. Desmarcar agora deixaria o saldo negativo, o banco recusa —
   *  e a folha tem de DIZER isso. Erro engolido aqui é clique sem efeito e sem
   *  explicação, que na conferência de domingo vira "o sistema travou". */
  test('recusa de desmarcar chega na tela, com o que fazer', async ({ page }) => {
    await entrar(page)
    const linha = await abrirFolha(page)

    await botao(linha, `Desmarcar ${cliente} como montado`).click()

    await expect(page.getByRole('alert')).toContainText(/devolução registrada/i,
      { timeout: 20_000 })
    await expect(page.getByRole('alert')).toContainText(/[Aa]juste a devolução/)
    // e o pedido continua montado: a recusa não fez meio caminho
    await expect(botao(linha, `Desmarcar ${cliente} como montado`)).toBeVisible()
  })
})
