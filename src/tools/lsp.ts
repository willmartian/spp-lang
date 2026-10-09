// The language server, for any editor that speaks LSP: run it as `spp-lang lsp`.
//
// It works on .spp files, and on the ```spp blocks in Markdown files.
// It keeps every project checked as you type, since Defines are shared
// between a project's files, and answers from that. The projects are what
// the workspace's Playwright config says (see config.ts), each checked on its
// own, so two can Define the same word; it's read again when it changes.
//
//   - diagnostics: the checker's mistakes, and files that don't parse
//   - hover: a word's signatures; a Define's are inferred
//   - go to definition: a Define'd word's Define
//   - references: everywhere a Define'd or built-in word is used
//   - symbols: a file's Defines and scenarios, and a search across the
//     project's, for tools that look things up by name
//   - completion: every word in scope, with the ones that fit first. What
//     fits is worked out from the code to the cursor's left, which runs after
//     whatever is written at the cursor: after "Click the", something on the
//     page.
//   - semantic tokens: the capitalised words that are code, so an editor
//     can pick them out of the prose without a grammar for Spec++

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  CompletionItem,
  DocumentSymbol,
  SymbolKind as Kind,
  Location,
  Diagnostic as LspDiagnostic,
  Position,
  Range,
  SemanticTokensLegend,
  SymbolInformation,
} from 'vscode-languageserver/node'
import server from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { browser } from '../backends/playwright/words.ts'
import type { Project } from '../config.ts'
import { contains, everything, loadProjects } from '../config.ts'
import type { Analysis, Line, Place, WordInfo } from '../language/check.ts'
import { analyze } from '../language/check.ts'
import type { Token } from '../language/cognate.ts'
import { core, lex } from '../language/cognate.ts'
import type { SppFile, Step } from '../language/load.ts'
import { discover, LoadError, loadSource } from '../language/load.ts'
import { sppLines } from '../language/markdown.ts'
import type { CodeLine } from '../language/sections.ts'
import { codeLines } from '../language/sections.ts'
import { leftovers } from '../words/shared.ts'

const {
  CompletionItemKind,
  CompletionTriggerKind,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  ProposedFeatures,
  SemanticTokensBuilder,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
} = server

const TOKEN_TYPES = ['keyword', 'function', 'variable', 'string', 'number', 'comment'] as const
const legend: SemanticTokensLegend = { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [] }
const tokenType = (t: (typeof TOKEN_TYPES)[number]) => TOKEN_TYPES.indexOf(t)

