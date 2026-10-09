// The demo as a project of its own: a grocery list behind a sign-in page. Run it
// from here with `npx playwright test`, or from the repo's root with `npm run test:e2e`.
import { defineConfig } from '@playwright/test'
import { defineSppConfig } from '../../src/index.ts'

export default defineConfig({
  ...defineSppConfig({ features: ['features'] }),
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node serve.ts', url: 'http://localhost:4173', reuseExistingServer: true },
})
