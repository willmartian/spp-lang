// The checker: runs every step on a stack of types instead of values, so
// mistakes show up before a browser starts.
//
// It uses the forms the runtime uses, and picks between them the same way:
// the first whose inputs are on top of the stack. With no conditionals or
// loops, every step is straight-line code, so one pass is the whole story.
//
// A Define's header says what it takes: "Define: Add Text (Item)" takes Text,
// called Item in its body, so Add : Text ->. Its body is checked with those,
// and can't take anything else from its caller. What it leaves is worked out.
//
// A Define that leaves one thing of a built-in kind is a noun, and makes a
// kind of its own: "Define: Cart" leaving an Element makes Cart, a narrower
// Element, which other Defines' headers can take.
//
// A word can have several Defines, told apart by what they take. A use runs
// the first that fits, most particular first, as the runtime does
// (Definitions in cognate.ts). Two that could always both fit are a mistake
// in the Defines, so a use never has to guess.

import path from 'node:path'
import type { Env, Node, Param, Program } from './cognate.ts'
import { notAKind, parse, SppError, specificity, unknownWord } from './cognate.ts'
import type { Scenario, SppFile, Step, Vocabulary } from './load.ts'
import { lineCol } from './load.ts'
import { keywordForms, keywords, StepType } from './steps.ts'
import type { Form, Type } from './types.ts'
import { AnyType, article, NumberType, signature, TableType, TextType, type } from './types.ts'

export interface Diagnostic {
  file: string
  line: number
  column: number
  message: string
  // the Define it's in, if any
  define?: string
}

export interface Report {
  // mistakes in Defines and the rest of the vocabulary, once each
  vocabulary: Diagnostic[]
  // each scenario's first mistake
  scenarios: Map<Scenario, Diagnostic>
}

export interface CheckOptions {
  // the builtin words, whose forms the checker reads
  words: Env
  // the end-of-step rule: what's wrong with leaving values of these types, if anything
  settle: (stack: { name: string; shown: string }[]) => string | null
  // where paths in messages are relative to
  cwd?: string
}

// ---------------------------------------------------------------- static values

// The keyword words, for their forms; the checker runs steps itself.
const KEYWORDS = keywords(async () => {})

const SymbolType = type('Symbol', 'a symbol', (v): v is unknown => false)

// A value a Define's body takes from its caller. members is what it can
// still be, narrowed by each use; null until something uses it.
class Var {
  members: readonly string[] | null = null
  phrase = 'a value'
}

// A block, waiting for Define to take it.
class BlockOf {
  body: Program
  scope: Scope
  origin: Origin

  constructor(body: Program, scope: Scope, origin: Origin) {
    this.body = body
    this.scope = scope
    this.origin = origin
  }
}

type Ty = Type<unknown> | Var | BlockOf

// A value on the checker's stack: its type, and how to show it in a message.
interface Val {
  ty: Ty
  shown: string
}

const membersOf = (ty: Ty): readonly string[] | null =>
  ty instanceof Var ? ty.members : ty instanceof BlockOf ? ['Block'] : ty.name === AnyType.name ? null : ty.members

const nameOf = (ty: Ty): string => membersOf(ty)?.join(' | ') ?? 'Any'

// A variable is shown as what it's been narrowed to so far.
const show = (v: Val): string => (v.ty instanceof Var ? v.ty.phrase : v.shown)

// What a word's input slot accepts. key tells slots apart when comparing forms.
interface Want {
  members: readonly string[] | null
  phrase: string
  key: unknown
}

// One way a word can be called: a builtin form, or a Define's inferred effect.
interface Way {
  inputs: Want[]
  outputs: (args: Val[]) => Val[]
  // the Define it is, for a Define's
  def?: Def
}

// ---------------------------------------------------------------- places

interface Origin {
  file: string
  at(pos: number): { line: number; column: number }
}

