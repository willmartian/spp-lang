// A small Cognate-flavoured interpreter.
//
// Cognate reads like prose because only capitalised words are code: lowercase
// words are comments, and statements run right to left, so a verb written
// first runs last, after everything it acts on has been evaluated.
//
//     Click the Button "Sign in"
//
// pushes "Sign in", Button turns it into a locator, Click clicks it. That is
// the whole trick Spec++ is built on.
//
// Lexical rules follow CognaC (cognate-lang/cognate, src/lexer.l), except:
//
//   - Commas, colons and full stops standing on their own are prose
//     punctuation and skipped, so "Then I See "Welcome"." still parses.
//   - Each line is one statement; there are no semicolons.
//   - Blocks are a colon ending a line plus an indented body, as in Gherkin,
//     not parentheses. Define is a section keyword, like Gherkin's: its
//     colon comes first, "Define: Add", and its body is indented under it.
//   - Comments are Gherkin's: a line starting with #.

import type { Context, Form, Type } from './types.ts'
import { AnyType, article, formsFor, NumberType, signature, TableType, TextType, type } from './types.ts'

export class SppError extends Error {
  pos?: number

  constructor(message: string, pos?: number) {
    super(message)
    this.name = 'SppError'
    this.pos = pos
  }
}

// ---------------------------------------------------------------- syntax

type Located = { pos: number }

export type Node = Located &
  (
    | { type: 'num'; value: number }
    | { type: 'str'; value: string }
    | { type: 'sym'; value: string }
    | { type: 'word'; name: string }
    | { type: 'define'; name: string; params: Param[] }
    | { type: 'block'; body: Program }
  )

// What a Define takes, from its header: "Cart (Source)" is a Cart called
// Source, and a bare "Cart" is a Cart called Cart.
export type Param = Located & { kind: string; name: string }

export type Statement = Node[]
export type Program = Statement[]

type Lexeme =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'sym'; value: string }
  | { type: 'word'; name: string }
  | { type: ':' }
  | { type: '(' }
  | { type: ')' }

// Tokens carry their length, for editors, and their line and that line's
// indentation, which is what blocks are made of.
export type Token = Lexeme & Located & { length: number; line: number; indent: number }

// ---------------------------------------------------------------- lexing

