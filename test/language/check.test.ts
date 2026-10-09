import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Diagnostic } from '../../src/index.ts'
import { browser, check, core, discover, leftovers, load } from '../../src/index.ts'

// Checks some .spp files, given as name → contents.
function checkFiles(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-check-'))
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), src)
  const report = check(discover([dir]).map(load), { words: browser(core()), settle: leftovers, cwd: dir })
  const brief = (d: Diagnostic) => `${path.basename(d.file)}:${d.line}:${d.column} ${d.message}`
  return {
    vocabulary: report.vocabulary.map(brief),
    scenarios: [...report.scenarios.values()].map(brief),
  }
}

// A feature with one scenario of these steps.
const scenario = (...steps: string[]) => ['Feature: F', '  Scenario: S', ...steps.map((s) => `    ${s}`)].join('\n')

test('the demo checks clean', () => {
  const report = check(discover(['examples/demo/features']).map(load), { words: browser(core()), settle: leftovers })
  assert.deepEqual(report.vocabulary, [])
  assert.deepEqual([...report.scenarios.values()], [])
})

test('a word given the wrong type is caught, at the word', () => {
  assert.deepEqual(checkFiles({ 'a.spp': scenario('When I Click "Add"') }).scenarios, [
    'a.spp:3:12 Click expected something on the page, but got "Add"',
  ])
})

test('steps that leave something unused are caught', () => {
  assert.deepEqual(
    checkFiles({ 'a.spp': scenario('When the Button "Add"'), 'b.spp': scenario('Then it should be Checked') })
      .scenarios,
    [
      'a.spp:3:10 Nothing used Button "Add". Is the step missing a verb?',
      'b.spp:3:10 Nothing to check is Checked. Put what should be Checked before it.',
    ],
  )
})

test("And and But carry on the keyword above them, so a scenario can't start with one", () => {
  assert.deepEqual(checkFiles({ 'a.spp': scenario('And I Visit "/"') }).scenarios, [
    'a.spp:3:5 And expected a Given, When or Then above it, but there was nothing left',
  ])
  assert.deepEqual(checkFiles({ 'a.spp': scenario('But I Visit "/"') }).scenarios, [
    'a.spp:3:5 But expected a Given, When or Then above it, but there was nothing left',
  ])
  const background = ['Feature: F', '  Background:', '    Given I Visit "/"', '  Scenario: S', '    And I Reload'].join(
    '\n',
  )
  assert.deepEqual(checkFiles({ 'a.spp': background }).scenarios, [])
})

test('a * step can start a scenario, or carry on the keyword above it', () => {
  assert.deepEqual(checkFiles({ 'a.spp': scenario('* I Visit "/"', '* I Reload') }).scenarios, [])
  assert.deepEqual(checkFiles({ 'a.spp': scenario('Given I Visit "/"', '* I Reload') }).scenarios, [])
})

test('a well-typed scenario, tables and scopes included, is clean', () => {
  const steps = [
    'Given I Visit "/"',
    'When I Fill in the form:',
    '  | Email | a@b |',
    'And I Click the Button "Remove" Within the Row Containing "Kale"',
    'Then the Checkbox "Bought" Within the Row Containing "Eggs" should Not be Checked',
    'And I should Not See "Kale"',
  ]
  assert.deepEqual(checkFiles({ 'a.spp': scenario(...steps) }).scenarios, [])
})

const add = ['Define: Add Text (Item)', '  Fill the Field "Item" with Item', '  Click the Button "Add"', ''].join('\n')

test("a Define's callers are checked against its header", () => {
  assert.deepEqual(checkFiles({ 'words.spp': add, 'a.spp': scenario('When I Add "Milk"') }).scenarios, [])
  assert.deepEqual(checkFiles({ 'words.spp': add, 'a.spp': scenario('When I Add the Button "Milk"') }).scenarios, [
    'a.spp:3:12 Add expected some text, but got Button "Milk"',
  ])
  assert.deepEqual(checkFiles({ 'words.spp': add, 'a.spp': scenario('When I Add') }).scenarios, [
    'a.spp:3:12 Add expected some text, but there was nothing left',
  ])
})

test('a Define can leave a check for the step to settle', () => {
  const words = 'Define: Home\n  Visit "/"\n  See the Heading "Home"\n'
  assert.deepEqual(checkFiles({ 'words.spp': words, 'a.spp': scenario('Given I am Home') }).scenarios, [])
})