const stepOrigin = (step: Step): Origin => ({
  file: step.file,
  at: (pos) => ({ line: step.line, column: step.column + pos }),
})

const fileOrigin = (v: Vocabulary): Origin => ({ file: v.file, at: (pos) => lineCol(v.src, pos) })

class Mistake extends Error {
  pos?: number
}

// ---------------------------------------------------------------- scope

export interface Place {
  file: string
  line: number
  column: number
}

interface Def {
  name: string
  block: BlockOf
  // where its Define is
  at: Place
  // its header, and, once checked, the kinds it names
  header: Param[]
  params: { name: string; type: Type<unknown> }[]
  state: 'unchecked' | 'checking' | 'done'
  // what its body leaves, once checked
  outputs?: Val[]
  // the kind it makes, if it's a noun
  noun?: Type<unknown>
  error?: Diagnostic
}

// A word the checker knows, under the name it was written with.
type Known = { name: string } & (
  | { kind: 'forms'; forms: readonly Form[] }
  | { kind: 'define'; defs: Def[] }
  | { kind: 'value'; val: Val }
)

class Scope {
  parent: Scope | null
  builtins: Env | null
  words = new Map<string, Known>()

  constructor(parent: Scope | null, builtins: Env | null = null) {
    this.parent = parent
    this.builtins = builtins
  }
  set(known: Known) {
    this.words.set(known.name.toLowerCase(), known)
  }
  lookup(name: string): Known | undefined {
    const key = name.toLowerCase()
    for (let s: Scope | null = this; s; s = s.parent) {
      const known = s.words.get(key)
      if (known) return known
      const forms = s.builtins?.forms(name)
      if (s.builtins && forms) return { name: s.builtins.spellings.get(key) ?? name, kind: 'forms', forms }
    }
  }
  *names(): Generator<string> {
    for (let s: Scope | null = this; s; s = s.parent) {
      for (const known of s.words.values()) yield known.name
      if (s.builtins) yield* s.builtins.names()
    }
  }
  // Everything visible from here, nearest first, each name once.
  all(): Known[] {
    const seen = new Set<string>()
    return [...this.names()].flatMap((name) => {
      const key = name.toLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      const known = this.lookup(name)
      return known ? [known] : []
    })
  }
}

// The stack a statement runs on. An open stack belongs to an editor's guess
// at what comes next: reaching below its bottom takes a value that isn't
// written yet, which becomes one of its inputs. Otherwise the stack is
// closed; there's nothing below.
class Sim {
  open: boolean
  stack: Val[] = []
  inputs: Var[] = []

  constructor(open: boolean) {
    this.open = open
  }
  // What's i from the top, or undefined if that's below the bottom.
  peek(i: number): Val | undefined {
    return this.stack[this.stack.length - 1 - i]
  }
  // A new value from the caller, for a slot below the bottom.
  fromCaller(want?: Want): Val {
    const v = new Var()
    if (want) {
      v.members = want.members
      v.phrase = want.phrase
    }
    this.inputs.push(v)
    return { ty: v, shown: v.phrase }
  }
}

// ---------------------------------------------------------------- checking

export function check(files: SppFile[], options: CheckOptions): Report {
  return analyze(files, options).report
}

// Everything an editor wants to know about a word.
export interface WordInfo {
  name: string
  kind: 'builtin' | 'define' | 'value'
  // "Click : Element ->", one per form
  signatures: string[]
  // the base types each form leaves, or null for a form that leaves anything
  outputs: (readonly string[] | null)[]
  // where it's Defined, for a Define: its first Define, and each of them, in
  // the order of signatures
  at?: Place
  places?: Place[]
}

// A line of a file, for an editor asking about a Define's body.
export interface Line {
  file: string
  line: number
}

// A checked project, which can also be asked about words and types, for
// an editor. Where a step or a line is given, it's the scope that step, or
// that line of a Define's body, sees: in a body, what its header takes.
export class Analysis {
  report: Report
  private checker: Checker

