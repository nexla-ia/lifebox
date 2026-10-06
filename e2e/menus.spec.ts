import { expect, test } from '@playwright/test'
import './env'
import { limparPratos } from './supabaseTest'

/** A linha do prato NA COLUNA DO CATÁLOGO.
 *
 *  O painel "Ordem do menu" lista os mesmos pratos em `li` também, então
 *  `getByRole('listitem')` solto na página casa dois elementos e o strict mode
 *  derruba o teste — sem haver bug nenhum. Escopar na seção do catálogo é o
 *  que separa "o prato existe no cadastro" de "o prato está na ordem".
 */
const noCatalogo = (page: Page, nome: string) =>
  page.locator('section').filter({ hasNotText: 'Ordem do menu' })
    .getByRole('listitem').filter({ hasText: nome })

/** Menus do ciclo e cadastro de prato. Ref: protótipo 5c, 5d, 5e.
 *
 *  Cria dados reais no Supabase e apaga no fim, com sufixo único. */

const email = process.env.E2E_EMAIL
const senha = process.env.E2E_SENHA
const sufixo = `zzt-${Date.now().toString(36)}`

// PNG 1x1 válido — só para exercitar o upload ao bucket de verdade
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function entrar(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(senha!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(/overview/, { timeout: 20_000 })
  await page.goto('/catalogo')
  await page.getByRole('button', { name: 'Menus do ciclo' }).click()
}

test.describe('menus do ciclo', () => {
  test.skip(!email || !senha, 'defina E2E_EMAIL e E2E_SENHA para rodar')

  // hook, não try/finally: quando um teste estoura o timeout o Playwright
  // aborta o corpo e o finally não chega a rodar — aí sobra lixo no banco.
  test.afterAll(() => limparPratos(sufixo))

  test('mostra os 4 menus em rotação', async ({ page }) => {
    await entrar(page)
    for (const n of ['Menu 1', 'Menu 2', 'Menu 3', 'Menu 4']) {
      await expect(page.getByRole('button', { name: new RegExp(n) })).toBeVisible()
    }
    await expect(page.getByText(/O ciclo repete a cada 4 semanas/)).toBeVisible()
  })

  test('cadastra prato com nutrição, tag e alérgeno, e liga no menu', async ({ page }) => {
    await entrar(page)
    {
      await page.getByRole('button', { name: '＋ Adicionar prato' }).click()

      await page.getByLabel(/Nome PT/).fill(`Prato ${sufixo}`)
      await page.getByLabel(/Nome EN/).fill(`Dish ${sufixo}`)
      await page.getByLabel('Descrição PT').fill('Descrição de teste')
      await page.getByLabel('Cal').fill('448')
      await page.getByLabel('Prot (g)').fill('33')
      await page.getByLabel('Carbs (g)').fill('44')
      await page.getByLabel('Fat (g)').fill('14')

      // tag e alérgeno vêm do seed base
      await page.getByRole('button', { name: /Sem glúten/ }).click()
      await page.getByRole('button', { name: /Leite/ }).click()

      await page.getByRole('button', { name: 'Salvar prato' }).click()

      const item = noCatalogo(page, `Prato ${sufixo}`)
      await expect(item).toBeVisible({ timeout: 20_000 })
      await expect(item).toContainText('448 cal')
      await expect(item).toContainText('GF')

      // §5.5: o prato entra ativo no menu aberto
      await expect(item.getByRole('button', { name: /Tirar .* do menu/ })).toBeVisible()

      // persistiu?
      await page.reload()
      await page.getByRole('button', { name: 'Menus do ciclo' }).click()
      await expect(
        noCatalogo(page, `Prato ${sufixo}`),
      ).toBeVisible({ timeout: 20_000 })
    }
  })

  test('envia a foto para o Storage e mostra na lista', async ({ page }) => {
    await entrar(page)
    {
      await page.getByRole('button', { name: '＋ Adicionar prato' }).click()
      await page.getByLabel(/Nome PT/).fill(`Foto ${sufixo}`)
      await page.getByLabel(/Nome EN/).fill(`Photo ${sufixo}`)
      await page.getByLabel('Foto do prato').setInputFiles({
        name: 'prato.png', mimeType: 'image/png', buffer: PNG_1PX,
      })
      await page.getByRole('button', { name: 'Salvar prato' }).click()

      const item = noCatalogo(page, `Foto ${sufixo}`)
      await expect(item).toBeVisible({ timeout: 20_000 })

      // depois do reload a imagem vem do bucket, não do blob local
      await page.reload()
      await page.getByRole('button', { name: 'Menus do ciclo' }).click()
      const img = noCatalogo(page, `Foto ${sufixo}`).locator('img')
      await expect(img).toBeVisible({ timeout: 20_000 })
      const src = await img.getAttribute('src')
      expect(src, 'a foto deveria estar no bucket dish-photos').toContain('dish-photos')
    }
  })

  // Reunião de 22/09: "mesma sequência da montagem será o mesmo jeito que o
  // menu estiver organizado". `position` já mandava nas folhas — faltava a
  // tela, e sem ela a ordem era a que o banco devolvesse.
  // Reunião de 22/09: "mesma sequência da montagem será o mesmo jeito que o
  // menu estiver organizado". `position` já mandava nas folhas — faltava a
  // tela, e sem ela a ordem era a que o banco devolvesse.
  test('a ordem do menu é editável e fica salva', async ({ page }) => {
    await entrar(page)

    const painel = page.locator('section').filter({ hasText: 'Ordem do menu' })
    await expect(painel.getByRole('listitem').first())
      .toBeVisible({ timeout: 20_000 })

    // Compara a LISTA inteira, não a primeira linha. O teste roda contra o
    // banco da cliente e cada rodada move um prato: olhar só o primeiro faz o
    // resultado depender de quem rodou antes.
    const nomes = async () => (await painel.getByRole('listitem').allInnerTexts())
      .map((t) => t.replace(/^\d+\s*/, '').replace(/[▲▼\s]+$/, '').trim())

    const antes = await nomes()
    expect(antes.length).toBeGreaterThan(1)

    // ESPERA a gravação, não só a tela. O painel reordena na hora (otimista,
    // senão a linha pisca de volta até o servidor responder), e recarregar
    // logo após o clique abortaria a chamada em voo.
    const gravou = page.waitForResponse(
      (r) => r.url().includes('fn_ordenar_menu') && r.status() < 400)
    await painel.getByRole('button', { name: `Descer ${antes[0]} na ordem do menu` })
      .click()
    await gravou

    const depois = await nomes()
    expect(depois).not.toEqual(antes)
    expect(depois[1]).toBe(antes[0])     // desceu uma posição
    expect(depois.slice().sort()).toEqual(antes.slice().sort())  // ninguém sumiu

    // e continua assim depois do F5: ordem que só vive na tela não serve para
    // a cozinha, que lê a folha impressa no domingo
    await page.reload()
    await expect(painel.getByRole('listitem').first())
      .toBeVisible({ timeout: 20_000 })
    expect(await nomes()).toEqual(depois)
  })

  test('tirar prato do menu não apaga o prato', async ({ page }) => {
    await entrar(page)
    {
      await page.getByRole('button', { name: '＋ Adicionar prato' }).click()
      await page.getByLabel(/Nome PT/).fill(`Toggle ${sufixo}`)
      await page.getByLabel(/Nome EN/).fill(`Toggle ${sufixo}`)
      await page.getByRole('button', { name: 'Salvar prato' }).click()

      const item = noCatalogo(page, `Toggle ${sufixo}`)
      await expect(item).toBeVisible({ timeout: 20_000 })

      // sem pedidos usando, sai direto, sem modal
      await item.getByRole('button', { name: /Tirar .* do menu/ }).click()
      await expect(
        noCatalogo(page, `Toggle ${sufixo}`)
          .getByRole('button', { name: /Pôr .* no menu/ }),
      ).toBeVisible({ timeout: 20_000 })
    }
  })
})
