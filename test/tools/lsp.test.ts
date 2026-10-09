// Talks to `spp-lang lsp` over stdio, as an editor would.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import rpc from 'vscode-jsonrpc/node'

const words = ['Define: Add Text (Item)', '  Fill the Field "Item" with Item', '  Click the Button "Add"', ''].join(
  '\n',
)

const feature = [
  'Feature: Groceries', //                  0
  '  Scenario: Adding', //                  1
  '    When I Add "Milk"', //               2
  '    And I Click "Add"', //               3  a mistake
  '    And I Click the ', //                4  for completion
  '',
].join('\n')

// Outside its ```spp block, Markdown is prose, whatever it says.
const readme = [
  '# Groceries', //                    0
  '', //                               1
  'Visit "/" is not code here.', //    2
  '', //                               3
  '```spp', //                         4
  'Feature: In the docs', //           5
  '  Scenario: Visiting', //           6
  '    When I Visit "/"', //           7
  '    And I Visit the Button "Go"', // 8  a mistake
  '```', //                            9
  '',
].join('\n')

// A word with two Defines, told apart by where the Milk goes.
const shop = [
  'Define: Cart', //                                     0
  '  the Region "Cart"', //                              1
  'Define: Shelf', //                                    2
  '  the Region "Shelf"', //                             3
  'Define: Put Text (Item) in Cart', //                  4
  '  Fill Item into the Field "Item" Within Cart', //    5
  'Define: Put Text (Item) on Shelf', //                 6
  '  Fill Item into the Field "Item" Within Shelf', //   7
  'Feature: Shop', //                                    8
  '  Scenario: Putting', //                              9
  '    When I Put "Milk" in the Cart', //                10
  '    And I Put "Tea" on the Shelf', //                 11
  '',
].join('\n')

type Published = {
  uri: string
  diagnostics: { message: string; range: { start: { line: number; character: number } } }[]
}

