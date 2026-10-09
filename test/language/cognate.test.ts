import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context, Token } from '../../src/index.ts'
import {
  AnyType,
  core,
  Env,
  formsFor,
  lex,
  parse,
  run,
  SppError,
  Stack,
  signature,
  TextType,
  type,
} from '../../src/index.ts'

const form = formsFor<Context>()
const PairType = type('Pair', 'a pair', (v): v is unknown[] => Array.isArray(v))

// Records what each word saw, so tests can watch the order things run in.
async function evaluate(src: string) {
  const seen: unknown[] = []
  const env = new Env(core())
    .word(
      'Say',
      form([AnyType], (_, v) => seen.push(v)),
    )
    .word(
      'Pair',
      form([AnyType, AnyType], PairType, (_, a, b) => [a, b]),
    )
    .word(
      'Wants-text',
      form([TextType], () => {}),
    )
  const stack = new Stack()
  await run(parse(src), env, stack, { print: () => {} })
  return { stack: [...stack], seen }
}

const text = (t: Token) => ('name' in t ? t.name : 'value' in t ? t.value : t.type)

// A SppError at pos, whose message matches.
const at =
  (pos: number, message = /./) =>
  (err: unknown) =>
    err instanceof SppError && err.pos === pos && message.test(err.message)

test('lowercase words are prose', () => {
  assert.deepEqual(lex('I Click the Button "Sign in"').map(text), ['I', 'Click', 'Button', 'Sign in'])
})

test('prose punctuation is skipped, but not inside strings', () => {
  assert.deepEqual(lex('Then, I See "Hi, you." then: done.').map(text), ['Then', 'I', 'See', 'Hi, you.'])
})

test('a line starting with # is a comment', async () => {
  assert.deepEqual((await evaluate('# Say "no"\n  # indented too\nSay "yes"')).seen, ['yes'])
})

test('# anywhere else is not a comment', () => {
  assert.throws(() => parse('Say "a" # no'), /Unexpected character "#"/)
})

test('statements run right to left', async () => {
  assert.deepEqual((await evaluate('Pair "a" "b"')).stack, [['a', 'b']])
})

test('each line is a statement, and lines run in order', async () => {
  assert.deepEqual((await evaluate('Say "one"\nSay "two"')).seen, ['one', 'two'])
})

test('semicolons point at one statement per line', () => {
  assert.throws(() => parse('Say "a"; Say "b"'), at(7, /One statement per line/))
})

test('Define: takes the indented lines under it as its body', async () => {
  const src = `
Define: Greet Text (Name)
  Say "hello"
  Say Name

Greet "you"
`
  assert.deepEqual((await evaluate(src)).seen, ['hello', 'you'])
})

test('blocks nest, and end where the indentation does', async () => {
  const src = `
Define: Outer
  Define: Inner
    Say "inner"
  Inner
  Say "outer"
Outer
Say "after"
`
  assert.deepEqual((await evaluate(src)).seen, ['inner', 'outer', 'after'])
})

test('the old Define, with its colon at the end, says how to write it now', () => {
  assert.throws(() => parse('Define Greet:\n  Say "hi"'), at(0, /Write Define: Greet, with the colon after Define/))
  assert.throws(() => parse('Define Signed-in as:\n  Say "hi"'), /Write Define: Signed-in,/)
})

test('Define: needs a name', () => {
  assert.throws(() => parse('Define:\n  Say "hi"'), /Define: needs a Capitalised name/)
  // prose and a trailing colon are fine
  assert.doesNotThrow(() => parse('Define: Greet everyone:\n  Say "hi"'))
})

test("a Define's header lists the kinds it takes, each maybe named", () => {
  const [[define]] = parse('Define: Move Text (the Item) from Element (Source) to Element\n  Say Item')
  assert.deepEqual(define.type === 'define' && define.params.map((p) => `${p.kind} ${p.name} ${p.pos}`), [
    'Text Item 13',
    'Element Source 34',
    'Element Element 54',
  ])
})

