import { expect, test, type Page } from '@playwright/test'
import './env'
import { removerUsuarioTeste } from './supabaseTest'

/** Usuários e primeiro acesso (§3 · telas 9d e 9e).
 *
 *  O teste vai até o fim: o Administrador convida, o convidado abre o link SEM
 *  sessão, define a senha e cai logado na tela do perfil dele. É o único jeito
 *  de provar que o convite abre acesso de verdade — o SQL prova a regra, mas
 *  não prova que a pessoa consegue entrar.
 *
 *  O usuário criado é removido no afterAll, e só sai porque nunca lançou nada:
 *  fn_remover_usuario recusa quem tem histórico. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const marca = Date.now().toString().slice(-6)
const convidado = `zzt-${marca}@teste.lifebox`
const nomeConvidado = `Convidada ${marca}`
const senhaNova = `senha-teste-${marca}`

let linkConvite = ''

async function entrarAdmin(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview|semana/, { timeout: 20_000 })
  await page.goto('/config')
  await page.getByRole('button', { name: 'Usuários', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Usuários · \d+/ }))
    .toBeVisible({ timeout: 20_000 })
}

const linhaDo = (page: Page) =>
  page.getByRole('row').filter({ hasText: nomeConvidado })

test.describe('usuários e convite', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test.afterAll(async () => { await removerUsuarioTeste(convidado) })

  test('convidar gera o link e o usuário entra como pendente', async ({ page }) => {
    await entrarAdmin(page)

    await page.getByRole('button', { name: '＋ Convidar' }).click()
    await page.getByLabel('Nome do convidado').fill(nomeConvidado)
    await page.getByLabel('E-mail do convidado').fill(convidado)
    await page.getByLabel('Perfil do convidado').selectOption('cozinha')
    await page.getByRole('button', { name: 'Gerar convite' }).click()

    const campo = page.getByLabel('Link do convite')
    await expect(campo).toBeVisible({ timeout: 20_000 })
    linkConvite = await campo.inputValue()
    expect(linkConvite).toContain('/convite/')

    // o prazo e o uso único têm de estar na tela de quem vai mandar o link
    await expect(page.getByText(/7 dias e serve uma vez só/)).toBeVisible()

    await expect(linhaDo(page)).toContainText('convite pendente')
    await expect(linhaDo(page)).toContainText(convidado)
  })

  test('o Administrador não mexe no próprio acesso', async ({ page }) => {
    await entrarAdmin(page)
    const eu = page.getByRole('row').filter({ hasText: '· você' })
    await expect(eu).toContainText('outro Administrador altera')
    await expect(eu.getByRole('button', { name: 'desativar' })).toHaveCount(0)
  })

  test('o link abre sem sessão e diz quem convidou e para quê', async ({ page }) => {
    await page.goto(linkConvite)

    await expect(page.getByRole('heading', { name: new RegExp(`Bem-vinda\\(o\\), Convidada`) }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/te convidou/)).toBeVisible()
    await expect(page.getByText('Cozinha')).toBeVisible()
    // o e-mail vem do token: quem abre não digita o próprio endereço
    await expect(page.getByLabel('E-mail')).toHaveValue(convidado)
    // e nada de menu da equipe numa tela de quem ainda não entrou
    await expect(page.getByRole('link', { name: 'Semana' })).toHaveCount(0)
  })

  test('a regra da senha aparece antes de apertar o botão', async ({ page }) => {
    await page.goto(linkConvite)
    const botao = page.getByRole('button', { name: 'Definir senha e entrar' })
    await expect(botao).toBeDisabled({ timeout: 20_000 })

    await page.getByLabel('Criar senha').fill('curta')
    await expect(page.getByRole('status')).toContainText('pelo menos 8 caracteres')
    await expect(botao).toBeDisabled()

    await page.getByLabel('Criar senha').fill(senhaNova)
    await page.getByLabel('Repetir senha').fill('outra-coisa')
    await expect(page.getByRole('status')).toContainText('ainda não conferem')
    await expect(botao).toBeDisabled()

    await page.getByLabel('Repetir senha').fill(senhaNova)
    await expect(page.getByRole('status')).toContainText('as duas senhas conferem')
    await expect(botao).toBeEnabled()
  })

  test('definir a senha entra direto na tela do perfil', async ({ page }) => {
    await page.goto(linkConvite)
    await page.getByLabel('Criar senha').fill(senhaNova)
    await page.getByLabel('Repetir senha').fill(senhaNova)
    await page.getByRole('button', { name: 'Definir senha e entrar' }).click()

    // Cozinha cai na Produção (§3), sem passar pela tela de login. E vê a
    // folha da bancada (3c), não a visão da Operação.
    await page.waitForURL(/producao/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /PRODUÇÃO — W\d+/ }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(nomeConvidado)).toBeVisible()

    // o papel veio do convite: o menu dela não tem mais nada (§3)
    const menu = await page.locator('nav').innerText()
    expect(menu).toContain('Produção')
    for (const proibido of ['Overview', 'Semana', 'Clientes', 'Catálogo', 'Configurações']) {
      expect(menu, `Cozinha não pode ver ${proibido}`).not.toContain(proibido)
    }
  })

  test('o mesmo link não serve duas vezes', async ({ page }) => {
    await page.goto(linkConvite)
    await expect(page.getByRole('heading', { name: 'Convite inválido ou expirado' }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Peça um novo link/)).toBeVisible()
  })

  test('o Administrador desativa e o status muda', async ({ page }) => {
    await entrarAdmin(page)
    await expect(linhaDo(page)).toContainText('ativo')
    await linhaDo(page).getByRole('button', { name: 'desativar' }).click()
    await expect(linhaDo(page)).toContainText('desativado', { timeout: 20_000 })
  })

  // teste à parte, e não continuação do anterior, porque precisa de contexto
  // SEM sessão: com o admin logado, "/" redireciona para a tela dele e o
  // formulário de login some no meio do clique
  test('desativado não entra, mesmo com a senha certa', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('E-mail').fill(convidado)
    await page.getByLabel('Senha').fill(senhaNova)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.getByRole('alert'))
      .toContainText('Este acesso foi desativado', { timeout: 20_000 })
    // e não é só o aviso: não chegou a nenhuma tela do sistema
    await expect(page).toHaveURL(/\/$|login/)
  })
})
