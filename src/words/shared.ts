// The words every backend shares, made from what its driver can do.
//
// Queries are Testing Library's, spelled as Cognate words: a role name
// (Button, Heading, Checkbox…) takes the accessible name to its right and
// leaves an Element. Spec++ asks for exact names, as Testing Library does,
// unless you say Containing.
//
// Assertions are deferred. "Then I should Not See the Button "Save"" runs See
// before Not, so See can't just fail on the spot; it leaves an Expectation on
// the stack for Not to flip, and every Expectation left when the step ends is
// checked then. Likewise "the Checkbox "Terms" should be Checked": Checked
// runs first and leaves a Matcher, the Checkbox query lands on top of it, and
// the step's end pairs them up.
//
// A backend builds its vocabulary from queries(), actions() and checks(),
// with its own words in between, like the Playwright backend's Visit.

import type { Stack } from '../language/cognate.ts'
import { describe, type Env, SppError, unwrap } from '../language/cognate.ts'
import type { Context, Form } from '../language/types.ts'
import { called, formsFor, oneOf, TableType, TextType, type } from '../language/types.ts'
import type { Action, Driver, Name, Query, QueryKind, State } from './driver.ts'

// Any driver: its members are methods, so one that needs more, like a page, fits.
type AnyDriver = Driver<Context, unknown>

// ---------------------------------------------------------------- values

export class Pattern {
  text: string
  regex: RegExp

  constructor(text: string) {
    this.text = text
    this.regex = new RegExp(escapeRegExp(text), 'i')
  }
  describe() {
    return `Containing ${JSON.stringify(this.text)}`
  }
}

export class Scope {
  found: Found

  constructor(found: Found) {
    this.found = found
  }
  describe() {
    return `Within ${this.found.describe()}`
  }
}

// A driver's handle that remembers the words that made it, for error messages.
export class Found<H = unknown> {
  handle: H
  label: string

  constructor(handle: H, label: string) {
    this.handle = handle
    this.label = label
  }
  describe() {
    return this.label
  }
}

export class Matcher {
  label: string
  state: State
  negated: boolean

  constructor(label: string, state: State, negated = false) {
    this.label = label
    this.state = state
    this.negated = negated
  }
  negate() {
    return new Matcher(this.label, this.state, !this.negated)
  }
  against<C extends Context, H>(target: Found, ctx: C, driver: Driver<C, H>) {
    return new Expectation(`${target.label} ${this.describe()}`, (not) =>
      driver.expect(ctx, target.handle as H, this.state, this.negated !== not),
    )
  }
  describe() {
    return (this.negated ? 'Not ' : '') + this.label
  }
}

// check(not) runs the assertion, inverted when not is true.
export class Expectation {
  label: string
  check: (not: boolean) => Promise<void>

  constructor(label: string, check: (not: boolean) => Promise<void>) {
    this.label = label
    this.check = check
  }
  negate() {
    return new Expectation(`Not ${this.label}`, (not) => this.check(!not))
  }
  describe() {
    return this.label
  }
}

// ---------------------------------------------------------------- types

export const ElementType = type('Element', 'something on the page', (v): v is Found => v instanceof Found)
export const PatternType = type('Pattern', 'Containing "some text"', (v): v is Pattern => v instanceof Pattern)
export const NameType = oneOf<string | Pattern>('some text', TextType, PatternType)
export const ScopeType = type('Scope', 'Within something', (v): v is Scope => v instanceof Scope)
export const MatcherType = type('Matcher', 'a check', (v): v is Matcher => v instanceof Matcher)
export const CheckType = type('Check', 'a check', (v): v is Expectation => v instanceof Expectation)

const QueryName = called(NameType, 'a "name" to look for')

// The shared words run with whatever context their driver wants.
const form = formsFor<Context>()

// ---------------------------------------------------------------- helpers