test("a Define's header takes only kinds and names", () => {
  assert.throws(() => parse('Define: Greet "you"\n  Say "hi"'), at(14, /come the kinds it takes/))
  assert.throws(() => parse('Define: Greet Text ()\n  Say "hi"'), at(19, /\( \) after Text holds one Capitalised name/))
  assert.throws(() => parse('Define: Greet Text (Who\n  Say "hi"'), /\( \) after Text holds one/)
})

test('a Define takes what its header says, by name', async () => {
  const greet = 'Define: Greet Text (Who) and Number\n  Say Who\n  Say Number\n'
  assert.deepEqual((await evaluate(`${greet}Greet "you" and 2`)).seen, ['you', 2])
  await assert.rejects(evaluate(`${greet}Greet 2 "you"`), /Greet expected some text, but got 2/)
  await assert.rejects(evaluate(`${greet}Greet "you"`), /Greet expected a number, but there was nothing left/)
})

test("a Define can't reach into its caller's stack, but leaves things on it", async () => {
  await assert.rejects(evaluate('Define: Grab\n  Say\nGrab "x"'), /Say expected a value, but there was nothing left/)
  assert.deepEqual((await evaluate('Define: Two\n  2\nSay Two')).seen, [2])
})

test('a Define can only take kinds there are, which it looks up when first used', async () => {
  const greet = 'Define: Greet Person\n  Say "hi"\n'
  assert.deepEqual((await evaluate(greet)).seen, [])
  await assert.rejects(
    evaluate(`${greet}Greet`),
    /Person isn't a kind a Define can take. The kinds are Text, Number, Table, Any, and nouns/,
  )
})

const nouns =
  'Define: Cart\n  "the cart"\nDefine: Coupon\n  "SAVE10"\nDefine: Use Text (Code) on Cart\n  Say Code\n  Say Cart\n'

test("a noun's kind is its name, and a Define that takes it takes nothing else", async () => {
  assert.deepEqual((await evaluate(`${nouns}Use "x" on the Cart`)).seen, ['x', 'the cart'])
  await assert.rejects(evaluate(`${nouns}Use "x" on the Coupon`), /Use expected a Cart, but got "SAVE10"/)
  await assert.rejects(evaluate(`${nouns}Use "x" on "the cart"`), /Use expected a Cart, but got "the cart"/)
})

test("a noun's value is still what it was, to any other word", async () => {
  assert.deepEqual((await evaluate(`${nouns}Wants-text Coupon\nSay Coupon`)).seen, ['SAVE10'])
})

test('a word can have several Defines, and a use runs the one whose kinds it has', async () => {
  const more = `${nouns}Define: Use Number (N) on Cart\n  Say N\nDefine: Use Text (Code)\n  Say "just"\n  Say Code\n`
  assert.deepEqual((await evaluate(`${more}Use 2 on the Cart`)).seen, [2])
  assert.deepEqual((await evaluate(`${more}Use "x" on the Cart`)).seen, ['x', 'the cart'])
  assert.deepEqual((await evaluate(`${more}Use "x"`)).seen, ['just', 'x'])
  await assert.rejects(evaluate(`${more}Use 5`), /Use expected a Cart, but there was nothing left/)
})

test('of several Defines that fit, the narrower runs, wherever it was written', async () => {
  const show = `${nouns}Define: Show Any\n  Say "any"\nDefine: Show Cart\n  Say "cart"\n`
  assert.deepEqual((await evaluate(`${show}Show the Cart\nShow "x"`)).seen, ['cart', 'any'])
})

test('a Define can take a noun Defined after it', async () => {
  assert.deepEqual((await evaluate('Define: Use Cart\n  Say Cart\nDefine: Cart\n  "c"\nUse Cart')).seen, ['c'])
})

