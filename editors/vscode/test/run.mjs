// Opens VS Code on a small workspace with this extension loaded, and runs
// test/suite.cjs inside it. Without a display (CI, or to keep the window out
// of the way), run it under xvfb-run -a.
//
// It uses the VS Code on PATH when it can find its Electron binary, which is
// how NixOS lays it out, or $SPP_VSCODE; otherwise it downloads one.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runTests } from '@vscode/test-electron'

const here = import.meta.dirname

function installedVSCode() {
  if (process.env.SPP_VSCODE) return process.env.SPP_VSCODE
  try {
    const launcher = fs.realpathSync(execFileSync('which', ['code'], { encoding: 'utf8' }).trim())
    const electron = path.join(path.dirname(launcher), '..', 'lib', 'vscode', 'code')
    return fs.existsSync(electron) ? electron : undefined
  } catch {
    return undefined
  }
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'spp-vscode-'))
fs.writeFileSync(
  path.join(workspace, 'words.spp'),
  ['Define: Add Text (Item)', '  Fill the Field "Item" with Item', '  Click the Button "Add"', ''].join('\n'),
)
fs.writeFileSync(
  path.join(workspace, 'a.spp'),
  ['Feature: Groceries', '  Scenario: Adding', '    When I Add "Milk"', '    And I Click "Add"', ''].join('\n'),
)
// Markdown, with two Features: one carried on across blocks, one with a mistake.
fs.writeFileSync(
  path.join(workspace, 'guide.md'),
  [
    '# A guide', //                                     1
    '', //                                              2
    '```spp', //                                        3
    'Feature: Guide', //                                4
    '  Scenario: Passes', //                            5
    '    Given I Visit "data:text/html,<h1>Hi</h1>"', // 6
    '    Then I should See the Heading "Hi"', //        7
    '```', //                                           8
    '', //                                              9
    'Some prose.', //                                   10
    '', //                                              11
    '```spp', //                                        12
    '  Scenario: Also passes', //                       13
    '    Given I Visit "data:text/html,<h1>Hi</h1>"', // 14
    '```', //                                           15
    '', //                                              16
    '```spp', //                                        17
    'Feature: Another', //                              18
    '  Scenario: A mistake', //                         19
    '    When I Click "Add"', //                        20
    '```', //                                           21
    '',
  ].join('\n'),
)
// This repo's spp-lang, from source, since there's no node_modules/spp-lang here.
fs.mkdirSync(path.join(workspace, '.vscode'))
fs.writeFileSync(
  path.join(workspace, '.vscode', 'settings.json'),
  JSON.stringify({ 'spp.path': path.join(here, '..', '..', '..', 'bin', 'spp-lang.ts') }),
)

try {
  await runTests({
    vscodeExecutablePath: installedVSCode(),
    extensionDevelopmentPath: path.join(here, '..'),
    extensionTestsPath: path.join(here, 'suite.cjs'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${path.join(workspace, '.vscode-user')}`,
    ],
  })
} catch (err) {
  console.error(err)
  process.exit(1)
}
