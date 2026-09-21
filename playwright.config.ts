import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4173' },

  // Um banco só, compartilhado por todos os specs: um teste cria ZIP enquanto
  // outro exige a lista vazia, um cria cliente enquanto outro conta cadastros.
  // Rodar em paralelo sobre estado mutável compartilhado produz falha sem que
  // exista bug. Serial custa alguns segundos e elimina a classe inteira.
  fullyParallel: false,
  workers: 1,

  // `vite preview` serve o dist e respeita SPA fallback, igual a Vercel
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