test('Define: needs a body', () => {
  assert.throws(() => parse('Define: Greet\nSay "hi"'), at(0, /Define: Greet needs an indented body/))
})

test('Define: starts a line of its own', () => {
  assert.throws(() => parse('I Define: Greet\n  Say "hi"'), at(2, /Define: starts a line of its own/))
})

test('a colon with nothing indented under it is just prose', async () => {
  assert.deepEqual((await evaluate('Say "table" for the form:')).seen, ['table'])
})

test('I is a word that does nothing', async () => {
  assert.deepEqual((await evaluate('I Say "hi"')).seen, ['hi'])
})

test('parentheses are only for naming what a Define takes', () => {
  assert.throws(() => parse('Say (Say "a")'), at(4, /only name what a Define takes/))
})

test('indentation has to mean something', () => {
  assert.throws(() => parse('Say "a"\n  Say "b"'), /Unexpected indentation/)
})

test('unknown words suggest a near miss', async () => {
  await assert.rejects(evaluate('Sya "x"'), (err) => {
    assert.ok(err instanceof SppError)
    assert.match(err.message, /Unknown word Sya\. Did you mean Say\?/)
    assert.equal(err.pos, 0)
    return true
  })
})

test('unknown words explain the capitals rule', async () => {
  await assert.rejects(evaluate('OK'), /if it's prose, write it in lowercase/)
})

test('errors inside a Define are reported at the calling word', async () => {
  const src = 'Define: Broken\n  Wants-text 1\nBroken'
  await assert.rejects(evaluate(src), at(src.lastIndexOf('Broken')))
})

test('words say what they wanted', async () => {
  await assert.rejects(evaluate('Wants-text 1'), /Wants-text expected some text, but got 1/)
})

test('syntax errors carry a position', () => {
  assert.throws(() => parse('Click "Add'), at(6, /Unclosed string/))
})

// ---------------------------------------------------------------- forms

const NumType = type('Number', 'a number', (v): v is number => typeof v === 'number')

async function call(env: Env, src: string) {
  const stack = new Stack()
  await run(parse(src), env, stack, {})
  return [...stack]
}

test('the first form whose inputs are on the stack is the one called', async () => {
  const env = new Env(core()).word(
    'Show',
    form([TextType, NumType], TextType, (_, t, n) => `${t} ${n}`),
    form([NumType, TextType], TextType, (_, n, t) => `${t} ${n}`),
    form([TextType], TextType, (_, t) => t),
  )
  assert.deepEqual(await call(env, 'Show "a" 1'), ['a 1'])
  assert.deepEqual(await call(env, 'Show 1 "a"'), ['a 1'])
  assert.deepEqual(await call(env, 'Show "a"'), ['a'])
})

test('no matching form says what each form wanted, where they gave up', async () => {
  const env = new Env(core()).word(
    'Show',
    form([TextType, NumType], () => {}),
    form([NumType], () => {}),
  )
  await assert.rejects(call(env, 'Show \\x'), /Show expected some text, or a number, but got \\x/)
  await assert.rejects(call(env, 'Show "a" "b"'), /Show expected a number, but got "b"/)
  await assert.rejects(call(env, 'Show'), /Show expected some text, or a number, but there was nothing left/)
})

test('a form that leaves the wrong type is a bug in the vocabulary', async () => {
  const env = new Env(core()).word(
    'Lie',
    form([], NumType, () => 'text' as unknown as number),
  )
  await assert.rejects(call(env, 'Lie'), /Lie : -> Number left "text"/)
})

test('signatures read as stack effects', () => {
  assert.equal(
    signature(
      'Pair',
      form([AnyType, AnyType], PairType, () => []),
    ),
    'Pair : Any, Any -> Pair',
  )
  assert.equal(
    signature(
      'Wants-text',
      form([TextType], () => {}),
    ),
    'Wants-text : Text ->',
  )
  assert.equal(
    signature(
      'I',
      form([], () => {}),
    ),
    'I : ->',
  )
})
