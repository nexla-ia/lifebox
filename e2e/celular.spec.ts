import { expect, test, type Page } from '@playwright/test'
import './env'

/* Celular. Ref: medição no Chromium, 14/10/2026.
 *
 * O sistema foi construído contra o protótipo, que é de computador — e a nav
 * era uma barra FIXA de 176px. Num iPhone de 375px isso deixava 199px de
 * conteúdo em toda tela: Overview, Semana, Clientes e Configurações
 * estouravam a largura, e as outras só não estouravam porque as tabelas rolam
 * por dentro, numa janela de 199px que não serve para conferir nada.
 *
 * Com a nav fora do caminho, as 15 telas couberam em 375px sem estouro: o
 * conteúdo já era fluido. Por isso o conserto foi um só, no `AppLayout`, e por
 * isso o teste mede a REGRA e não cada tela: nenhuma tela pode exigir rolagem
 * horizontal de PÁGINA no celular.
 *
 * Rolagem horizontal DENTRO de um container (`overflow-x-auto`, as tabelas)
 * não conta e é de propósito: a folha da cozinha tem colunas demais para 375px
 * e rolar a tabela é melhor que esconder coluna.
 *
 * Quem usa no celular é a equipe de pé — conferir pedido, marcar Montado — e o
 * cliente, que pede pelo link público sempre do telefone. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA

const CELULAR = { width: 375, height: 812 }

/** Estouro horizontal de PÁGINA, mais quem o causou. */
const MEDIR = `(() => {
  const vw = window.innerWidth
  const doc = document.documentElement
  const contido = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden')
          && p.getBoundingClientRect().right <= vw + 1) return true
    }
    return false
  }
  const culpados = []
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= vw + 1 || contido(el)) continue
    if ([...el.children].some((c) => c.getBoundingClientRect().right > vw + 1)) continue
    culpados.push(el.tagName.toLowerCase() + ' «'
      + (el.textContent || '').trim().slice(0, 30) + '» passa '
      + Math.round(r.right - vw) + 'px')
  }
  return { estouro: doc.scrollWidth - doc.clientWidth, culpados: [...new Set(culpados)].slice(0, 4) }
})()`

const TELAS = [
  ['/overview', 'Overview'],
  ['/semana', 'Semana'],
  ['/clientes', 'Clientes'],
  ['/catalogo', 'Catálogo'],
  ['/catalogo?aba=menus', 'Catálogo · menus'],
  ['/producao', 'Produção'],
  ['/montagem', 'Montagem'],
  ['/bags', 'Bags'],
  ['/config', 'Configurações'],
  ['/config?aba=zips', 'Configurações · ZIPs'],
] as const

async function entrar(page: Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview|semana/, { timeout: 30_000 })
}

test.describe('no celular', () => {
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  test('nenhuma tela pede rolagem horizontal a 375px', async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize(CELULAR)
    await entrar(page)

    for (const [rota, nome] of TELAS) {
      await page.goto(rota)
      // Espera o CONTEÚDO, não o cabeçalho. O esqueleto nunca estoura — ele é
      // feito de blocos de largura percentual — então medir durante a carga
      // dá verde em tela que estoura depois de carregar. Esta foi a primeira
      // versão do teste, e passava em 3,8s para dez telas: não media nada.
      await expect(page.locator('main').getByRole('heading').first())
        .toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 30_000 })
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
      const r = await page.evaluate(MEDIR) as { estouro: number; culpados: string[] }
      expect(r.estouro,
        `${nome} estoura ${r.estouro}px no celular: ${r.culpados.join(' | ')}`)
        .toBeLessThanOrEqual(1)
    }
  })

  test('a gaveta abre, navega e se fecha sozinha', async ({ page }) => {
    await page.setViewportSize(CELULAR)
    await entrar(page)

    const nav = page.locator('#menu-lateral')
    const abrir = page.getByRole('button', { name: 'Abrir menu' })

    // fechada, a gaveta está FORA da tela — não escondida por trás do conteúdo
    await expect(abrir).toBeVisible()
    expect((await nav.boundingBox())!.x).toBeLessThan(0)

    await abrir.click()
    await expect.poll(async () => (await nav.boundingBox())!.x).toBe(0)

    // navegar fecha: sem isso a pessoa toca no item e a gaveta continua
    // cobrindo justamente a tela que ela foi ver
    await nav.getByRole('link', { name: /Montagem/ }).click()
    await expect(page).toHaveURL(/montagem/)
    await expect.poll(async () => (await nav.boundingBox())!.x,
      { message: 'a gaveta não fechou ao navegar' }).toBeLessThan(0)
  })

  test('no computador continua a barra do protótipo, sem botão de menu',
    async ({ page }) => {
      // O protótipo é aprovado pela cliente: o conserto do celular não pode
      // mudar nada acima do breakpoint.
      await page.setViewportSize({ width: 1280, height: 800 })
      await entrar(page)

      await expect(page.getByRole('button', { name: 'Abrir menu' })).toHaveCount(0)
      const nav = await page.locator('#menu-lateral').boundingBox()
      expect(nav!.x, 'a barra tem de estar à esquerda, visível').toBe(0)
      expect(Math.round(nav!.width), 'os 176px do protótipo').toBe(176)
    })

  test('o link público cabe no celular — é lá que o cliente pede',
    async ({ page }) => {
      await page.setViewportSize(CELULAR)
      await page.goto('/pedido')
      await expect(page.locator('main, body').first()).toBeVisible()
      await page.waitForTimeout(3000)
      const r = await page.evaluate(MEDIR) as { estouro: number; culpados: string[] }
      expect(r.estouro, `o link estoura: ${r.culpados.join(' | ')}`)
        .toBeLessThanOrEqual(1)
    })
})
