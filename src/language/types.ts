// Types, and the forms words declare with them.
//
// Every word says what it takes off the stack and what it leaves, as one or
// more forms:
//
//     Button : Text | Pattern, Scope -> Element
//     Button : Text | Pattern -> Element
//
// The runtime calls the first form that fits what's on the stack, and a
// checker can do the same with types instead of values. Inputs are in reading
// order: the first is the value written right after the word, which, since
// statements run right to left, is on top of the stack.

// A type is a name for signatures, a phrase for error messages, a test for
// the runtime, and, for the checker, the base types it covers: Text covers
// Text, "Text | Pattern" covers both.
//
// A noun's kind, like Cart, also has a base: the kind it narrows, like
// Element. Anything that takes an Element takes a Cart, but not the reverse.
export interface Type<T = unknown> {
  readonly name: string
  readonly phrase: string
  readonly members: readonly string[]
  readonly base?: Type
  test(v: unknown): v is T
}

// "a Cart", "an Email".
export const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name

export function type<T>(name: string, phrase: string, test: (v: unknown) => v is T): Type<T> {
  return { name, phrase, members: [name], test }
}

// Any of several types, e.g. the Text or Pattern a query takes.
export function oneOf<T>(phrase: string, ...types: Type<T>[]): Type<T> {
  return {
    name: types.map((t) => t.name).join(' | '),
    phrase,
    members: types.flatMap((t) => t.members),
    test: (v): v is T => types.some((t) => t.test(v)),
  }
}

// The same type, described more precisely where a word wants something
// particular: Visit wants text, but what it wants is 'a "/path" or URL'.
export function called<T>(t: Type<T>, phrase: string): Type<T> {
  return { ...t, phrase }
}

export const AnyType: Type<unknown> = { name: 'Any', phrase: 'a value', members: [], test: (v): v is unknown => true }
export const TextType = type('Text', 'some text', (v): v is string => typeof v === 'string')
export const NumberType = type('Number', 'a number', (v): v is number => typeof v === 'number')
// A step's DataTable, as rows of cells.
export const TableType = type(
  'Table',
  'a table',
  (v): v is string[][] => Array.isArray(v) && v.every((row) => Array.isArray(row)),
)

// What run() is given, passed on to every word. Vocabularies extend it with
// what their words need, like a page to drive.
export interface Context {
  print?: (line: string) => void
}

type Values<I extends readonly Type<unknown>[]> = { [K in keyof I]: I[K] extends Type<infer T> ? T : never }

// One way of calling a word: the types it takes, and the type it leaves, if any.
export interface Form<C extends Context = Context> {
  inputs: readonly Type<unknown>[]
  output: Type<unknown> | null
  // A method, so a form whose words need more, like a page, still counts as a
  // Form: whoever runs a vocabulary gives it the context its words need.
  impl(ctx: C, ...args: unknown[]): unknown
}

// Forms for a vocabulary whose words need a context of type C. The impl's
// arguments are typed from the inputs, so the two can't drift apart.
export function formsFor<C extends Context>() {
  function form<const I extends readonly Type<unknown>[]>(
    inputs: I,
    impl: (ctx: C, ...args: Values<I>) => unknown,
  ): Form<C>
  function form<const I extends readonly Type<unknown>[], O>(
    inputs: I,
    output: Type<O>,
    impl: (ctx: C, ...args: Values<I>) => O | Promise<O>,
  ): Form<C>
  function form(inputs: readonly Type<unknown>[], a: unknown, b?: unknown): Form<C> {
    return b
      ? { inputs, output: a as Type<unknown>, impl: b as Form<C>['impl'] }
      : { inputs, output: null, impl: a as Form<C>['impl'] }
  }
  return form
}

// "Click : Element ->", as a checker or an editor would show it.
export function signature(name: string, form: Form): string {
  const inputs = form.inputs.map((t) => t.name).join(', ')
  return `${name} : ${inputs}${inputs ? ' ' : ''}->${form.output ? ` ${form.output.name}` : ''}`
}