const WORD_CHARS = /[A-Za-z0-9\-?!'+/*>=<^.]*$/

export function startServer(): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
  const documents = new TextDocuments(TextDocument)
  const words = browser(core())

  let roots: string[] = []
  // Every root's projects: every .spp file under it until its config is loaded.
  let projects: Project[] = []
  let trusted = true
  let onDisk: string[] = []
  // Each project's checked files.
  let analyses = new Map<Project, Analysis>()
  let steps = new Map<string, Step>()
  // Every file's text, open or not, and what it loaded as.
  let sources = new Map<string, string>()
  let loaded: SppFile[] = []
  let published = new Set<string>()

  const toPath = (uri: string) => fileURLToPath(uri)
  const toUri = (file: string) => pathToFileURL(file).href

  connection.onInitialize((params) => {
    roots = (params.workspaceFolders ?? []).map((f) => toPath(f.uri))
    if (!roots.length && params.rootUri) roots = [toPath(params.rootUri)]
    projects = roots.map(everything)
    // A client can say the workspace isn't trusted, so its config mustn't run.
    trusted = (params.initializationOptions as { trusted?: boolean } | undefined)?.trusted !== false
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        completionProvider: {},
        semanticTokensProvider: { legend, full: true },
      },
    }
  })

  // ---------------------------------------------------------------- checking

  function rediscover() {
    onDisk = [...new Set(projects.flatMap((p) => discover(p.features, p.root, p.ignore)))]
  }

  async function reloadProjects() {
    const found = await Promise.all(
      roots.map((root) =>
        loadProjects(root, { trusted }).catch((err: Error) => {
          connection.window.showErrorMessage(`Spec++: ${err.message}`)
          return [everything(root)]
        }),
      ),
    )
    projects = found.flat()
  }

  // The projects a file is in. One that's in none, like a file open from
  // elsewhere, is checked with the project of the root it's under, or the first.
  const within = (file: string, dir: string) => file === dir || file.startsWith(dir + path.sep)
  function projectsOf(file: string): Project[] {
    const own = projects.filter((p) => contains(p, file))
    if (own.length) return own
    const home = projects.find((p) => within(file, p.root)) ?? projects[0]
    return home ? [home] : []
  }
  const analysisOf = (file: string): Analysis | undefined => {
    const [project] = projectsOf(file)
    return project && analyses.get(project)
  }

  function refresh() {
    sources = new Map()
    for (const file of onDisk) if (fs.existsSync(file)) sources.set(file, fs.readFileSync(file, 'utf8'))
    for (const doc of documents.all()) if (/\.(spp|md)$/.test(doc.uri)) sources.set(toPath(doc.uri), doc.getText())

    const problems = new Map<string, LspDiagnostic[]>()
    const add = (file: string, line: number, column: number, message: string) => {
      const list = problems.get(file) ?? []
      if (
        list.some(
          (d) => d.range.start.line === line - 1 && d.range.start.character === column - 1 && d.message === message,
        )
      )
        return
      list.push({
        range: rangeAt(sources.get(file) ?? '', line, column),
        message,
        severity: DiagnosticSeverity.Error,
        source: 'spp',
      })
      problems.set(file, list)
    }

    loaded = []
    for (const [file, src] of sources) {
      try {
        loaded.push(loadSource(file, src))
      } catch (err) {
        if (!(err instanceof LoadError)) throw err
        for (const p of err.problems) add(file, p.line, p.column, p.message)
      }
    }

    const members = new Map<Project, SppFile[]>()
    for (const f of loaded) for (const p of projectsOf(f.file)) members.set(p, [...(members.get(p) ?? []), f])
    analyses = new Map()
    for (const [project, files] of members) {
      const analysis = analyze(files, { words, settle: leftovers, cwd: roots[0] })
      analyses.set(project, analysis)
      for (const d of [...analysis.report.vocabulary, ...analysis.report.scenarios.values()])
        add(d.file, d.line, d.column, d.message)
    }
    steps = new Map()
    for (const { features } of loaded) {
      for (const scenario of features.flatMap((f) => f.scenarios)) {
        for (const step of scenario.steps)
          if (!steps.has(key(step.file, step.line))) steps.set(key(step.file, step.line), step)
      }
    }

    for (const file of new Set([...published, ...problems.keys()])) {
      connection.sendDiagnostics({ uri: toUri(file), diagnostics: problems.get(file) ?? [] })
    }
    published = new Set(problems.keys())
  }

  let timer: NodeJS.Timeout | undefined
  const soon = () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 150)
  }

  connection.onInitialized(async () => {
    await reloadProjects()
    rediscover()
    refresh()
  })
  documents.onDidChangeContent(soon)
  documents.onDidSave(() => {
    rediscover()
    soon()
  })
  documents.onDidOpen(() => {
    rediscover()
    soon()
  })
  connection.onDidChangeWatchedFiles(async ({ changes }) => {
    if (changes.some((c) => /^playwright\.config\.[cm]?[jt]s$/.test(path.basename(toPath(c.uri)))))
      await reloadProjects()
    rediscover()
    soon()
  })

  // ---------------------------------------------------------------- words

  const key = (file: string, line: number) => `${file}:${line}`
  // Open files as they are in the editor, others as they were last read.
  const textOf = (file: string) => documents.get(toUri(file))?.getText() ?? sources.get(file)
  // What the checker should be asked about a line: its step, or, elsewhere,
  // the line itself, which in a Define's body sees what the header takes.
  const stepAt = (file: string, line: number): Step | Line => steps.get(key(file, line + 1)) ?? { file, line: line + 1 }

  // A word where it's written: its name, the step it's in, and whether it's
  // the name a Define declares.
  interface Written {
    name: string
    file: string
    line: number
    character: number
    step: Step | Line
    declares: boolean
  }

  const written = (file: string, line: number, code: CodeLine, t: Token & { type: 'word' }): Written => ({
    name: t.name,
    file,
    line,
    character: code.offset + t.pos,
    step: stepAt(file, line),
    declares: /^\s*Define:?\s*$/i.test(code.text.slice(0, t.pos)),
  })

  // The code on a line, and the word the cursor is on, if any.
  function wordAt(uri: string, position: Position): (Written & { range: Range }) | null {
    const file = toPath(uri)
    const code = codeLines(textOf(file) ?? '', file)[position.line]
    if (!code) return null
    const c = position.character - code.offset
    const word = tokensOf(code).find((t) => t.type === 'word' && t.pos <= c && c <= t.pos + t.length)
    if (word?.type !== 'word') return null
    const at = written(file, position.line, code, word)
    const end = at.character + word.length
    return {
      ...at,
      range: { start: { line: position.line, character: at.character }, end: { line: position.line, character: end } },
    }
  }

  // The Define a written word is: the one it declares, or the one that use
  // runs, which for a word with several Defines depends on what it's given.
  function defineOf(w: Written, info: WordInfo): Place | undefined {
    if (info.kind !== 'define') return
    const places = info.places ?? []
    if (w.declares) return places.find((p) => p.file === w.file && p.line === w.line + 1) ?? info.at
    return analysisOf(w.file)?.chosen(w.file, w.line + 1, w.character + 1) ?? info.at
  }

  connection.onHover(({ textDocument, position }) => {
    const at = wordAt(textDocument.uri, position)
    const info = at && analysisOf(at.file)?.word(at.name, at.step)
    if (!at || !info) return null
    // A use of a word with several Defines shows the one it runs.
    let shown = info.signatures
    let places = info.places ?? []
    const place = defineOf(at, info)
    const i = place && places.length > 1 ? places.indexOf(place) : -1
    if (i >= 0) {
      shown = [shown[i]]
      places = [places[i]]
    }
    const where = places.map((p) => `\n\nDefined at ${path.relative(roots[0] ?? '', p.file)}:${p.line}`).join('')
    return {
      contents: { kind: MarkupKind.Markdown, value: signatures({ ...info, signatures: shown }) + where },
      range: at.range,
    }
  })

  connection.onDefinition(({ textDocument, position }) => {
    const at = wordAt(textDocument.uri, position)
    const info = at && analysisOf(at.file)?.word(at.name, at.step)
    const place = info && defineOf(at, info)
    if (!info || !place) return null
    // The name after "Define", as references point at it.
    const text = (textOf(place.file) ?? '').split('\n')[place.line - 1] ?? ''
    const character = place.column - 1 + (/^Define:?\s+/i.exec(text.slice(place.column - 1))?.[0].length ?? 0)
    const start = { line: place.line - 1, character }
    return { uri: toUri(place.file), range: { start, end: { ...start, character: character + info.name.length } } }
  })

  // What a word is, so that uses of the same one can be matched: a Define by
  // where it's Defined, a builtin by name. What a Define was given isn't
  // matched, since it's only there in that Define.
  function identity(w: Written): string | null {
    const info = analysisOf(w.file)?.word(w.name, w.step)
    if (!info) return null
    const place = defineOf(w, info)
    if (place) return key(place.file, place.line)
    return info.kind === 'builtin' ? `builtin:${info.name.toLowerCase()}` : null
  }

  connection.onReferences(({ textDocument, position, context }): Location[] => {
    const at = wordAt(textDocument.uri, position)
    const wanted = at && identity(at)
    if (!at || !wanted) return []
    const found: Location[] = []
    for (const file of sources.keys()) {
      codeLines(textOf(file) ?? '', file).forEach((code, line) => {
        if (!code) return
        for (const t of tokensOf(code)) {
          if (t.type !== 'word' || t.name.toLowerCase() !== at.name.toLowerCase()) continue
          const w = written(file, line, code, t)
          if (identity(w) !== wanted || (w.declares && !context.includeDeclaration)) continue
          const start = w.character
          found.push({
            uri: toUri(file),
            range: { start: { line, character: start }, end: { line, character: start + t.length } },
          })
        }
      })
    }
    return found
  })

  // A file's Defines, then its Features with their scenarios. An Outline's rows
  // are one scenario each to the checker, but one symbol here.
  function symbolsIn(file: string): FileSymbol[] {
    const symbols: FileSymbol[] = []
    for (const w of analysisOf(file)?.words() ?? []) {
      for (const p of w.places ?? [])
        if (p.file === file) symbols.push({ name: w.name, kind: SymbolKind.Function, line: p.line })
    }
    for (const feature of loaded.find((f) => f.file === file)?.features ?? []) {
      const children = new Map<number, { name: string; line: number }>()
      for (const s of feature.scenarios) {
        const line = s.outline?.line ?? s.line
        if (!children.has(line)) children.set(line, { name: s.outline?.name ?? s.name, line })
      }
      symbols.push({
        name: feature.name,
        kind: SymbolKind.Module,
        line: feature.line,
        children: [...children.values()],
      })
    }
    return symbols
  }

  const lineRange = (file: string, line: number): Range => {
    const text = (textOf(file) ?? '').split('\n')[line - 1] ?? ''
    const start = text.length - text.trimStart().length
    return { start: { line: line - 1, character: start }, end: { line: line - 1, character: text.length } }
  }

  connection.onDocumentSymbol(({ textDocument }): DocumentSymbol[] => {
    const file = toPath(textDocument.uri)
    const symbol = (name: string, kind: Kind, line: number): DocumentSymbol => ({
      name,
      kind,
      range: lineRange(file, line),
      selectionRange: lineRange(file, line),
    })
    return symbolsIn(file).map((s) => ({
      ...symbol(s.name, s.kind, s.line),
      children: s.children?.map((c) => symbol(c.name, SymbolKind.Method, c.line)),
    }))
  })

  connection.onWorkspaceSymbol(({ query }): SymbolInformation[] => {
    const q = query.toLowerCase()
    const found: SymbolInformation[] = []
    const add = (file: string, name: string, kind: Kind, line: number, containerName?: string) => {
      if (name.toLowerCase().includes(q))
        found.push({ name, kind, location: { uri: toUri(file), range: lineRange(file, line) }, containerName })
    }
    for (const file of sources.keys()) {
      for (const s of symbolsIn(file)) {
        add(file, s.name, s.kind, s.line)
        for (const c of s.children ?? []) add(file, c.name, SymbolKind.Method, c.line, s.name)
      }
    }
    return found
  })

  connection.onCompletion(({ textDocument, position, context }): CompletionItem[] => {
    const doc = documents.get(textDocument.uri)
    const analysis = analysisOf(toPath(textDocument.uri))
    if (!doc || !analysis) return []
    const code = codeLines(doc.getText(), toPath(textDocument.uri))[position.line]
    const c = position.character - (code?.offset ?? 0)
    if (!code || c < 0) return []
    const before = code.text.slice(0, c)
    // Not inside a string, and not in the middle of a lowercase word, which
    // is prose. Offer everything only when asked outright.
    if ((before.match(/"/g)?.length ?? 0) % 2) return []
    const partial = WORD_CHARS.exec(before)?.[0] ?? ''
    if (partial ? !/^[A-Z]/.test(partial) : context?.triggerKind !== CompletionTriggerKind.Invoked) return []

    const step = stepAt(toPath(textDocument.uri), position.line)
    const expected = analysis.expected(before.slice(0, before.length - partial.length), step)
    const wanted = expected?.members
    const fits = (info: WordInfo) =>
      !!wanted && info.outputs.some((o) => !!o?.length && o.every((m) => wanted.includes(m)))

    const items: CompletionItem[] = analysis.words(step).map((info) => ({
      label: info.name,
      kind:
        info.kind === 'value'
          ? CompletionItemKind.Variable
          : info.kind === 'define'
            ? CompletionItemKind.Function
            : CompletionItemKind.Keyword,
      detail: info.signatures[0],
      documentation: { kind: MarkupKind.Markdown, value: signatures(info) },
      sortText: `${fits(info) ? 0 : 1}${info.name.toLowerCase()}`,
    }))
    if (!partial && expected?.members?.includes('Text')) {
      items.push({
        label: '"…"',
        kind: CompletionItemKind.Value,
        detail: expected.phrase,
        insertText: '"$1"',
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: '0',
      })
    }
    return items
  })

  // ---------------------------------------------------------------- highlighting

  connection.languages.semanticTokens.on(({ textDocument }) => {
    const builder = new SemanticTokensBuilder()
    const doc = documents.get(textDocument.uri)
    if (!doc) return builder.build()
    const file = toPath(textDocument.uri)
    const text = doc.getText()
    const lines = text.split('\n')
    const code = codeLines(text, file)
    const spp = sppLines(file, text)
    for (const [i, line] of lines.entries()) {
      // In Markdown, only the ```spp blocks.
      if (!spp[i]) continue
      const comment = /^(\s*)#/.exec(line)
      if (comment) {
        builder.push(i, comment[1].length, line.length - comment[1].length, tokenType('comment'), 0)
        continue
      }
      const structure =
        /^(\s*)((?:Feature|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios|Rule):)/.exec(
          line,
        )
      if (structure) {
        builder.push(i, structure[1].length, structure[2].length, tokenType('keyword'), 0)
        continue
      }
      const here = code[i]
      if (!here) continue
      if (here.keyword) builder.push(i, here.keyword.offset, here.keyword.length, tokenType('keyword'), 0)
      const step = stepAt(file, i)
      const analysis = analysisOf(file)
      for (const t of tokensOf(here)) {
        const kind =
          t.type === 'word'
            ? /^define$/i.test(t.name)
              ? 'keyword'
              : analysis?.word(t.name, step)?.kind === 'value'
                ? 'variable'
                : 'function'
            : t.type === 'num'
              ? 'number'
              : t.type === 'str' || t.type === 'sym'
                ? 'string'
                : null
        if (kind) builder.push(i, here.offset + t.pos, t.length, tokenType(kind), 0)
      }
    }
    return builder.build()
  })

  documents.listen(connection)
  connection.listen()
}

// ---------------------------------------------------------------- helpers

// A Define, or a Feature and its scenarios, by name and line.
interface FileSymbol {
  name: string
  kind: Kind
  line: number
  children?: { name: string; line: number }[]
}

function signatures(info: WordInfo): string {
  return `\`\`\`\n${info.signatures.join('\n')}\n\`\`\``
}

// A line's tokens, or as many as can be made out while it's being typed.
function tokensOf(code: CodeLine): Token[] {
  try {
    return lex(code.text)
  } catch {
    const cut = code.text.lastIndexOf('"')
    try {
      return cut > 0 ? lex(code.text.slice(0, cut)) : []
    } catch {
      return []
    }
  }
}

// From where a diagnostic points to the end of the word or string there.
function rangeAt(src: string, line: number, column: number): Range {
  const text = src.split('\n')[line - 1] ?? ''
  const start = column - 1
  const length = /^("(?:[^"\\]|\\.)*"?|\S+)/.exec(text.slice(start))?.[0].length ?? 1
  return {
    start: { line: line - 1, character: start },
    end: { line: line - 1, character: start + Math.max(1, length) },
  }
}