  constructor(checker: Checker) {
    this.checker = checker
    this.report = checker.report
  }

  words(at?: Step | Line): WordInfo[] {
    return this.checker
      .scopeFor(at)
      .all()
      .map((known) => this.checker.info(known))
  }

  word(name: string, at?: Step | Line): WordInfo | undefined {
    const known = this.checker.scopeFor(at).lookup(name)
    return known && this.checker.info(known)
  }

  // What a value would need to be, written after the code in left: in
  // "Fill the Field "Email" with ", Fill needs its text. null when it
  // could be anything, or left can't be read.
  expected(left: string, at?: Step | Line): { members: readonly string[] | null; phrase: string } | null {
    return this.checker.expected(left, this.checker.scopeFor(at))
  }

  // Where the Define is that a use of a word, at this place, runs.
  chosen(file: string, line: number, column: number): Place | undefined {
    return this.checker.chosen.get(placeKey({ file, line, column }))?.at
  }
}

const placeKey = (p: Place) => `${p.file}:${p.line}:${p.column}`

export function analyze(files: SppFile[], options: CheckOptions): Analysis {
  const checker = new Checker(options)
  checker.check(files)
  return new Analysis(checker)
}

class Checker {
  options: CheckOptions
  cwd: string
  defs: Def[] = []
  report: Report = { vocabulary: [], scenarios: new Map() }
  vocabulary!: Scope
  // what each step, and each line of a Define, sees, for an editor
  stepScopes = new Map<Step, Scope>()
  lineScopes = new Map<string, Scope>()
  // answering an editor, which wants a best guess rather than a mistake
  guessing = false
  // which Define each use of a Defined word runs, by where the use is
  chosen = new Map<string, Def>()

  constructor(options: CheckOptions) {
    this.options = options
    this.cwd = options.cwd ?? process.cwd()
  }

  check(files: SppFile[]): Report {
    // Every file's Defines share one scope, as they do when the tests run.
    const vocabulary = new Scope(new Scope(null, this.options.words))
    this.vocabulary = vocabulary
    for (const v of files.flatMap((f) => f.vocabulary)) {
      const origin = fileOrigin(v)
      try {
        const sim = new Sim(false)
        this.run(v.program, vocabulary, sim, origin)
        this.settle(sim)
      } catch (err) {
        this.report.vocabulary.push(this.diagnose(err, origin))
      }
    }
    // Defines are checked once all of them are known, since a Define can use
    // one from a later file. Unused ones are checked too.
    for (const def of this.defs) {
      this.checkDefine(def)
      if (def.error) this.report.vocabulary.push(def.error)
    }
    this.overloads(vocabulary)
    for (const { features } of files) {
      for (const scenario of features.flatMap((f) => f.scenarios)) {
        const problem = this.scenario(scenario, vocabulary)
        if (problem) this.report.scenarios.set(scenario, problem)
      }
    }
    return this.report
  }

  scenario(scenario: Scenario, vocabulary: Scope): Diagnostic | undefined {
    const scope = new Scope(vocabulary)
    // The scenario's own stack, where each keyword leaves its mode.
    const modes = new Sim(false)
    for (const step of scenario.steps) {
      const origin = stepOrigin(step)
      this.stepScopes.set(step, scope)
      try {
        if (step.error !== undefined) throw step.error
        // Its keyword takes the step, and the mode above it if it needs one.
        modes.stack.push({ ty: StepType, shown: 'the step' })
        try {
          const forms = keywordForms(KEYWORDS, step.keywordType)
          this.call(
            step.keyword.trim(),
            forms.map((f) => this.formWay(step.keyword.trim(), f)),
            modes,
          )
        } catch (err) {
          if (err instanceof Mistake) err.pos = -step.keyword.length
          throw err
        }
        const sim = new Sim(false)
        if (typeof step.argument === 'string') sim.stack.push({ ty: TextType, shown: JSON.stringify(step.argument) })
        else if (step.argument) sim.stack.push({ ty: TableType, shown: 'the table' })
        this.run(step.program ?? [], scope, sim, origin)
        this.settle(sim)
      } catch (err) {
        return this.diagnose(err, origin)
      }
    }
  }