const IDENT = /[A-Z\-?!+/*><=^.][A-Za-z0-9\-?!'+/*>=<^.]*/y
const INFORMAL = /[a-z][a-z0-9'\-?!.]*/y
const NUMBER = /-?(?:[1-9][0-9]*|[0-9])(?:\.[0-9]+)?(?:e-?[0-9]+)?(?=[\s;,:]|$)/y
const SYMBOL = /\\[A-Za-z0-9\-?!'+/*>=<^.]+/y
const STRING = /"((?:\\[abfnrtv\\"]|[^\n"\\])*)"/y
const PROSE = /[,:.]+(?=[\s;]|$)/y
// a colon that opens a block is the last thing on its line
const LINE_END = /[ \t]*(?:\n|$)/y

const ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  '"': '"',
}

export function lex(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 0
  let lineStart = 0
  const at = (re: RegExp, from = i) => {
    re.lastIndex = from
    return re.exec(src)
  }
  const push = (t: Lexeme, length: number) => {
    const indent = src.slice(lineStart, i).search(/[^ \t]|$/)
    tokens.push({ ...t, pos: i, length, line, indent })
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      i++
      line++
      lineStart = i
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    // A comment, as in Gherkin: a line whose first character is #.
    if (c === '#' && !src.slice(lineStart, i).trim()) {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (c === ';') {
      // Silently skipping it would run "A; B" as one statement, right to left.
      throw new SppError('One statement per line: put what comes after the ; on a line of its own', i)
    }
    if (c === '(' || c === ')') {
      // Only a Define's header has them; the parser says so anywhere else.
      push({ type: c }, 1)
      i++
      continue
    }
    const string = at(STRING)
    if (string) {
      push({ type: 'str', value: string[1].replace(/\\(.)/g, (_, e: string) => ESCAPES[e]) }, string[0].length)
      i += string[0].length
      continue
    }
    const number = at(NUMBER)
    if (number) {
      push({ type: 'num', value: Number(number[0]) }, number[0].length)
      i += number[0].length
      continue
    }
    const prose = at(PROSE)
    if (prose) {
      // Punctuation between words isn't code, unless it's the colon that
      // ends a line; the parser decides whether that opens a block.
      if (prose[0].endsWith(':') && at(LINE_END, i + prose[0].length)) push({ type: ':' }, prose[0].length)
      i += prose[0].length
      continue
    }
    const symbol = at(SYMBOL)
    if (symbol) {
      push({ type: 'sym', value: symbol[0].slice(1).toLowerCase() }, symbol[0].length)
      i += symbol[0].length
      continue
    }
    // a lowercase word: a comment
    const informal = at(INFORMAL)
    if (informal) {
      i += informal[0].length
      continue
    }
    const m = at(IDENT)
    if (m) {
      // "Sign-in," or "Visit." — let trailing prose punctuation go
      const name = m[0].replace(/[,:.]+$/, '') || m[0]
      push({ type: 'word', name }, name.length)
      i += name.length
      // The colon in "Define: Add" is a keyword's, as in "Feature:", so it's
      // kept for the parser wherever it is on the line.
      if (/^define$/i.test(name) && src[i] === ':') {
        push({ type: ':' }, 1)
        i++
      }
      continue
    }
    if (c === '"') throw new SppError('Unclosed string', i)
    throw new SppError(`Unexpected character ${JSON.stringify(c)}`, i)
  }
  return tokens
}

// ---------------------------------------------------------------- parsing

type Line = { number: number; indent: number; tokens: Token[] }

// A program is a list of statements, one per line; a statement is a list of
// nodes; a block node holds a program of its own. A line ending in a colon
// takes the more-indented lines after it as a block, placed at the end of
// that line.
export function parse(src: string): Program {
  const lines: Line[] = []
  for (const t of lex(src)) {
    let last = lines.at(-1)
    if (last?.number !== t.line) {
      last = { number: t.line, indent: t.indent, tokens: [] }
      lines.push(last)
    }
    last.tokens.push(t)
  }
  let i = 0

  function body(indent: number): Program {
    const statements: Program = []
    while (i < lines.length && lines[i].indent >= indent) {
      const line = lines[i++]
      if (line.indent > indent) throw new SppError('Unexpected indentation', line.tokens[0].pos)
      const last = line.tokens.at(-1)
      const define = isDefine(line.tokens) ? line.tokens[1] : null
      const colon = define ?? (last?.type === ':' ? last : null)
      const statement = statementOf(line.tokens)
      // A trailing colon with nothing indented under it was just prose; a
      // Define with nothing under it is a mistake.
      const next = lines[i]
      if (colon && next && next.indent > indent) {
        statement.push({ type: 'block', body: body(next.indent), pos: colon.pos })
      } else if (define) {
        throw new SppError(
          `Define: ${statement[0].type === 'define' ? statement[0].name : ''} needs an indented body under it`,
          line.tokens[0].pos,
        )
      }
      if (statement.length) statements.push(statement)
    }
    return statements
  }

  const program = body(lines[0]?.indent ?? 0)
  if (i < lines.length) throw new SppError('Unexpected indentation', lines[i].tokens[0].pos)
  return program
}

// "Define: Add", a Define's header: a section keyword, like "Feature:".
const isDefine = (tokens: Token[]) =>
  tokens[0]?.type === 'word' && /^define$/i.test(tokens[0].name) && tokens[1]?.type === ':'

function statementOf(tokens: Token[]): Statement {
  const first = tokens[0]
  if (isDefine(tokens)) {
    const name = tokens[2]
    if (name?.type !== 'word') throw new SppError('Define: needs a Capitalised name after it', first.pos)
    return [{ type: 'define', name: name.name, params: paramsOf(tokens.slice(3)), pos: first.pos }]
  }
  const statement: Statement = []
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]
    if (t.type === ':') continue
    if (t.type === '(' || t.type === ')') {
      throw new SppError(
        '( ) only name what a Define takes, as in "Define: Move Cart (Source)"; blocks are indented under a colon',
        t.pos,
      )
    }
    if (t.type === 'word' && /^define$/i.test(t.name)) {
      const next = tokens[n + 1]
      if (n > 0 || next?.type === ':')
        throw new SppError('Define: starts a line of its own, with its body indented under it', t.pos)
      // The old way, "Define Add:".
      throw new SppError(
        `Write Define: ${next?.type === 'word' ? next.name : 'Name'}, with the colon after Define, as in Feature:`,
        t.pos,
      )
    }
    statement.push(t)
  }
  return statement
}

// What a Define takes, after its name: each capitalised word is a kind, and
// a word in ( ) after one names it. Lowercase words are prose, as anywhere.
function paramsOf(tokens: Token[]): Param[] {
  const params: Param[] = []
  const wrong = (t: Token) =>
    new SppError("After a Define's name come the kinds it takes, like Text or Element, each maybe named in ( )", t.pos)
  for (let n = 0; n < tokens.length; n++) {
    const t = tokens[n]
    // a trailing colon, as in the old way, is prose
    if (t.type === ':' && n === tokens.length - 1) break
    if (t.type !== 'word') throw wrong(t)
    const param = { kind: t.name, name: t.name, pos: t.pos }
    if (tokens[n + 1]?.type === '(') {
      const [, name, close] = tokens.slice(n + 1, n + 4)
      if (name?.type !== 'word' || close?.type !== ')') {
        throw new SppError(
          `( ) after ${t.name} holds one Capitalised name for it, as in ${t.name} (Source)`,
          tokens[n + 1].pos,
        )
      }
      param.name = name.name
      n += 3
    }
    params.push(param)
  }
  return params
}

// ---------------------------------------------------------------- values

export class Block {
  body: Program
  env: Env

  constructor(body: Program, env: Env) {
    this.body = body
    this.env = env
  }
  toString() {
    return 'a block'
  }
}

export class Sym {
  name: string

  constructor(name: string) {
    this.name = name
  }
  toString() {
    return `\\${this.name}`
  }
}

// A Defined word: its body, and the kinds it takes, named, in reading order.
//
// Its header's kinds are looked up when it's first called, not when it's
// Defined, since a noun it takes may be Defined in a later file.
export class Definition {
  name: string
  block: Block
  header: Param[]
  private resolved?: { name: string; type: Type }[]

  constructor(name: string, block: Block, header: Param[]) {
    this.name = name
    this.block = block
    this.header = header
  }
  get params(): { name: string; type: Type }[] {
    this.resolved ??= resolve(this.header, this.block.env)
    return this.resolved
  }
}

// Every Define of one word, most particular first: those that take more,
// then those whose kinds are narrower (a Cart before an Element, anything
// before Any). A call runs the first whose kinds are on the stack. The checker
// orders them the same way, and says when two could always both fit.
export class Definitions {
  list: Definition[]

  constructor(first: Definition) {
    this.list = [first]
  }
  ordered(): Definition[] {
    return [...this.list].sort((a, b) => b.params.length - a.params.length || specificity(b) - specificity(a))
  }
}

export const specificity = (d: { params: { type: Type }[] }) =>
  d.params.reduce((n, p) => n + (p.type.base ? 2 : p.type === AnyType ? 0 : 1), 0)

// What a noun leaves: a value, labelled with the noun's kind. Words that take
// the kind check the label; any other word gets the value itself.
export class Kinded implements Describable {
  kind: string
  value: unknown

  constructor(kind: string, value: unknown) {
    this.kind = kind
    this.value = value
  }
  describe() {
    return describe(this.value)
  }
}

export const unwrap = (v: unknown) => (v instanceof Kinded ? v.value : v)

// The kind a noun, a Define that leaves one value, makes of what it leaves.
// Only the checker knows what that value is, so here its base is Any.
function nounKind(name: string): Type<Kinded> {
  return {
    name,
    phrase: article(name),
    members: [name],
    base: AnyType,
    test: (v): v is Kinded => v instanceof Kinded && v.kind.toLowerCase() === name.toLowerCase(),
  }
}

// Anything that knows how to name itself in an error message.
export interface Describable {
  describe(): string
}

const isDescribable = (v: unknown): v is Describable =>
  typeof v === 'object' && v !== null && typeof (v as Partial<Describable>).describe === 'function'

export function describe(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (isDescribable(v)) return v.describe()
  return String(v)
}

// ---------------------------------------------------------------- scope

type Word = readonly Form[] | Definitions | { value: unknown }

export class Env {
  parent: Env | null
  // Keyed in lowercase, since only a word's first letter has to be a capital.
  words = new Map<string, Word>()
  // How each word was written where it was made, for editors to offer.
  spellings = new Map<string, string>()
  // The kinds a Define's header can name, keyed in lowercase.
  kinds = new Map<string, Type>()

  constructor(parent: Env | null = null) {
    this.parent = parent
  }
  // A builtin, in one or more forms.
  word(name: string, ...forms: Form[]): this {
    return this.set(name, forms)
  }
  // A Defined word.
  // Another Define of a word adds to it, here; one in an inner scope hides it.
  def(name: string, definition: Definition): this {
    const here = this.words.get(name.toLowerCase())
    if (!(here instanceof Definitions)) return this.set(name, new Definitions(definition))
    here.list.push(definition)
    return this
  }
  // A kind a Define can take, like Text or Element. A noun makes one too.
  kind(t: Type): this {
    this.kinds.set(t.name.toLowerCase(), t)
    return this
  }
  kindOf(name: string): Type | undefined {
    const key = name.toLowerCase()
    for (let e: Env | null = this; e; e = e.parent) if (e.kinds.has(key)) return e.kinds.get(key)
    const word = this.lookup(name)
    if (word instanceof Definitions) return nounKind(word.list[0].name)
  }
  // The built-in kinds, nearest first.
  *builtinKinds(): Generator<Type> {
    for (let e: Env | null = this; e; e = e.parent) yield* e.kinds.values()
  }
  // A value, like what a Define was given, under the name its header gives it.
  bind(name: string, value: unknown): this {
    return this.set(name, { value })
  }
  private set(name: string, word: Word): this {
    this.words.set(name.toLowerCase(), word)
    this.spellings.set(name.toLowerCase(), name)
    return this
  }
  lookup(name: string): Word | undefined {
    const key = name.toLowerCase()
    for (let e: Env | null = this; e; e = e.parent) if (e.words.has(key)) return e.words.get(key)
  }
  // A builtin's forms, or undefined if the word isn't a builtin.
  forms(name: string): readonly Form[] | undefined {
    const word = this.lookup(name)
    return Array.isArray(word) ? word : undefined
  }
  // Every word in scope, as it was spelled.
  *names(): Generator<string> {
    for (let e: Env | null = this; e; e = e.parent) yield* e.spellings.values()
  }
}

// ---------------------------------------------------------------- stack

export class Stack extends Array<unknown> {
  // Pops one value of the given type, for Define, which is syntax, not a
  // word; words say what they take in their forms instead.
  take<T>(word: string, t: Type<T>): T {
    if (!this.length) throw new SppError(`${word} expected ${t.phrase}, but there was nothing left`)
    const v = this.pop()
    if (!t.test(v)) throw new SppError(`${word} expected ${t.phrase}, but got ${describe(v)}`)
    return v
  }
}

// ---------------------------------------------------------------- evaluation

export async function run(program: Program, env: Env, stack: Stack, ctx: Context): Promise<void> {
  for (const statement of program) {
    for (let n = statement.length - 1; n >= 0; n--) {
      const node = statement[n]
      try {
        await evaluate(node, env, stack, ctx)
      } catch (err) {
        // Outermost wins: an error deep inside a Defined word is reported at
        // the word the step actually wrote.
        if (err instanceof Object) (err as { pos?: number }).pos = node.pos
        throw err
      }
    }
  }
}

export async function call(
  block: Block,
  stack: Stack,
  ctx: Context,
  args: Record<string, unknown> = {},
): Promise<void> {
  const env = new Env(block.env)
  for (const [name, value] of Object.entries(args)) env.bind(name, value)
  await run(block.body, env, stack, ctx)
}

// A Definition as a form, so it's called like any word, taking what its
// header says off the stack. Its body runs on a stack of its own, so it can't
// reach into its caller's; what it leaves goes on its caller's.
function formOf(d: Definition, stack: Stack): Form<Context> {
  return {
    inputs: d.params.map((p) => p.type),
    output: null,
    impl: async (ctx, ...args: unknown[]) => {
      const own = new Stack()
      await call(d.block, own, ctx, Object.fromEntries(d.params.map((p, i) => [p.name, args[i]])))
      stack.push(...(isNoun(own, d.block.env) ? [new Kinded(d.name, unwrap(own[0]))] : own))
    },
  }
}

// Whether a Define left what a noun leaves: one value, of a built-in kind
// other than Any. The checker decides the same, from types.
function isNoun(left: unknown[], env: Env): boolean {
  if (left.length !== 1) return false
  return [...env.builtinKinds()].some((k) => k !== AnyType && k.test(unwrap(left[0])))
}

// The kinds a Define's header names, or the first that isn't one.
export function resolve(params: Param[], env: Env): { name: string; type: Type }[] {
  return params.map((p) => {
    const t = env.kindOf(p.kind)
    if (!t) throw Object.assign(new SppError(notAKind(p.kind, env.builtinKinds())), { pos: p.pos })
    return { name: p.name, type: t }
  })
}

export function notAKind(name: string, builtins: Iterable<Type>): string {
  const kinds = [...new Set([...builtins].map((t) => t.name))].join(', ')
  return `${name} isn't a kind a Define can take. The kinds are ${kinds}, and nouns: Defines that leave one of those`
}

// Whether a value is what a form's input takes, and what the form is given.
// A kind's input takes the labelled value; any other, the value itself.
const accepts = (t: Type, v: unknown) => (t.base ? t.test(v) : t.test(unwrap(v)))
const given = (t: Type, v: unknown) => (t.base ? v : unwrap(v))

const BlockType = type('Block', 'an indented block after a colon', (v): v is Block => v instanceof Block)

// Calls the first form whose inputs are on top of the stack. If none are,
// says what was wanted at the first place every form had given up.
export async function apply(name: string, forms: readonly Form[], stack: Stack, ctx: Context): Promise<void> {
  const fits = (f: Form) => f.inputs.every((t, i) => i < stack.length && accepts(t, stack[stack.length - 1 - i]))
  const form = forms.find(fits)
  if (!form) throw mismatch(name, forms, stack)
  const args = form.inputs.map((t) => given(t, stack.pop()))
  const result = await form.impl(ctx, ...args)
  if (!form.output) return
  // A vocabulary bug, not a mistake in the .spp file.
  if (!form.output.test(result)) throw new Error(`${signature(name, form)} left ${describe(result)}`)
  stack.push(result)
}

function mismatch(name: string, forms: readonly Form[], stack: Stack): SppError {
  let live = forms
  for (let i = 0; ; i++) {
    const here = live.filter((f) => f.inputs.length > i)
    const v = stack[stack.length - 1 - i]
    const ok = here.filter((f) => i < stack.length && accepts(f.inputs[i], v))
    if (!ok.length) {
      const wanted = [...new Set(here.map((f) => f.inputs[i].phrase))].join(', or ')
      const got = i < stack.length ? `got ${describe(v)}` : 'there was nothing left'
      return new SppError(`${name} expected ${wanted}, but ${got}`)
    }
    live = ok
  }
}

async function evaluate(node: Node, env: Env, stack: Stack, ctx: Context): Promise<unknown> {
  switch (node.type) {
    case 'num':
    case 'str':
      return void stack.push(node.value)
    case 'sym':
      return void stack.push(new Sym(node.value))
    case 'block':
      return void stack.push(new Block(node.body, env))
    case 'define':
      return void env.def(
        node.name,
        new Definition(node.name, stack.take(`Define ${node.name}`, BlockType), node.params),
      )
    case 'word': {
      const w = env.lookup(node.name)
      if (w === undefined) throw unknownWord(node.name, env.names())
      if (w instanceof Definitions)
        return apply(
          node.name,
          w.ordered().map((d) => formOf(d, stack)),
          stack,
          ctx,
        )
      if (Array.isArray(w)) return apply(node.name, w, stack, ctx)
      return void stack.push((w as { value: unknown }).value)
    }
  }
}

export function unknownWord(name: string, known: Iterable<string>): SppError {
  const near = closest(name.toLowerCase(), new Set(known))
  const guess = near ? `Did you mean ${near[0].toUpperCase() + near.slice(1)}? ` : ''
  return new SppError(`Unknown word ${name}. ${guess}Capitalised words are code; if it's prose, write it in lowercase.`)
}

function closest(word: string, names: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestD = Math.max(2, Math.floor(word.length / 3)) + 1
  for (const n of names) {
    const d = distance(word, n.toLowerCase())
    if (d < bestD) {
      best = n
      bestD = d
    }
  }
  return best
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

// ---------------------------------------------------------------- core words

// Deliberately small: no conditionals, loops or arithmetic. A spec should read
// the same every time it runs, so there's nothing in it to branch on.
export function core(): Env {
  const form = formsFor<Context>()
  return (
    new Env()
      // "Given I Visit ..." — the one capital English can't do without.
      .word(
        'I',
        form([], () => {}),
      )
      .word(
        'Print',
        form([AnyType], (ctx, v) => (ctx.print ?? console.log)(describe(v))),
      )
      .kind(TextType)
      .kind(NumberType)
      .kind(TableType)
      .kind(AnyType)
  )
}