test('a Define can leave what it made for its caller', () => {
  const words = 'Define: The-button Text (Name)\n  Button Name\n'
  assert.deepEqual(checkFiles({ 'words.spp': words, 'a.spp': scenario('When I Click The-button "Go"') }).scenarios, [])
  assert.deepEqual(checkFiles({ 'words.spp': words, 'a.spp': scenario('When I Fill The-button "Go"') }).scenarios, [
    'a.spp:3:12 Fill expected some text, but there was nothing left',
  ])
})

test('a query in a Define does not reach into its caller for a Scope', () => {
  const words = 'Define: Remove\n  Click the Button "Remove"\n'
  assert.deepEqual(checkFiles({ 'words.spp': words, 'a.spp': scenario('When I Remove it') }).scenarios, [])
})

test('a Define with a mistake is reported once, and where it is used', () => {
  const words = 'Define: Both Text (X)\n  Visit X\n  Click X\n'
  const report = checkFiles({ 'words.spp': words, 'a.spp': scenario('When I Both "/"') })
  assert.deepEqual(report.vocabulary, ['words.spp:3:3 Click expected something on the page, but got X'])
  assert.deepEqual(report.scenarios, [
    "a.spp:3:12 Both can't be used: its Define has a mistake, at words.spp:3:3: Click expected something on the page, but got X",
  ])
})

const move = ['Define: Move Text (Item) to Element (Target)', '  Fill Target with Item', ''].join('\n')

test("a Define's header says what it takes, and its body is checked with that", () => {
  assert.deepEqual(checkFiles({ 'words.spp': move, 'a.spp': scenario('When I Move "Milk" to the Field "Item"') }), {
    vocabulary: [],
    scenarios: [],
  })
  assert.deepEqual(
    checkFiles({ 'words.spp': move, 'a.spp': scenario('When I Move the Field "Item" to "Milk"') }).scenarios,
    ['a.spp:3:12 Move expected some text, but got Field "Item"'],
  )
  const wrong = 'Define: Go Text (Where)\n  Click Where\n'
  assert.deepEqual(checkFiles({ 'words.spp': wrong }).vocabulary, [
    'words.spp:2:3 Click expected something on the page, but got Where',
  ])
})

test('a Define takes nothing from its caller but what its header says', () => {
  assert.deepEqual(checkFiles({ 'words.spp': 'Define: Go\n  Visit\n' }).vocabulary, [
    'words.spp:2:3 Visit expected a "/path" or URL, but there was nothing left',
  ])
})

test("a Define's header names only kinds there are, once each, without hiding words", () => {
  const vocabulary = (header: string) => checkFiles({ 'words.spp': `Define: ${header}\n  Print "hi"\n` }).vocabulary
  assert.deepEqual(vocabulary('Go Person'), [
    "words.spp:1:12 Person isn't a kind a Define can take. The kinds are Element, Text, Number, Table, Any, and nouns: Defines that leave one of those",
  ])
  assert.deepEqual(vocabulary('Go Element to Element'), [
    'words.spp:1:23 Two things are called Element. Name them, as in Element (Source) and Element (Target)',
  ])
  assert.deepEqual(vocabulary('Go Text'), [
    'words.spp:1:12 Text is already a word, so name this one, as in Text (Item)',
  ])
  assert.deepEqual(vocabulary('Go Text (Click)'), [
    'words.spp:1:12 Click is already a word, so call this one something else',
  ])
})

test("a Define with a mistake in its header can't be used, and says why", () => {
  const files = { 'words.spp': 'Define: Go Person\n  Print "hi"\n', 'a.spp': scenario('When I Go') }
  assert.match(
    checkFiles(files).scenarios[0],
    /Go can't be used: its Define has a mistake, at words\.spp:1:12: Person isn't a kind/,
  )
})

const cart = [
  'Define: Cart',
  '  the Region "Shopping cart"',
  'Define: Add Text (Item) to Cart',
  '  Fill Item into the Field "Item" Within Cart',
  '',
].join('\n')

test('a noun makes a kind, which a Define can take, and which is still what it was', () => {
  const steps = (...s: string[]) => checkFiles({ 'words.spp': cart, 'a.spp': scenario(...s) })
  assert.deepEqual(steps('When I Add "Milk" to the Cart', 'Then the Cart should be Visible', 'And I Click the Cart'), {
    vocabulary: [],
    scenarios: [],
  })
  assert.deepEqual(steps('When I Add "Milk" to the Region "Shopping cart"').scenarios, [
    'a.spp:3:12 Add expected a Cart, but got Region "Shopping cart"',
  ])
})