  settle(sim: Sim) {
    // A noun's value is settled as what it is underneath.
    const problem = this.options.settle(
      sim.stack.map((v) => ({ name: nameOf(isType(v.ty) ? root(v.ty) : v.ty), shown: show(v) })),
    )
    if (problem) throw new Mistake(problem)
  }

  // ---------------------------------------------------------------- for editors

  scopeFor(at?: Step | Line): Scope {
    const scope = at && ('keyword' in at ? this.stepScopes.get(at) : this.lineScopes.get(`${at.file}:${at.line}`))
    return scope ?? this.vocabulary
  }

  info(known: Known): WordInfo {
    const { name } = known
    if (known.kind === 'forms') {
      return {
        name,
        kind: 'builtin',
        signatures: known.forms.map((f) => signature(name, f)),
        outputs: known.forms.map((f) => (f.output ? membersOf(f.output) : [])),
      }
    }
    if (known.kind === 'value') {
      return {
        name,
        kind: 'value',
        signatures: [`${name} : ${nameOf(known.val.ty)}`],
        outputs: [membersOf(known.val.ty)],
      }
    }
    const signatures: string[] = []
    const outputs: (readonly string[] | null)[] = []
    for (const def of known.defs) {
      this.checkDefine(def)
      if (!def.outputs) {
        signatures.push(`${name} : (has a mistake)`)
        continue
      }
      const inputs = def.params.map((p) => p.type.name + (p.name !== p.type.name ? ` (${p.name})` : '')).join(', ')
      const leaves = def.noun ? def.noun.name : def.outputs.map((o) => nameOf(o.ty)).join(', ')
      signatures.push(`${name} : ${inputs}${inputs ? ' ' : ''}->${leaves ? ` ${leaves}` : ''}`)
      const last = def.outputs.at(-1)
      // A noun leaves its kind, and is offered where what it narrows is wanted.
      outputs.push(...(def.noun ? [def.noun.members, root(def.noun).members] : [last ? membersOf(last.ty) : []]))
    }
    const places = known.defs.map((d) => d.at)
    return { name, kind: 'define', signatures, outputs, at: places[0], places }
  }

  expected(left: string, scope: Scope): { members: readonly string[] | null; phrase: string } | null {
    // Whatever's written next runs before left does, so left finds it on
    // top of the stack: the first thing left takes from below is it.
    let program: Program
    try {
      program = parse(left)
    } catch {
      return null
    }
    const statement = program.at(-1)
    if (!statement) return null
    const sim = new Sim(true)
    this.guessing = true
    try {
      this.run([statement], new Scope(scope), sim, { file: '', at: () => ({ line: 0, column: 0 }) })
    } catch {
      return null
    } finally {
      this.guessing = false
    }
    const next = sim.inputs[0]
    return next ? { members: next.members, phrase: next.phrase } : null
  }

  diagnose(err: unknown, origin: Origin, define?: string): Diagnostic {
    if (!(err instanceof Error)) throw err
    // Anything but a mistake in the .spp file is a bug in Spec++.
    if (!(err instanceof Mistake) && err.name !== 'SppError') throw err
    const { line, column } = origin.at((err as Mistake).pos ?? 0)
    return { file: origin.file, line, column, message: err.message, define }
  }

  // Statements run in order, each right to left, as they do for real.
  run(program: Program, scope: Scope, sim: Sim, origin: Origin) {
    for (const statement of program) {
      for (let n = statement.length - 1; n >= 0; n--) {
        const node = statement[n]
        try {
          this.evaluate(node, scope, sim, origin)
        } catch (err) {
          if (err instanceof Mistake && err.pos === undefined) err.pos = node.pos
          throw err
        }
      }
    }
  }

