// The ```spp blocks in Markdown files: finding them, and loading them as
// Defines and Features with true line numbers.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { codeLines, discover, fences, type LoadError, load, loadSource, selects } from '../../src/index.ts'

test('fenced blocks are found as CommonMark finds them', () => {
  const src = [
    '````markdown', //   0
    '```spp', //         1: inside the markdown block, so only its content
    '```', //            2
    '````', //           3
    '~~~ spp ignore', // 4
    'x', //              5
    '~~~', //            6
    '```spp,ignore', //  7
    '```', //            8
    '```spp', //         9: never closed, so it runs to the end
    'y', //              10
  ].join('\n')
  assert.deepEqual(fences(src), [
    { start: 1, end: 3, info: ['markdown'] },
    { start: 5, end: 6, info: ['spp', 'ignore'] },
    { start: 8, end: 8, info: ['spp', 'ignore'] },
    { start: 10, end: 11, info: ['spp'] },
  ])
})

const readme = [
  '# Groceries', //                       1
  '', //                                  2
  '```spp', //                            3
  'Define: Add', //                       4: Defines above a Feature
  '  Click the Button "Add"', //          5
  '', //                                  6
  'Feature: Adding', //                   7
  '  Scenario: One', //                   8
  '    When I Add', //                    9
  '```', //                               10
  '', //                                  11
  'Some prose between scenarios.', //     12
  '', //                                  13
  '```spp', //                            14: carries on Adding
  '  Scenario: Two', //                   15
  '    When I Add', //                    16
  '```', //                               17
  '', //                                  18
  '```spp ignore', //                     19: shown, not loaded
  'Feature: Not this', //                 20
  '```', //                               21
  '', //                                  22
  '```spp', //                            23: a Feature of its own
  'Feature: Removing', //                 24
  '  Scenario: Three', //                 25
  '    When I Remove', //                 26
  '```', //                               27
  '', //                                  28
  '```spp', //                            29: Defines after a Feature
  'Define: Remove', //                    30
  '  Click the Button "Remove"', //       31
  '```', //                               32
  '',
].join('\n')

test('a Markdown file is its ```spp blocks, with true line numbers', () => {
  const file = loadSource('/x/README.md', readme)
  assert.deepEqual(
    file.features.map((f) => [f.name, f.line, f.scenarios.map((s) => [s.name, s.line, s.steps[0].line])]),
    [
      [
        'Adding',
        7,
        [
          ['One', 8, 9],
          ['Two', 15, 16],
        ],
      ],
      ['Removing', 24, [['Three', 25, 26]]],
    ],
  )
  assert.equal(file.vocabulary.length, 2)
  assert.deepEqual(
    file.vocabulary.map((v) => v.src.split('\n').flatMap((l, i) => (l ? [i + 1] : []))),
    [
      [4, 5],
      [30, 31],
    ],
  )
})

test('a block that carries on a Feature needs one above it', () => {
  assert.throws(() => loadSource('/x/a.md', 'Hi\n\n```spp\n  Scenario: S\n    When I Reload\n```\n'), {
    name: 'LoadError',
    problems: [{ line: 4, column: 1, message: 'This block carries on a Feature, but there is none above it' }],
  })
})

test('a Markdown mistake points into the Markdown file', () => {
  assert.throws(
    () => loadSource('/x/a.md', 'Hi\n\n```spp\nFeature: F\n  Scenario: S\n    When I Reload\n  Nonsense here\n```\n'),
    (err: LoadError) => err.problems[0].line === 7 && err.problems[0].column === 3,
  )
})

test("in Markdown, only the ```spp blocks' lines are code", () => {
  const code = codeLines(readme, '/x/README.md')
  const lines = code.flatMap((c, i) => (c ? [i + 1] : []))
  assert.deepEqual(lines, [4, 5, 9, 16, 26, 30, 31])
  assert.equal(code[8]?.text, 'I Add')
})

test('discovery finds Markdown files with an ```spp block, and only those', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-md-'))
  fs.writeFileSync(path.join(dir, 'a.md'), readme)
  fs.writeFileSync(path.join(dir, 'b.md'), '# Nothing\n\n```gherkin\nFeature: F\n```\n')
  fs.writeFileSync(path.join(dir, 'c.md'), '```spp ignore\nFeature: F\n```\n')
  fs.writeFileSync(path.join(dir, 'd.spp'), '')
  assert.deepEqual(discover([dir]), [path.join(dir, 'a.md'), path.join(dir, 'd.spp')])
})

test('a scenario in Markdown is picked out by its line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-md-'))
  const file = path.join(dir, 'README.md')
  fs.writeFileSync(file, readme)
  const scenarios = load(file).features.flatMap((f) => f.scenarios)
  const picked = (...selections: string[]) => scenarios.filter((s) => selects(selections, s, dir)).map((s) => s.name)
  assert.deepEqual(picked('README.md:16'), ['Two'])
  assert.deepEqual(picked('README.md'), ['One', 'Two', 'Three'])
})