test('the language server', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-lsp-'))
  fs.writeFileSync(path.join(dir, 'words.spp'), words)
  fs.writeFileSync(path.join(dir, 'a.spp'), feature)
  fs.writeFileSync(path.join(dir, 'README.md'), readme)
  fs.writeFileSync(path.join(dir, 'shop.spp'), shop)
  // Left out by the config: its mistake should never be reported.
  fs.mkdirSync(path.join(dir, 'drafts'))
  fs.writeFileSync(path.join(dir, 'drafts', 'b.spp'), 'Feature: Draft\n  Scenario: S\n    When I Clik\n')
  // A project of its own, which Defines Add too, its own way.
  fs.mkdirSync(path.join(dir, 'other'))
  fs.writeFileSync(path.join(dir, 'other', 'words.spp'), 'Define: Add Text (Item)\n  Fill the Field "Name" with Item\n')
  fs.writeFileSync(path.join(dir, 'other', 'c.spp'), 'Feature: Other\n  Scenario: S\n    When I Add "Tea"\n')
  fs.writeFileSync(
    path.join(dir, 'playwright.config.mjs'),
    [
      `import { defineSppConfig } from ${JSON.stringify(pathToFileURL(path.resolve('src/index.ts')).href)}`,
      'export default {',
      '  projects: [',
      "    { ...defineSppConfig({ ignore: ['drafts', 'other'] }) },",
      "    { ...defineSppConfig({ features: ['other'], outputDir: '.spp-tests/other' }) },",
      '  ],',
      '}',
    ].join('\n'),
  )
  const uri = pathToFileURL(path.join(dir, 'a.spp')).href
  const wordsUri = pathToFileURL(path.join(dir, 'words.spp')).href
  const readmeUri = pathToFileURL(path.join(dir, 'README.md')).href
  const shopUri = pathToFileURL(path.join(dir, 'shop.spp')).href

  // As an editor's language client starts it.
  const child = spawn(process.execPath, ['bin/spp-lang.ts', 'lsp', '--stdio', `--clientProcessId=${process.pid}`], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const connection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(child.stdout),
    new rpc.StreamMessageWriter(child.stdin),
  )
  // Every publish, and a way to wait for the next one about a.spp that passes a test.
  const published: Published[] = []
  const waiters: (() => void)[] = []
  connection.onNotification('textDocument/publishDiagnostics', (p: Published) => {
    published.push(p)
    for (const w of waiters.splice(0)) w()
  })
  const diagnostics = async (ok: (p: Published) => boolean, of = uri) => {
    for (;;) {
      const found = published.findLast((p) => p.uri === of)
      if (found && ok(found)) return found.diagnostics
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`no such diagnostics; last: ${JSON.stringify(found)}`)), 5000)
        waiters.push(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }
  }
  connection.listen()
  t.after(() => {
    connection.dispose()
    child.kill()
  })

  await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(dir).href,
    workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'dir' }],
    capabilities: {},
  })
  connection.sendNotification('initialized', {})
  connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'spp', version: 1, text: feature },
  })

  await t.test('reports mistakes, where they are', async () => {
    const found = await diagnostics((p) => p.diagnostics.length > 0)
    assert.deepEqual(
      found.map((d) => [d.range.start, d.message]),
      [[{ line: 3, character: 10 }, 'Click expected something on the page, but got "Add"']],
    )
  })

  await t.test("leaves out what the project's config ignores", async () => {
    assert.deepEqual(await connection.sendRequest('workspace/symbol', { query: 'Draft' }), [])
  })

  await t.test('checks each project on its own, so two can Define the same word', async () => {
    const clashes = published.filter((p) => /words\.spp$/.test(p.uri) && p.diagnostics.length)
    assert.deepEqual(clashes, [])
    const hover = await connection.sendRequest<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri: pathToFileURL(path.join(dir, 'other', 'c.spp')).href },
      position: { line: 2, character: 12 },
    })
    assert.match(hover.contents.value, /Defined at other\/words\.spp:1/)
  })

  await t.test("shows a word's signature, for a Define too", async () => {
    const hover = await connection.sendRequest<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri },
      position: { line: 2, character: 12 },
    })
    assert.match(hover.contents.value, /Add : Text \(Item\) ->/)
    assert.match(hover.contents.value, /Defined at words\.spp:1/)
  })

  await t.test('in a Define, knows what its header takes', async () => {
    const hover = await connection.sendRequest<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri: wordsUri },
      position: { line: 1, character: 30 },
    })
    assert.match(hover.contents.value, /Item : Text/)
    // Completion is for open files, when asked or after a capital.
    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: wordsUri, languageId: 'spp', version: 1, text: words },
    })
    const items = await connection.sendRequest<{ label: string }[]>('textDocument/completion', {
      textDocument: { uri: wordsUri },
      position: { line: 1, character: 2 },
      context: { triggerKind: 1 },
    })
    assert.ok(items.some((i) => i.label === 'Item'))
  })

  await t.test("goes to a Define'd word's Define", async () => {
    const location = await connection.sendRequest<{
      uri: string
      range: { start: { line: number; character: number } }
    }>('textDocument/definition', { textDocument: { uri }, position: { line: 2, character: 12 } })
    assert.equal(location.uri, wordsUri)
    // At the name, "Define: Add", where references find it too.
    assert.deepEqual(location.range.start, { line: 0, character: 8 })
  })

  type Found = { uri: string; range: { start: { line: number; character: number } } }
  const where = (l: Found) =>
    `${path.basename(new URL(l.uri).pathname)}:${l.range.start.line}:${l.range.start.character}`

  await t.test("finds a Define'd word's uses, and its Define if asked", async () => {
    const references = (includeDeclaration: boolean) =>
      connection.sendRequest<Found[]>('textDocument/references', {
        textDocument: { uri },
        position: { line: 2, character: 12 },
        context: { includeDeclaration },
      })
    assert.deepEqual((await references(false)).map(where), ['a.spp:2:11'])
    assert.deepEqual((await references(true)).map(where).sort(), ['a.spp:2:11', 'words.spp:0:8'])
  })

  await t.test("finds a built-in word's uses, in steps and Defines", async () => {
    const found = await connection.sendRequest<Found[]>('textDocument/references', {
      textDocument: { uri },
      position: { line: 3, character: 12 },
      context: { includeDeclaration: true },
    })
    assert.deepEqual(found.map(where).sort(), ['a.spp:3:10', 'a.spp:4:10', 'words.spp:2:2'])
  })

  await t.test("lists a file's Defines, and its Feature's scenarios", async () => {
    type Symbol = { name: string; children?: Symbol[] }
    const outline = (symbols: Symbol[]): unknown =>
      symbols.map((s) => (s.children ? [s.name, outline(s.children)] : s.name))
    const symbols = (u: string) =>
      connection.sendRequest<Symbol[]>('textDocument/documentSymbol', { textDocument: { uri: u } })
    assert.deepEqual(outline(await symbols(uri)), [['Groceries', ['Adding']]])
    assert.deepEqual(outline(await symbols(wordsUri)), ['Add'])
  })

  await t.test('for a word with several Defines, shows and goes to the one a use runs', async () => {
    const hover = await connection.sendRequest<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri: shopUri },
      position: { line: 11, character: 11 },
    })
    assert.match(hover.contents.value, /Put : Text \(Item\), Shelf ->/)
    assert.doesNotMatch(hover.contents.value, /Cart/)
    assert.match(hover.contents.value, /Defined at shop\.spp:7$/)
    const location = await connection.sendRequest<{ range: { start: { line: number; character: number } } }>(
      'textDocument/definition',
      { textDocument: { uri: shopUri }, position: { line: 10, character: 12 } },
    )
    assert.deepEqual(location.range.start, { line: 4, character: 8 })
  })

  await t.test('for a word with several Defines, finds the uses of each', async () => {
    const references = (line: number, character: number) =>
      connection.sendRequest<Found[]>('textDocument/references', {
        textDocument: { uri: shopUri },
        position: { line, character },
        context: { includeDeclaration: true },
      })
    assert.deepEqual((await references(10, 12)).map(where).sort(), ['shop.spp:10:11', 'shop.spp:4:8'])
    assert.deepEqual((await references(6, 9)).map(where).sort(), ['shop.spp:11:10', 'shop.spp:6:8'])
  })

  await t.test('searches the project for Defines and scenarios by name', async () => {
    const found = await connection.sendRequest<{ name: string; location: Found }[]>('workspace/symbol', {
      query: 'add',
    })
    // Both projects' Adds: this one's, and other/words.spp's.
    assert.deepEqual(found.map((s) => `${s.name} ${where(s.location)}`).sort(), [
      'Add words.spp:0:0',
      'Add words.spp:0:0',
      'Adding a.spp:1:2',
    ])
  })

  await t.test('offers what fits first', async () => {
    const items = await connection.sendRequest<{ label: string; sortText: string }[]>('textDocument/completion', {
      textDocument: { uri },
      position: { line: 4, character: 20 },
      context: { triggerKind: 1 },
    })
    const sort = (label: string) => items.find((i) => i.label === label)?.sortText ?? ''
    // After "Click the", something on the page: queries first.
    assert.ok(sort('Button').startsWith('0'), sort('Button'))
    assert.ok(sort('Field').startsWith('0'))
    assert.ok(sort('Visit').startsWith('1'))
    assert.ok(sort('Add').startsWith('1'))
  })

  await t.test('stays out of the way in prose', async () => {
    const items = await connection.sendRequest<unknown[]>('textDocument/completion', {
      textDocument: { uri },
      position: { line: 2, character: 22 },
      context: { triggerKind: 2 },
    })
    assert.deepEqual(items, [])
  })

  await t.test('picks the code out of the prose', async () => {
    const tokens = await connection.sendRequest<{ data: number[] }>('textDocument/semanticTokens/full', {
      textDocument: { uri },
    })
    // Line 2, "    When I Add "Milk"": When, I, Add, "Milk" — and nothing for prose.
    const decoded: [number, number, number][] = []
    for (let i = 0, line = 0, char = 0; i < tokens.data.length; i += 5) {
      const [dl, dc, length] = tokens.data.slice(i, i + 3)
      line += dl
      char = dl ? dc : char + dc
      decoded.push([line, char, length])
    }
    assert.deepEqual(
      decoded
        .filter(([line]) => line === 2)
        .map(([, char, length]) => feature.split('\n')[2].slice(char, char + length)),
      ['When', 'I', 'Add', '"Milk"'],
    )
  })

  await t.test('clears mistakes once fixed, before saving', async () => {
    connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [
        {
          text: feature
            .replace('Click "Add"', 'Click the Button "Add"')
            .replace('Click the \n', 'Click the Button "Go"\n'),
        },
      ],
    })
    assert.deepEqual(await diagnostics((p) => p.diagnostics.length === 0), [])
  })

  await t.test("checks a Markdown file's ```spp blocks, and only those", async () => {
    const found = await diagnostics((p) => p.diagnostics.length > 0, readmeUri)
    assert.deepEqual(
      found.map((d) => d.range.start),
      [{ line: 8, character: 10 }],
    )
    const hover = await connection.sendRequest<{ contents: { value: string } }>('textDocument/hover', {
      textDocument: { uri: readmeUri },
      position: { line: 7, character: 12 },
    })
    assert.match(hover.contents.value, /Visit/)
    const outside = await connection.sendRequest('textDocument/hover', {
      textDocument: { uri: readmeUri },
      position: { line: 2, character: 2 },
    })
    assert.equal(outside, null)
  })

  await t.test('picks out code only inside ```spp blocks', async () => {
    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri: readmeUri, languageId: 'markdown', version: 1, text: readme },
    })
    const tokens = await connection.sendRequest<{ data: number[] }>('textDocument/semanticTokens/full', {
      textDocument: { uri: readmeUri },
    })
    const lines = new Set<number>()
    // Each token's line is relative to the one before.
    let line = 0
    for (let i = 0; i < tokens.data.length; i += 5) {
      line += tokens.data[i]
      lines.add(line)
    }
    assert.deepEqual([...lines], [5, 6, 7, 8])
  })

  await connection.sendRequest('shutdown')
})
