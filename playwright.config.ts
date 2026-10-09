// Spec++'s own end-to-end tests: each example against its own app, and the
// fixtures, which must all fail, against the demo's. Each is a project of its
// own, with its own words, so their Defines don't clash.
import { defineConfig } from '@playwright/test'
import { defineSppConfig } from './src/index.ts'

const demo = 'http://localhost:4173'
const todomvc = 'http://localhost:4174'

export default defineConfig({
  projects: [
    {
      name: 'demo',
      ...defineSppConfig({ features: ['examples/demo/features'], outputDir: '.spp-tests/demo' }),
      use: { baseURL: demo },
    },
    {
      name: 'todomvc',
      ...defineSppConfig({ features: ['examples/todomvc/features'], outputDir: '.spp-tests/todomvc' }),
      use: { baseURL: todomvc },
    },
    {
      name: 'failures',
      ...defineSppConfig({ features: ['test/fixtures'], outputDir: '.spp-tests/failures' }),
      use: { baseURL: demo },
    },
  ],
  webServer: [
    { command: 'node examples/demo/serve.ts', url: demo, reuseExistingServer: true },
    { command: 'node examples/todomvc/serve.ts', url: todomvc, reuseExistingServer: true },
  ],
})