export const nameOf = (v: string | Pattern): Name => (v instanceof Pattern ? v.regex : v)
export const say = (v: string | Pattern) => (v instanceof Pattern ? v.describe() : JSON.stringify(v))

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// Verbs that take a thing and some text accept them in either order, so
// "Fill the Field "Email" with "a@b"" and "Fill "a@b" into the Field "Email""
// both work.
function eitherOrder(act: (ctx: Context, found: Found, text: string) => Promise<unknown>): Form[] {
  return [
    form([ElementType, TextType], (ctx, found, text) => act(ctx, found, text)),
    form([TextType, ElementType], (ctx, text, found) => act(ctx, found, text)),
  ]
}

// ---------------------------------------------------------------- queries

// The word for each kind of query that isn't by role.
const QUERY_WORDS: [QueryKind, ...string[]][] = [
  ['label', 'Field', 'Label'],
  ['text', 'Text'],
  ['placeholder', 'Placeholder'],
  ['alt', 'Alt'],
  ['title', 'Title'],
  ['testId', 'TestId'],
]

// Finding things: a word for each role and query the driver has, then
// Containing and Within.
export function queries(env: Env, driver: AnyDriver): Env {
  env.kind(ElementType)

  // A query finds by name, within a Scope if one comes after it.
  const query = (word: string, by: (name: Name) => Query): Form[] => {
    const found = (ctx: Context, root: Found | null, name: string | Pattern, within = '') =>
      new Found(driver.find(ctx, root?.handle ?? null, by(nameOf(name))), `the ${word} ${say(name)}${within}`)
    return [
      form([QueryName, ScopeType], ElementType, (ctx, name, scope) =>
        found(ctx, scope.found, name, ` within ${scope.found.label}`),
      ),
      form([QueryName], ElementType, (ctx, name) => found(ctx, null, name)),
    ]
  }

  for (const role of driver.roles) env.word(cap(role), ...query(cap(role), (name) => ({ by: 'role', role, name })))
  for (const [kind, ...words] of QUERY_WORDS) {
    if (!driver.queries.includes(kind)) continue
    // Synonyms share their forms, and so describe what they found the same way.
    const forms = query(words[0], (name) => ({ by: kind, name }))
    for (const word of words) env.word(word, ...forms)
  }
  env.word(
    'Containing',
    form([TextType], PatternType, (_, text) => new Pattern(text)),
  )

  const within = form(
    [called(ElementType, 'something on the page to look inside')],
    ScopeType,
    (_, found) => new Scope(found),
  )
  return env.word('Within', within).word('In', within)
}

// ---------------------------------------------------------------- actions

// The actions that take only the thing they act on.
type BareAction = Exclude<Action, { text: string } | { key: string }>['do']

const ACTION_WORDS: [BareAction, string][] = [
  ['click', 'Click'],
  ['double-click', 'Double-click'],
  ['hover', 'Hover'],
  ['focus', 'Focus'],
  ['check', 'Check'],
  ['uncheck', 'Uncheck'],
  ['clear', 'Clear'],
]

// Doing things, as far as the driver can.
export function actions(env: Env, driver: AnyDriver): Env {
  const can = (a: Action['do']) => driver.actions.includes(a)
  const act = (ctx: Context, found: Found, action: Action) => driver.act(ctx, found.handle, action)

  for (const [action, word] of ACTION_WORDS) {
    if (can(action))
      env.word(
        word,
        form([ElementType], (ctx, found) => act(ctx, found, { do: action })),
      )
  }
  if (can('fill')) {
    const fill = eitherOrder((ctx, found, text) => act(ctx, found, { do: 'fill', text }))
    // a table of label | value rows
    if (driver.queries.includes('label'))
      fill.push(
        form([TableType], async (ctx, rows) => {
          for (const [label, value] of rows)
            await driver.act(ctx, driver.find(ctx, null, { by: 'label', name: label }), { do: 'fill', text: value })
        }),
      )
    env.word('Fill', ...fill)
  }
  if (can('type')) env.word('Type', ...eitherOrder((ctx, found, text) => act(ctx, found, { do: 'type', text })))
  if (can('select')) env.word('Select', ...eitherOrder((ctx, found, text) => act(ctx, found, { do: 'select', text })))
  if (can('press')) {
    const Key = called(TextType, 'a "Key" to press')
    env.word(
      'Press',
      form([Key, ElementType], (ctx, key, found) => act(ctx, found, { do: 'press', key })),
      form([Key], (ctx, key) => driver.press(ctx, key)),
    )
  }
  return env
}

