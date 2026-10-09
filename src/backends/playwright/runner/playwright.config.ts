// The config `npx spp-lang test` runs with when the project has no Playwright
// config of its own: every .spp file under where it was run. Everything it
// writes goes in that directory, not in here.

import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { defineSppConfig } from '../generate.ts'

const root = process.env.SPP_CWD ?? process.cwd()

export default defineConfig({
  ...defineSppConfig({ root }),
  outputDir: path.join(root, 'test-results'),
  reporter: [['list'], ['html', { outputFolder: path.join(root, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL: process.env.SPP_BASE_URL || undefined,
    trace: 'retain-on-failure',
  },
})
