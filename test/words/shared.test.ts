import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Context, Driver } from '../../src/index.ts'
import { actions, check, checks, core, discover, Env, leftovers, load, queries } from '../../src/index.ts'

// A driver that can tap buttons and see them, and nothing else, as a phone
// might. Nothing here runs, so it never needs to do any of it.
const unused = () => {
  throw new Error('not run')
}
const small: Driver<Context, unknown> = {
  roles: ['button'],
  queries: [],
  actions: ['click'],
  states: ['visible'],
  find: unused,
  act: unused,
  press: unused,
  expect: unused,
}

const vocabularyOf = (driver: Driver<Context, unknown>) =>
  checks(actions(queries(new Env(core()), driver), driver), driver)

test("a driver's words are only the ones it can do", () => {
  const words = new Set(vocabularyOf(small).names())
  for (const word of ['Button', 'Click', 'See', 'Visible', 'Not', 'Within', 'Containing'])
    assert.ok(words.has(word), word)
  for (const word of ['Heading', 'Field', 'Text', 'Hover', 'Fill', 'Press', 'Checked', 'Value'])
    assert.ok(!words.has(word), word)
})

test('See takes some text only when the driver can find things by text', () => {
  assert.equal((vocabularyOf(small).lookup('See') as unknown[]).length, 1)
})

test("the checker catches a word the driver can't do, before anything runs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-words-'))
  fs.writeFileSync(path.join(dir, 'a.spp'), 'Feature: F\n  Scenario: S\n    When I Hover the Button "Add"')
  const report = check(discover([dir]).map(load), { words: vocabularyOf(small), settle: leftovers, cwd: dir })
  const [problem] = report.scenarios.values()
  assert.match(problem.message, /^Unknown word Hover\./)
})