// ---------------------------------------------------------------- checks

type TextState = Extract<State, { text: Name }>['is']
type BareState = Exclude<State['is'], TextState>

const STATE_WORDS: [BareState, string][] = [
  ['visible', 'Visible'],
  ['hidden', 'Hidden'],
  ['checked', 'Checked'],
  ['enabled', 'Enabled'],
  ['disabled', 'Disabled'],
  ['focused', 'Focused'],
  ['empty', 'Empty'],
]

// The states that take some text, like Value "eggs".
const TEXT_STATE_WORDS: [TextState, string][] = [
  ['value', 'Value'],
  ['text', 'Read'],
  ['containing', 'Contain'],
]

// Checking things: See, a word for each state the driver can check, and Not.
export function checks(env: Env, driver: AnyDriver): Env {
  const can = (s: State['is']) => driver.states.includes(s)

  if (can('visible')) {
    const visible = new Matcher('Visible', { is: 'visible' })
    const see = [form([ElementType], CheckType, (ctx, found) => visible.against(found, ctx, driver))]
    if (driver.queries.includes('text'))
      see.push(
        form([NameType], CheckType, (ctx, text) => {
          const handle = driver.find(ctx, null, { by: 'text', name: nameOf(text), loose: true })
          return visible.against(new Found(handle, `the text ${say(text)}`), ctx, driver)
        }),
      )
    env.word('See', ...see)
  }
  for (const [is, word] of STATE_WORDS) {
    if (can(is))
      env.word(
        word,
        form([], MatcherType, () => new Matcher(word, { is })),
      )
  }
  for (const [is, word] of TEXT_STATE_WORDS) {
    if (can(is))
      env.word(
        word,
        form([NameType], MatcherType, (_, v) => new Matcher(`${word} ${say(v)}`, { is, text: nameOf(v) })),
      )
  }
  return env.word(
    'Not',
    form([MatcherType], MatcherType, (_, m) => m.negate()),
    form([CheckType], CheckType, (_, c) => c.negate()),
  )
}

// ---------------------------------------------------------------- the end of a step

// What's wrong with a step that leaves these behind, said the same way by
// leftovers and settle.
const unchecked = (matcher: string) => `Nothing to check is ${matcher}. Put what should be ${matcher} before it.`
const unused = (values: string[]) => `Nothing used ${values.join(', ')}. Is the step missing a verb?`

// settle's rule, for the checker: what settle would say about a step that
// leaves values of these types, or null if it would be happy.
export function leftovers(stack: readonly { name: string; shown: string }[]): string | null {
  const rest = [...stack]
  for (let v = rest.pop(); v; v = rest.pop()) {
    if (v.name === CheckType.name) continue
    if (v.name === ElementType.name && rest.at(-1)?.name === MatcherType.name) {
      rest.pop()
      continue
    }
    if (v.name === MatcherType.name) return unchecked(v.shown)
    return unused([v, ...rest.reverse()].map((x) => x.shown))
  }
  return null
}

// A settle for a driver: it checks whatever assertions a step left behind.
// Anything else left over is a sentence with no verb, which is almost always
// a mistake worth saying so.
export function settler<C extends Context, H>(driver: Driver<C, H>) {
  return async function settle(stack: Stack, ctx: C): Promise<void> {
    const pending: Expectation[] = []
    while (stack.length) {
      // A noun's value is checked as what it is underneath.
      const v = unwrap(stack.pop())
      const under = unwrap(stack.at(-1))
      if (v instanceof Expectation) pending.push(v)
      else if (v instanceof Found && under instanceof Matcher) {
        stack.pop()
        pending.push(under.against(v, ctx, driver))
      } else if (v instanceof Matcher) {
        throw new SppError(unchecked(v.describe()))
      } else {
        throw new SppError(unused([v, ...stack.reverse()].map(describe)))
      }
    }
    // Checked in reading order: the stack holds them right to left.
    for (const e of pending.reverse()) await e.check(false)
  }
}
