import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { load, selects, split } from '../../src/index.ts'

const lines = (s: string | null) => (s ?? '').split('\n')

test('a file with no Feature is all vocabulary', () => {
  const src = 'Define: Add\n  Click the Button "Add"'
  assert.deepEqual(split(src), { preamble: src, gherkin: null })
})

test('Defines above the Feature line are vocabulary, the rest is Gherkin', () => {
  const src = [
    '# shared', //          0: comment, kept in both
    'Define: Add', //       1
    '  Click the Button', // 2
    '', //                  3
    '@smoke', //            4: tags belong to the Feature
    'Feature: Lists', //    5
    '  Scenario: One', //   6
  ].join('\n')
  const { preamble, gherkin } = split(src)
  assert.deepEqual(lines(preamble), ['# shared', 'Define: Add', '  Click the Button', '', '', '', ''])
  assert.deepEqual(lines(gherkin), ['# shared', '', '', '', '@smoke', 'Feature: Lists', '  Scenario: One'])
})

test('Feature keywords from other Gherkin languages count', () => {
  assert.equal(split('# language: fr\nFonctionnalité: Listes').preamble.trim(), '')
})

// ---------------------------------------------------------------- choosing scenarios

test('a scenario is picked out by any of its lines, a file or a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-select-'))
  const file = path.join(dir, 'a.spp')
  fs.writeFileSync(
    file,
    [
      'Feature: F', //               1
      '  Background:', //            2
      '    Given I Visit "/"', //    3
      '  Scenario: One', //          4
      '    When I Reload', //        5
      '  Scenario Outline: Rows', // 6
      '    When I Visit "<p>"', //   7
      '    Examples:', //            8
      '      | p  |', //             9
      '      | /a |', //             10
      '      | /b |', //             11
    ].join('\n'),
  )
  const scenarios = load(file).features[0].scenarios
  const picked = (...selections: string[]) => scenarios.filter((s) => selects(selections, s, dir)).map((s) => s.line)

  assert.deepEqual(picked(), [4, 10, 11])
  assert.deepEqual(picked('a.spp:4'), [4])
  assert.deepEqual(picked('a.spp:5'), [4])
  assert.deepEqual(picked('a.spp:6'), [10, 11])
  assert.deepEqual(picked('a.spp:11'), [11])
  // A Background belongs to every scenario, so its lines pick none out.
  assert.deepEqual(picked('a.spp:3'), [])
  assert.deepEqual(picked('a.spp'), [4, 10, 11])
  assert.deepEqual(picked('.'), [4, 10, 11])
  assert.deepEqual(picked('b.spp'), [])
  assert.deepEqual(scenarios[1].outline, { name: 'Rows', line: 6, row: 'p: /a' })
})
