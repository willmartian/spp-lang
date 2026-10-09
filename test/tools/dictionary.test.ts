import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { analyze, browser, core, dictionary, discover, leftovers, load } from '../../src/index.ts'

// The dictionary for some .spp files, given as name → contents.
function dictionaryOf(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-dictionary-'))
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), src)
  const words = browser(core())
  return dictionary(words, analyze(discover([dir]).map(load), { words, settle: leftovers, cwd: dir }), dir)
}

test('built-in words with the same forms are listed together', () => {
  const lines = dictionaryOf({}).split('\n')
  const click = lines.indexOf('Click, Double-click, Hover, Focus, Check, Uncheck, Clear')
  assert.notEqual(click, -1)
  assert.equal(lines[click + 1], '  Element ->    takes something on the page')
})

test('a word with several forms lists each, with what it takes', () => {
  const lines = dictionaryOf({}).split('\n')
  const press = lines.indexOf('Press')
  assert.deepEqual(lines.slice(press, press + 3), [
    'Press',
    '  Text, Element ->    takes a "Key" to press, then something on the page',
    '  Text ->             takes a "Key" to press',
  ])
})

test("a project's Defines are listed with their forms and where they are", () => {
  const out = dictionaryOf({ 'words.spp': 'Define: Add Text (Item)\n  Fill the Field "Item" with Item' })
  assert.match(out, /Defined in this project\n\nAdd\n {2}Text \(Item\) -> {4}words\.spp:1$/)
})

test("a Define's header is listed with the names it gives", () => {
  const out = dictionaryOf({ 'words.spp': 'Define: Move Text (Item) to Element\n  Fill Element with Item' })
  assert.match(out, /\nMove\n {2}Text \(Item\), Element -> {4}words\.spp:1$/)
})

test('a noun is listed as leaving its kind', () => {
  const out = dictionaryOf({ 'words.spp': 'Define: Cart\n  the Region "Cart"' })
  assert.match(out, /\nCart\n {2}-> Cart {4}words\.spp:1$/)
})

test('a word with several Defines lists each, with where it is', () => {
  const out = dictionaryOf({ 'words.spp': 'Define: Go\n  Visit "/"\nDefine: Go Text (Where)\n  Visit Where' })
  assert.match(out, /\nGo\n {2}-> {4}words\.spp:1\n {2}Text \(Where\) -> {4}words\.spp:3$/)
})

test('with no Defines, the dictionary says so', () => {
  assert.match(dictionaryOf({}), /Defined in this project\n\nNone yet\.$/)
})

test('step keywords are listed as the words they are', () => {
  const lines = dictionaryOf({}).split('\n')
  const and = lines.indexOf('And, But')
  assert.deepEqual(lines.slice(and, and + 2), [
    'And, But',
    '  Step, Mode -> Mode    takes a step, then a Given, When or Then above it',
  ])
})
