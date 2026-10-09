// Runs inside VS Code, with the extension loaded and test/run.mjs's
// workspace open.

const assert = require('node:assert/strict')
const path = require('node:path')
const vscode = require('vscode')

// Polls until got() returns something, since the server answers when it's ready.
async function eventually(what, got, ms = 30000) {
  const start = Date.now()
  for (;;) {
    const value = await got()
    if (value) return value
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

let uri
let doc

test('.spp files are Spec++', async () => {
  uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'a.spp')
  doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc)
  assert.equal(doc.languageId, 'spp')
})

test('mistakes show up, where they are', async () => {
  const found = await eventually('diagnostics', () => {
    const d = vscode.languages.getDiagnostics(uri)
    return d.length ? d : null
  })
  assert.deepEqual(
    found.map((d) => [d.range.start.line, d.range.start.character, d.message]),
    [[3, 10, 'Click expected something on the page, but got "Add"']],
  )
})

test("hovering a word shows its type, worked out for a Define'd one", async () => {
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, new vscode.Position(2, 12))
  const text = hovers.flatMap((h) => h.contents.map((c) => c.value ?? String(c))).join('\n')
  assert.match(text, /Add : Text \(Item\) ->/)
})

test("go to definition finds a word's Define", async () => {
  const [target] = await vscode.commands.executeCommand(
    'vscode.executeDefinitionProvider',
    uri,
    new vscode.Position(2, 12),
  )
  assert.equal(path.basename((target.targetUri ?? target.uri).fsPath), 'words.spp')
})

test('mistakes clear once fixed, before saving', async () => {
  const edit = new vscode.WorkspaceEdit()
  edit.replace(uri, new vscode.Range(3, 10, 3, 21), 'Click the Button "Add"')
  assert.ok(await vscode.workspace.applyEdit(edit))
  await eventually('diagnostics to clear', () => vscode.languages.getDiagnostics(uri).length === 0)
})

test('completion offers what fits first', async () => {
  const edit = new vscode.WorkspaceEdit()
  edit.insert(uri, new vscode.Position(4, 0), '    And I Click the \n')
  assert.ok(await vscode.workspace.applyEdit(edit))
  const list = await eventually('completions', async () => {
    const l = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      uri,
      new vscode.Position(4, 20),
    )
    return l.items.length ? l : null
  })
  const sort = (label) => list.items.find((i) => (i.label.label ?? i.label) === label)?.sortText ?? ''
  assert.ok(sort('Button').startsWith('0'), `Button sorts as ${sort('Button')}`)
  assert.ok(sort('Visit').startsWith('1'), `Visit sorts as ${sort('Visit')}`)
})

test('the code is picked out of the prose', async () => {
  const legend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', uri)
  const tokens = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', uri)
  const text = doc.getText().split('\n')
  const words = []
  for (let i = 0, line = 0, char = 0; i < tokens.data.length; i += 5) {
    const [dl, dc, length, type] = tokens.data.slice(i, i + 4)
    line += dl
    char = dl ? dc : char + dc
    if (line === 2) words.push(`${text[line].slice(char, char + length)}:${legend.tokenTypes[type]}`)
  }
  assert.deepEqual(words, ['When:keyword', 'I:function', 'Add:function', '"Milk":string'])
})

test('Enter after a Define: line indents', async () => {
  const words = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'words.spp'),
  )
  const editor = await vscode.window.showTextDocument(words)
  const end = words.lineAt(0).text.length
  editor.selection = new vscode.Selection(0, end, 0, end)
  await vscode.commands.executeCommand('type', { text: '\n' })
  assert.equal(words.lineAt(1).text, '  ')
})

const guide = () => vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'guide.md').fsPath

test("a Markdown file's ```spp blocks are checked", async () => {
  const uri = vscode.Uri.file(guide())
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
  const found = await eventually('diagnostics', () => {
    const d = vscode.languages.getDiagnostics(uri)
    return d.length ? d : null
  })
  assert.deepEqual(
    found.map((d) => [d.range.start.line, d.range.start.character]),
    [[19, 11]],
  )
})

exports.run = async () => {
  const failures = []
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ok  ${name}`)
    } catch (err) {
      console.log(`  not ok  ${name}\n${err.stack ?? err}`)
      failures.push(name)
    }
  }
  if (failures.length) throw new Error(`${failures.length} of ${tests.length} failed`)
}
