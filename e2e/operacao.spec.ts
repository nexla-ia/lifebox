import { expect, test, type Page } from '@playwright/test'
import './env'

/* Perfil Operação (§3), com login de verdade.
 *
 * A RLS dela já estava provada em `rls_test.sql` — mas fingindo o JWT, direto
 * no banco. O que nunca tinha sido exercitado é a TELA: o menu que ela vê, o
 * que acontece quando digita a URL de uma tela que não é dela, e o que ela
 * consegue editar no Catálogo.
 *
 * As duas coisas falham de formas diferentes e as duas importam. A RLS barra
 * dado; o guarda de rota barra tela. Se o guarda falhar e a RLS segurar, a
 * pessoa vê uma tela vazia e acha que o sistema quebrou — e se o guarda
 * segurar mas a RLS não, basta o navegador para passar por cima.
 *
 * §3: Operação tem Semana, Clientes, Catálogo (lê preço, edita prato e menu),
 * Produção, Montagem e Bags. NÃO tem Overview nem Configurações, e não edita
 * preço, metas nem mensagens. */

const email = process.env.E2E_OPERACAO_EMAIL
const senha = process.env.E2E_OPERACAO_SENHA

const PERMITIDAS = ['Semana', 'Clientes', 'Catálogo', 'Produção', 'Montagem', 'Bags']
const PROIBIDAS = ['Overview', 'Configurações']

async function entrar(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/semana|producao|overview/, { timeout: 20_000 })
}

test.describe('perfil Operação', () => {
  test.skip(!email || !senha, 'defina E2E_OPERACAO_EMAIL e E2E_OPERACAO_SENHA para rodar')

  test('o menu tem o que é dela, e só isso', async ({ page }) => {
    await entrar(page)
    const menu = await page.locator('nav').innerText()

    for (const tela of PERMITIDAS) {
      expect(menu, `Operação precisa de ${tela} no menu`).toContain(tela)
    }
    // §3: o Overview é do Administrador, e Configurações também
    for (const tela of PROIBIDAS) {
      expect(menu, `Operação não pode ver ${tela} no menu`).not.toContain(tela)
    }
  })

  test('URL de tela que não é dela devolve acesso negado, não os dados',
    async ({ page }) => {
      // §8: nenhuma tela pode vir em branco. Se vier, o motivo está no
      // console — sem isso a falha diz só "corpo vazio".
      const quebras: string[] = []
      page.on('pageerror', (e) => quebras.push(`pageerror: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() === 'error') quebras.push(`console: ${m.text()}`)
      })

      await entrar(page)

      for (const rota of ['/overview', '/config']) {
        await page.goto(rota)

        // ESPERA a mensagem aparecer, não lê a tela na hora. Ler logo após o
        // goto pega o app antes de montar e acusa "veio em branco" — que é um
        // sintoma real do §8, mas aqui era só pressa do teste. Esperar prova
        // as duas coisas de uma vez: não ficou em branco E barrou.
        await expect(page.getByText(/acesso|permiss|não tem/i).first())
          .toBeVisible({ timeout: 20_000 })

        // e o conteúdo da tela não pode ter vindo junto
        const corpo = await page.locator('main').innerText()
        expect(corpo, `${rota} não pode mostrar conteúdo para a Operação`)
          .not.toMatch(/Faturamento|Ticket médio|Cutoff/)
        expect(quebras, `${rota} quebrou no console`).toEqual([])
      }
    })

  test('no Catálogo ela edita prato e menu, mas não mexe em preço',
    async ({ page }) => {
      await entrar(page)
      await page.goto('/catalogo')
      await expect(page.getByRole('heading', { name: 'Catálogo e menus' }))
        .toBeVisible({ timeout: 20_000 })

      // §3: ela LÊ o preço — esconder o número faria a equipe perguntar
      // quanto custa toda vez que fosse lançar um pedido. A policy é
      // `plan_prices_staff_read`, e Operação é staff.
      //
      // Espera o preço APARECER antes de ler a tela: ler `main` na hora pega
      // "Carregando catálogo…" e acusa falta de permissão onde só faltou
      // tempo — o erro mais caro de diagnosticar num teste de RLS.
      await expect(page.getByText(/\$\d/).first()).toBeVisible({ timeout: 20_000 })

      // mas não tem como alterá-lo
      await expect(page.getByRole('button', { name: /Novo plano|Editar preço/ }))
        .toHaveCount(0)

      // e a parte que é dela continua inteira
      await page.getByRole('button', { name: 'Menus do ciclo' }).click()
      await expect(page.getByRole('heading', { name: 'Ordem do menu' }))
        .toBeVisible({ timeout: 20_000 })
    })

  test('as telas de operação abrem de verdade, com conteúdo', async ({ page }) => {
    await entrar(page)

    // Abrir sem erro não basta: a RLS barra devolvendo VAZIO, sem erro nenhum.
    // Uma tela que carrega e não mostra nada é o modo de falha que mais engana
    // — parece "ainda não tem pedido" quando é permissão faltando.
    for (const [rota, marca] of [
      ['/semana', /Semana/],
      ['/clientes', /Clientes/],
      ['/producao', /Produção/],
      ['/montagem', /Montagem de domingo/],
      ['/bags', /Bags/],
    ] as const) {
      await page.goto(rota)
      await expect(page.getByRole('heading', { name: marca }).first())
        .toBeVisible({ timeout: 20_000 })
      const corpo = (await page.locator('main').innerText()).trim()
      expect(corpo.length, `${rota} abriu vazia para a Operação`).toBeGreaterThan(40)
    }
  })
})
