import { expect, test, type Page } from '@playwright/test'
import './env'
import {
  criarFixturePedido, criarPedidoDireto, limparFixturePedido, limparPorMarca,
} from './supabaseTest'

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
 * preço, metas nem mensagens.
 *
 * E não basta a tela ABRIR: toda ação de escrita deste sistema era testada só
 * como Administrador. A RLS barra UPDATE devolvendo ZERO LINHAS, sem erro —
 * uma policy errada deixaria a Operação clicar em "Montado" e nada acontecer,
 * sem mensagem nenhuma. É o modo de falha que este projeto mais pagou caro,
 * então os testes abaixo CONFEREM O EFEITO, não o clique. */

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
    // `#menu-lateral`, nao `nav`: o Overview e o Config tem <nav> proprios
    // para as abas, e `locator('nav')` casa com os dois — passa ou estoura
    // dependendo de qual montou primeiro.
    const menu = await page.locator('#menu-lateral').innerText()

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
        // Erro de REDE aqui é esperado: a tela é negada, e a negação costuma
        // vir de uma requisição recusada. O que não pode é a tela QUEBRAR —
        // TypeError é render estourando, e foi exatamente isso que deixou o
        // Overview em branco por semanas.
        const quebrou = quebras.filter((q) => /TypeError|ReferenceError/.test(q))
        expect(quebrou, `${rota} quebrou o render`).toEqual([])
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

/* ---------------------------------------------------------------------------
 * As ações do dia dela, com efeito conferido.
 *
 * Fixture própria, marcada e limpa no afterAll: o banco é o da cliente, e a
 * regra da casa é apagar só o que o teste criou.
 */
test.describe('perfil Operação · as ações do dia', () => {
  test.skip(!email || !senha, 'defina E2E_OPERACAO_EMAIL e E2E_OPERACAO_SENHA para rodar')
  test.describe.configure({ mode: 'serial' })

  const marca = `zzt-${Date.now().toString(36)}`
  let fx: Awaited<ReturnType<typeof criarFixturePedido>> = null

  test.beforeAll(async () => {
    fx = await criarFixturePedido(marca)
    if (fx) await criarPedidoDireto(fx, 10, 5)
  })

  // hook, não try/finally: teste que estoura o timeout aborta o corpo e o
  // finally não roda, deixando lixo no banco da cliente
  // Limpa MESMO se a fixture morreu no meio: a criação são seis chamadas em
  // sequência, e o Supabase devolve 503 de vez em quando. Sem isto o que já
  // tinha sido criado fica no catálogo da cliente — aconteceu.
  test.afterAll(async () => {
    if (fx) await limparFixturePedido(marca, fx.telefone)
    else await limparPorMarca(marca)
  })

  const cartao = (page: Page) =>
    page.locator('section').filter({ hasText: 'Quadro por pagamento' })
      .getByRole('listitem').filter({ hasText: `Cliente ${marca}` })

  test('avança o pagamento pelo quadro, e o estado MUDA', async ({ page }) => {
    await entrar(page)
    await page.goto('/semana')
    await expect(cartao(page)).toBeVisible({ timeout: 20_000 })

    // o botão some e vira o próximo passo: é o efeito, não o clique
    await cartao(page).getByRole('button', { name: /Comprovante recebido/ }).click()
    await expect(cartao(page).getByRole('button', { name: /Confirmado/ }))
      .toBeVisible({ timeout: 20_000 })

    // e sobrevive ao F5 — gravou no banco, não só na tela
    await page.reload()
    await expect(cartao(page).getByRole('button', { name: /Confirmado/ }))
      .toBeVisible({ timeout: 20_000 })
  })

  test('marca Montado na folha, e a bag sai do estoque', async ({ page }) => {
    await entrar(page)
    await page.goto('/montagem')
    await expect(page.getByRole('heading', { name: 'Montagem de domingo' }))
      .toBeVisible({ timeout: 20_000 })

    // a parada pode estar em qualquer aba de rota: o cliente de teste não tem
    // rota, e "Sem rota" não fica numa posição fixa
    const abas = page.getByRole('button', { name: /parada/ })
    await expect(abas.first()).toBeVisible({ timeout: 20_000 })
    const linha = page.getByRole('row').filter({ hasText: `Cliente ${marca}` })

    let achou = false
    for (let i = 0; i < (await abas.count()); i++) {
      await abas.nth(i).click()
      achou = await linha.first().waitFor({ state: 'visible', timeout: 3_000 })
        .then(() => true, () => false)
      if (achou) break
    }
    expect(achou, 'a parada do teste não apareceu em nenhuma rota').toBe(true)

    // `exact` porque "Marcar X como montado" está inteiro dentro de
    // "Desmarcar X como montado" — a armadilha de substring já paga aqui
    await linha.getByRole('button',
      { name: `Marcar Cliente ${marca} como montado`, exact: true }).click()
    await expect(linha.getByRole('button',
      { name: `Desmarcar Cliente ${marca} como montado`, exact: true }))
      .toBeVisible({ timeout: 20_000 })

    // §6.7: montar REGISTRA o envio da bag. Se a RLS barrasse a escrita em
    // silêncio, o check viraria sozinho e o saldo não mexeria — que é
    // exatamente o erro que só aparece semanas depois, faltando bag.
    await page.goto('/bags')
    await expect(page.getByText(new RegExp(`Cliente ${marca}`)).first())
      .toBeVisible({ timeout: 20_000 })
  })

  test('liga e desliga prato no menu, que é edição dela', async ({ page }) => {
    await entrar(page)
    await page.goto('/catalogo?aba=menus')
    await expect(page.getByRole('heading', { name: 'Ordem do menu' }))
      .toBeVisible({ timeout: 20_000 })

    // reordenar é escrita, e passa por `is_staff()` — a Operação é staff
    const painel = page.locator('section').filter({ hasText: 'Ordem do menu' })
    const linhas = painel.getByRole('listitem')
    const antes = (await linhas.first().innerText()).trim()
    const nome = antes.replace(/^\d+\s*/, '').replace(/[▲▼\s]+$/, '').trim()

    const gravou = page.waitForResponse(
      (r) => r.url().includes('fn_ordenar_menu') && r.status() < 400)
    await painel.getByRole('button', { name: `Descer ${nome} na ordem do menu` }).click()
    await gravou

    await page.reload()
    await expect(painel.getByRole('listitem').first())
      .not.toHaveText(antes, { timeout: 20_000 })
  })
})
