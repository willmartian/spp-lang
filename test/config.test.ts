import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { discover, everything, loadProjects } from '../src/index.ts'

const bin = path.resolve('bin/spp-lang.ts')
// What a config in a scratch directory imports defineSppConfig from.
const spp = JSON.stringify(pathToFileURL(path.resolve('src/index.ts')).href)

// A directory of files, given as path → contents.
function project(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spp-config-')))
  for (const [name, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), src)
  }
  return dir
}

const config = (...calls: string[]) =>
  `import { defineSppConfig } from ${spp}\nexport default { projects: [${calls.map((c) => `{ ...defineSppConfig(${c}) }`).join(', ')}] }\n`

const broken = 'Feature: F\n  Scenario: S\n    When I Clik the Button "Add"\n'
const fine = 'Feature: F\n  Scenario: S\n    When I Click the Button "Add"\n'

test('without a config, the project is everything under where you are', async () => {
  const dir = project({ 'a.spp': fine })
  assert.deepEqual(await loadProjects(dir), [everything(dir)])
})

test("a Playwright config's projects are found from below, with paths relative to the config", async () => {
  const dir = project({
    'playwright.config.mjs': config(
      "{ features: ['features'], ignore: ['features/drafts'] }",
      "{ features: ['other'], outputDir: '.spp-tests/other' }",
    ),
    'features/sub/.keep': '',
  })
  assert.deepEqual(await loadProjects(path.join(dir, 'features', 'sub')), [
    {
      root: dir,
      features: [path.join(dir, 'features')],
      ignore: [path.join(dir, 'features/drafts')],
      outputDir: path.join(dir, '.spp-tests'),
    },
    { root: dir, features: [path.join(dir, 'other')], ignore: [], outputDir: path.join(dir, '.spp-tests/other') },
  ])
  // Finding out what a config says doesn't generate anything.
  assert.equal(fs.existsSync(path.join(dir, '.spp-tests')), false)
})

test('a Playwright config without Spec++ in it means everything under it', async () => {
  const dir = project({ 'playwright.config.mjs': 'export default {}', 'sub/.keep': '' })
  assert.deepEqual(await loadProjects(path.join(dir, 'sub')), [everything(dir)])
})

test('ignored files and directories are left out', () => {
  const dir = project({ 'a.spp': fine, 'drafts/b.spp': fine, 'c.spp': fine })
  const found = discover([dir], dir, [path.join(dir, 'drafts'), path.join(dir, 'c.spp')])
  assert.deepEqual(found, [path.join(dir, 'a.spp')])
})

test("an untrusted project's config isn't run", async () => {
  const dir = project({ 'playwright.config.mjs': "throw new Error('ran')" })
  assert.deepEqual(await loadProjects(dir, { trusted: false }), [everything(dir)])
})

test('a defineSppConfig given the wrong thing says so', async () => {
  const dir = project({ 'playwright.config.mjs': config("{ features: 'features' }") })
  await assert.rejects(loadProjects(dir), /features should be a list of paths/)
})

test('check loads what the config says, from anywhere in the project', () => {
  const dir = project({
    'playwright.config.mjs': config("{ ignore: ['fixtures'] }"),
    'features/a.spp': fine,
    'fixtures/broken.spp': broken,
  })
  const run = spawnSync(process.execPath, [bin, 'check'], { cwd: path.join(dir, 'features'), encoding: 'utf8' })
  assert.equal(run.stdout.trim(), 'No mistakes in 1 file')
  assert.equal(run.status, 0)
})

test('check checks each project with its own words', () => {
  const add = (field: string) => `Define: Add Text (Item)\n  Fill the Field "${field}" with Item\n`
  const uses = 'Feature: F\n  Scenario: S\n    When I Add "Milk"\n'
  const dir = project({
    'playwright.config.mjs': config(
      "{ features: ['one'], outputDir: '.spp-tests/one' }",
      "{ features: ['two'], outputDir: '.spp-tests/two' }",
    ),
    'one/words.spp': add('Item'),
    'one/a.spp': uses,
    'two/words.spp': add('Name'),
    'two/a.spp': uses,
  })
  const run = spawnSync(process.execPath, [bin, 'check'], { cwd: dir, encoding: 'utf8' })
  assert.equal(run.stdout.trim(), 'No mistakes in 4 files')
  assert.equal(run.status, 0)
})