  evaluate(node: Node, scope: Scope, sim: Sim, origin: Origin) {
    switch (node.type) {
      case 'str':
        return void sim.stack.push({ ty: TextType, shown: JSON.stringify(node.value) })
      case 'num':
        return void sim.stack.push({ ty: NumberType, shown: String(node.value) })
      case 'sym':
        return void sim.stack.push({ ty: SymbolType, shown: `\\${node.value}` })
      case 'block':
        return void sim.stack.push({ ty: new BlockOf(node.body, scope, origin), shown: 'a block' })
      case 'define': {
        const block = this.take(sim, `Define ${node.name}`)
        if (!(block.ty instanceof BlockOf)) {
          throw new Mistake(`Define ${node.name} expected an indented block after a colon, but got ${block.shown}`)
        }
        // Its header is checked with its body, once every Define is known,
        // since it may take a noun Defined later.
        const def: Def = {
          name: node.name,
          block: block.ty,
          at: { file: origin.file, ...origin.at(node.pos) },
          header: node.params,
          params: [],
          state: 'unchecked',
        }
        this.defs.push(def)
        const here = scope.words.get(node.name.toLowerCase())
        if (here?.kind === 'define') return void here.defs.push(def)
        return scope.set({ name: node.name, kind: 'define', defs: [def] })
      }
      case 'word': {
        const known = scope.lookup(node.name)
        if (!known) throw new Mistake(unknownWord(node.name, scope.names()).message)
        if (known.kind === 'value') return void sim.stack.push(known.val)
        if (known.kind === 'forms')
          return this.call(
            node.name,
            known.forms.map((f) => this.formWay(node.name, f)),
            sim,
          )
        const way = this.call(node.name, this.defineWays(known.defs), sim)
        if (way.def && !this.guessing) this.chosen.set(placeKey({ file: origin.file, ...origin.at(node.pos) }), way.def)
        return
      }
    }
  }

  // What a Define's header takes, checked.
  params(def: Def): { name: string; type: Type<unknown> }[] {
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    return def.header.map((p, i) => {
      const at = (message: string) => Object.assign(new SppError(message), { pos: p.pos })
      if (def.header.findIndex((q) => same(q.name, p.name)) < i) {
        throw at(`Two things are called ${p.name}. Name them, as in ${p.kind} (Source) and ${p.kind} (Target)`)
      }
      // The name hides the word in the body. That's the point for a noun
      // taken by its own name, a Cart called Cart; anything else is a mistake.
      const hidden = def.block.scope.lookup(p.name)
      if (hidden && !(hidden.kind === 'define' && same(p.name, p.kind))) {
        throw at(
          same(p.name, p.kind)
            ? `${p.name} is already a word, so name this one, as in ${p.kind} (Item)`
            : `${p.name} is already a word, so call this one something else`,
        )
      }
      try {
        return { name: p.name, type: this.kindOf(p.kind, def.block.scope) }
      } catch (err) {
        if (err instanceof Mistake && err.pos === undefined) err.pos = p.pos
        throw err
      }
    })
  }

  // A kind a header names: a built-in one, or a noun's.
  kindOf(name: string, scope: Scope): Type<unknown> {
    const builtin = this.options.words.kindOf(name)
    if (builtin) return builtin
    const known = scope.lookup(name)
    if (known?.kind !== 'define') throw new Mistake(notAKind(name, this.options.words.builtinKinds()))
    if (known.defs.length > 1)
      throw new Mistake(`${name} can't be a kind: a noun has one Define, and it has ${known.defs.length}`)
    const [def] = known.defs
    this.checkDefine(def)
    if (def.error)
      throw new Mistake(`${def.name} can't be a kind: its Define has a mistake, at ${this.where(def.error)}`)
    if (!def.noun) {
      throw new Mistake(
        `${def.name} can't be a kind: only a noun can, a Define that leaves one thing, like something on the page`,
      )
    }
    return def.noun
  }