test('a Define can take a noun from a later file', () => {
  const files = { 'a.spp': 'Define: Open Cart\n  Click Cart\n', 'b.spp': 'Define: Cart\n  the Region "Cart"\n' }
  assert.deepEqual(checkFiles(files).vocabulary, [])
})

test('only a noun makes a kind', () => {
  const words = 'Define: Home\n  Visit "/"\nDefine: Go Home\n  Print "hi"\n'
  assert.deepEqual(checkFiles({ 'words.spp': words }).vocabulary, [
    "words.spp:3:12 Home can't be a kind: only a noun can, a Define that leaves one thing, like something on the page",
  ])
})

test("a Define's header can hide a noun only with that noun's own kind", () => {
  assert.deepEqual(checkFiles({ 'words.spp': `${cart}Define: Go Text (Cart)\n  Print Cart\n` }).vocabulary, [
    'words.spp:5:12 Cart is already a word, so call this one something else',
  ])
})

const shop = [
  cart,
  'Define: Settings',
  '  the Region "Account settings"',
  'Define: Add Text (Email) to Settings',
  '  Fill Email into the Field "Email" Within Settings',
  '',
].join('\n')

test('a word can have several Defines, told apart by the kinds they take', () => {
  const steps = (...s: string[]) => checkFiles({ 'words.spp': shop, 'a.spp': scenario(...s) })
  assert.deepEqual(steps('When I Add "Milk" to the Cart', 'And I Add "a@b" to the Settings'), {
    vocabulary: [],
    scenarios: [],
  })
  assert.deepEqual(steps('When I Add "Milk" to the Region "Pantry"').scenarios, [
    'a.spp:3:12 Add expected a Cart, or a Settings, but got Region "Pantry"',
  ])
})

test('Defines of a word can take different numbers of things', () => {
  const words = 'Define: Go\n  Visit "/"\nDefine: Go Text (Where)\n  Visit Where\n'
  assert.deepEqual(checkFiles({ 'words.spp': words, 'a.spp': scenario('When I Go', 'And I Go "/x"') }), {
    vocabulary: [],
    scenarios: [],
  })
})

test('Defines of a word that could always both fit are a mistake', () => {
  const vocabulary = (words: string) => checkFiles({ 'words.spp': cart + words }).vocabulary
  assert.deepEqual(vocabulary('Define: Go Text (A)\n  Visit A\nDefine: Go Text (B)\n  Visit B\n'), [
    "words.spp:7:1 Go takes the same things here as at words.spp:5:1, so there'd be no telling which one a step means",
  ])
  assert.deepEqual(vocabulary('Define: Go\n  Visit "/"\nDefine: Go\n  Visit "/x"\n'), [
    "words.spp:7:1 Go takes the same things here as at words.spp:5:1, so there'd be no telling which one a step means",
  ])
  assert.deepEqual(
    vocabulary('Define: Put Cart to Element\n  Click Cart\nDefine: Put Element to Cart\n  Click Cart\n'),
    [
      "words.spp:7:1 Put here and at words.spp:5:1 could both take the same things, and neither takes narrower kinds, so there'd be no telling which one a step means",
    ],
  )
  // one narrower throughout is fine: it's chosen when it fits
  assert.deepEqual(vocabulary('Define: Open Element (Thing)\n  Click Thing\nDefine: Open Cart\n  Click Cart\n'), [])
})

test('a noun has one Define', () => {
  const words =
    'Define: Cart\n  the Region "Cart"\nDefine: Cart\n  the Region "Basket"\nDefine: Open Cart\n  Click Cart\n'
  assert.deepEqual(checkFiles({ 'words.spp': words }).vocabulary, [
    "words.spp:5:14 Cart can't be a kind: a noun has one Define, and it has 2",
    "words.spp:3:1 Cart is a noun, so it can only have one Define, and there's another at words.spp:1:1",
  ])
})

test('a Define that uses itself is caught', () => {
  assert.deepEqual(checkFiles({ 'words.spp': 'Define: Again\n  Again\n' }).vocabulary, [
    'words.spp:2:3 Again uses itself, so it would never finish',
  ])
  assert.deepEqual(checkFiles({ 'words.spp': 'Define: Cart Cart\n  Print "hi"\n' }).vocabulary, [
    'words.spp:1:14 Cart uses itself, so it would never finish',
  ])
})

test('Defines can use Defines from other files, in any order', () => {
  const files = {
    'a.spp': 'Define: Go-home\n  Home\n',
    'b.spp': 'Define: Home\n  Visit "/"\n',
    'c.spp': scenario('Given I Go-home'),
  }
  assert.deepEqual(checkFiles(files), { vocabulary: [], scenarios: [] })
})