  // The kind a Define makes of what it leaves, if it's a noun: one thing, of
  // a built-in kind other than Any. The runtime decides the same, from values.
  nounOf(def: Def, outputs: Val[]): Type<unknown> | undefined {
    if (outputs.length !== 1 || !isType(outputs[0].ty)) return
    const have = root(outputs[0].ty).members
    const base = [...this.options.words.builtinKinds()].find(
      (k) => k !== AnyType && have.length > 0 && have.every((m) => k.members.includes(m)),
    )
    if (!base) return
    return { name: def.name, phrase: article(def.name), members: [def.name], base, test: (v): v is unknown => false }
  }

  // Each word's Defines, two at a time: a noun can't share its name, since
  // it's a kind, and two that could always both fit leave a use guessing.
  overloads(vocabulary: Scope) {
    for (const known of vocabulary.words.values()) {
      if (known.kind !== 'define') continue
      const defs = known.defs.filter((d) => !d.error)
      for (const [j, b] of defs.entries()) {
        const a = defs.slice(0, j).find((a) => a.noun || b.noun || clash(a, b))
        if (!a) continue
        const where = this.where(a.at)
        const message =
          a.noun || b.noun
            ? `${b.name} is a noun, so it can only have one Define, and there's another at ${where}`
            : clash(a, b) === 'same'
              ? `${b.name} takes the same things here as at ${where}, so there'd be no telling which one a step means`
              : `${b.name} here and at ${where} could both take the same things, and neither takes narrower kinds, so there'd be no telling which one a step means`
        b.error = { ...b.at, message, define: b.name }
        this.report.vocabulary.push(b.error)
      }
    }
  }

  where(d: Place): string {
    return `${path.relative(this.cwd, d.file)}:${d.line}:${d.column}`
  }

  take(sim: Sim, word: string): Val {
    const v = sim.stack.pop()
    if (v) return v
    if (sim.open) return sim.fromCaller()
    throw new Mistake(`${word} expected a value, but there was nothing left`)
  }

  formWay(name: string, form: Form): Way {
    return {
      inputs: form.inputs.map((t) => ({ members: membersOf(t), phrase: t.phrase, key: t })),
      outputs: (args) => (form.output ? [{ ty: form.output, shown: [name, ...args.map(show)].join(' ') }] : []),
    }
  }

  // A Define's way: what its header takes, and what its body leaves.
  // A word's Defines, most particular first, as the runtime orders them.
  defineWays(defs: Def[]): Way[] {
    return defs
      .map((def) => ({ def, way: this.defineWay(def) }))
      .sort((a, b) => b.way.inputs.length - a.way.inputs.length || specificity(b.def) - specificity(a.def))
      .map(({ way }) => way)
  }

  defineWay(def: Def): Way {
    this.checkDefine(def)
    if (def.error) {
      throw new Mistake(
        `${def.name} can't be used: its Define has a mistake, at ${this.where(def.error)}: ${def.error.message}`,
      )
    }
    const { outputs, noun } = def
    const inputs = def.params.map((p) => ({ members: membersOf(p.type), phrase: p.type.phrase, key: p }))
    if (noun) return { inputs, outputs: (args) => [{ ty: noun, shown: [def.name, ...args.map(show)].join(' ') }], def }
    // A vocabulary bug: checkDefine says what a Define leaves.
    if (!outputs) throw new Error(`Checked ${def.name}'s Define, but it leaves nothing known`)
    return { inputs, outputs: () => outputs, def }
  }

  // Runs a Define's body with what its header takes, by name, and nothing
  // below that.
  checkDefine(def: Def) {
    if (def.state === 'done') return
    if (def.state === 'checking') throw new Mistake(`${def.name} uses itself, so it would never finish`)
    def.state = 'checking'
    try {
      def.params = this.params(def)
      const scope = new Scope(def.block.scope)
      for (const p of def.params) scope.set({ name: p.name, kind: 'value', val: { ty: p.type, shown: p.name } })
      // Its header and body see what the header takes.
      const { origin } = def.block
      for (const line of [def.at.line, ...def.block.body.flatMap((s) => (s[0] ? [origin.at(s[0].pos).line] : []))]) {
        this.lineScopes.set(`${origin.file}:${line}`, scope)
      }
      const sim = new Sim(false)
      this.run(def.block.body, scope, sim, def.block.origin)
      def.outputs = sim.stack
      def.noun = this.nounOf(def, sim.stack)
    } catch (err) {
      def.error = this.diagnose(err, def.block.origin, def.name)
    } finally {
      def.state = 'done'
    }
  }

  // Calls the way the runtime would pick: the first whose inputs are on top
  // of the stack.
  call(name: string, ways: Way[], sim: Sim) {
    const fits = ways.flatMap((way) => {
      const fit = this.fit(way, sim)
      return fit ? [{ way, ...fit }] : []
    })
    if (!fits.length) throw this.mismatch(name, ways, sim)

    // On an open stack, a form with an optional last input, like a query's
    // Scope, would always fit by taking it from below, or by deciding a
    // variable must be one. Unless it's known to be there, prefer the form
    // without it.
    const shorter = fits.filter(
      (f) => !fits.some((g) => g !== f && g.unsure < f.unsure && isPrefix(g.way.inputs, f.way.inputs)),
    )
    let [chosen] = shorter
    const known = chosen.fresh === 0 && chosen.binds.size === 0
    if (shorter.length > 1 && !known) {
      if (this.guessing) {
        // For an editor's guess, any of them will do: each input may be any
        // of what they'd take there.
        const way = anyOf(shorter.map((f) => f.way))
        const fit = this.fit(way, sim)
        // A checker bug: each of them fits, so any of them together does.
        if (!fit) throw new Error(`${name}'s forms each fit, but not together`)
        chosen = { way, ...fit }
      } else {
        const alternatives = [...new Set(shorter.map((f) => f.way.inputs.map((w) => w.phrase).join(' and ')))]
        throw new Mistake(`Can't tell how ${name} is being used here: it could take ${alternatives.join(', or ')}`)
      }
    }

    for (const [v, want] of chosen.binds) {
      v.members = want.members
      v.phrase = want.phrase
    }
    const n = chosen.way.inputs.length
    const args = chosen.way.inputs.map((want, i) => sim.peek(i) ?? sim.fromCaller(want))
    sim.stack.length = Math.max(0, sim.stack.length - n)
    sim.stack.push(...chosen.way.outputs(args))
    return chosen.way
  }

  // Whether a way's inputs are on top of the stack, and what that would
  // narrow the stack's variables to. fresh counts inputs taken from a caller;
  // unsure counts those plus inputs that are variables.
  fit(way: Way, sim: Sim): { binds: Map<Var, Want>; fresh: number; unsure: number } | null {
    const binds = new Map<Var, Want>()
    let fresh = 0
    let unsure = 0
    for (let i = 0; i < way.inputs.length; i++) {
      const want = way.inputs[i]
      const v = sim.peek(i)
      if (!v) {
        if (!sim.open) return null
        fresh++
        unsure++
        continue
      }
      if (v.ty instanceof Var) unsure++
      const wanted = want.members
      if (wanted === null) continue
      if (v.ty instanceof Var) {
        const now = binds.get(v.ty)?.members ?? v.ty.members
        const narrowed = now === null ? wanted : now.filter((m) => wanted.includes(m))
        if (!narrowed.length) return null
        binds.set(v.ty, { ...want, members: narrowed })
      } else if (!accepts(want, v)) return null
    }
    return { binds, fresh, unsure }
  }

  // Says what was wanted at the first place every way had given up, as the
  // runtime does.
  mismatch(name: string, ways: Way[], sim: Sim): Mistake {
    let live = ways
    for (let i = 0; ; i++) {
      const here = live.filter((w) => w.inputs.length > i)
      const v = sim.peek(i)
      const ok = v ? here.filter((w) => accepts(w.inputs[i], v)) : []
      if (!ok.length || !here.length) {
        const wanted = [...new Set(here.map((w) => w.inputs[i].phrase))].join(', or ') || 'something else'
        return new Mistake(`${name} expected ${wanted}, but ${v ? `got ${show(v)}` : 'there was nothing left'}`)
      }
      live = ok
    }
  }
}

function accepts(want: Want, v: Val): boolean {
  const have = membersOf(v.ty)
  const wanted = want.members
  if (wanted === null || have === null) return true
  if (v.ty instanceof Var) return have.some((m) => wanted.includes(m))
  if (have.every((m) => wanted.includes(m))) return true
  // A Cart is an Element too.
  return isType(v.ty) && !!v.ty.base && accepts(want, { ...v, ty: v.ty.base })
}

const isType = (ty: Ty): ty is Type<unknown> => !(ty instanceof Var) && !(ty instanceof BlockOf)

// Whether two Defines of a word could always both fit: 'same' if they take
// the same kinds, 'ambiguous' if each is narrower somewhere. They can't both
// fit if they take different numbers of things, or if at some place neither
// kind is within the other; and if one is narrower throughout, it's chosen.
function clash(a: Def, b: Def): 'same' | 'ambiguous' | null {
  if (a.params.length !== b.params.length) return null
  let aNarrower = false
  let bNarrower = false
  for (const [i, p] of a.params.entries()) {
    const x = p.type
    const y = b.params[i].type
    const xInY = within(x, y)
    const yInX = within(y, x)
    if (xInY && yInX) continue
    if (!xInY && !yInX) return null
    if (xInY) aNarrower = true
    else bNarrower = true
  }
  return !aNarrower && !bNarrower ? 'same' : aNarrower && bNarrower ? 'ambiguous' : null
}

// Whether every value of kind x is one of kind y: a Cart is an Element, and
// everything is Any.
function within(x: Type<unknown>, y: Type<unknown>): boolean {
  if (y.name === AnyType.name || x.name.toLowerCase() === y.name.toLowerCase()) return true
  return !!x.base && within(x.base, y)
}

// What a noun's kind is underneath: Element, for a Cart.
const root = (t: Type<unknown>): Type<unknown> => (t.base ? root(t.base) : t)

function anyOf(ways: Way[]): Way {
  const length = Math.max(...ways.map((w) => w.inputs.length))
  const inputs = Array.from({ length }, (_, i): Want => {
    const here = ways.flatMap((w) => (w.inputs[i] ? [w.inputs[i]] : []))
    // Any value, if any of them takes any value.
    const known = here.flatMap((w) => (w.members === null ? [] : [w.members]))
    const members = known.length < here.length ? null : [...new Set(known.flat())]
    return { members, phrase: [...new Set(here.map((w) => w.phrase))].join(', or '), key: undefined }
  })
  return { inputs, outputs: ways[0].outputs }
}

function isPrefix(short: Want[], long: Want[]): boolean {
  return short.length < long.length && short.every((w, i) => w.key === long[i].key)
}

// ---------------------------------------------------------------- output

// A diagnostic as a person reads it: where, the line, and what's wrong.
export function format(d: Diagnostic, source: string, cwd = process.cwd()): string {
  const text = source.split('\n')[d.line - 1] ?? ''
  const indent = text.length - text.trimStart().length
  const caret = `${' '.repeat(Math.max(0, d.column - 1 - indent))}^`
  const where = d.define ? ` (in Define ${d.define})` : ''
  return [
    `${path.relative(cwd, d.file)}:${d.line}:${d.column}${where}`,
    `    ${text.trim()}`,
    `    ${caret}`,
    `  ${d.message}`,
  ].join('\n')
}
