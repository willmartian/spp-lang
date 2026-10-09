#!/usr/bin/env node

// spp-lang test [paths...] [--base-url <url>] [playwright test options...]
// spp-lang check [paths...]
// spp-lang dictionary
// spp-lang lsp
//
// Runs the scenarios with Playwright, or just checks them, without a browser,
// or lists the words they can use. The project's Playwright config says where
// the .spp files are; without one, every .spp file, and every Markdown file's
// ```spp blocks, under the current directory. Everything else, like --headed,
// --ui or --grep, goes to Playwright.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { styleText } from 'node:util'
import { Command, Option } from 'commander'
import { browser } from '../src/backends/playwright/words.ts'
import type { Project } from '../src/config.ts'
import { findConfig, loadProjects } from '../src/config.ts'
import type { Diagnostic } from '../src/language/check.ts'
import { analyze, check, format } from '../src/language/check.ts'
import { core } from '../src/language/cognate.ts'
import type { SppFile } from '../src/language/load.ts'
import { discover, LoadError, load } from '../src/language/load.ts'
import { dictionary } from '../src/tools/dictionary.ts'
import { leftovers } from '../src/words/shared.ts'

// Commander leaves the colour out when the output isn't a terminal, or $NO_COLOR is set.
const style = (format: Parameters<typeof styleText>[0], text: string) =>
  styleText(format, text, { validateStream: false })

// From the source, package.json is one directory up; once built, two.
const packageJson = ['../package.json', '../../package.json']
  .map((p) => path.join(import.meta.dirname, p))
  .find((p) => fs.existsSync(p))
if (!packageJson) throw new Error(`No package.json above ${import.meta.dirname}`)
const { version } = JSON.parse(fs.readFileSync(packageJson, 'utf8'))

const program = new Command('spp-lang')
  .usage('<command> [options]')
  .version(version, '-V, --version', 'Show the version')
  .helpOption('-h, --help', 'Show help')
  .helpCommand('help [command]', 'Show help for a command')
  // Set before the subcommands, which inherit it.
  .configureHelp({
    styleTitle: (s) => style('bold', s),
    styleCommandText: (s) => style('cyan', s),
    styleSubcommandText: (s) => style('cyan', s),
    styleOptionText: (s) => style('cyan', s),
  })
  .addHelpText('beforeAll', `${style(['green', 'bold'], 'Spec++')} ${style('dim', version)}\n`)
  .addHelpText('before', 'Specs that run. Written by agents, read by people.\n')
  .addHelpText(
    'after',
    `
${style('bold', 'Examples:')}
  ${style('dim', '$')} spp-lang test features --base-url http://localhost:3000
  ${style('dim', '$')} spp-lang test features/cart.spp:12 --headed
  ${style('dim', '$')} spp-lang check

The project is what the defineSppConfig calls in the Playwright config above
the current directory say, or, without one, every .spp file, and Markdown file
with a \`\`\`spp block, under it. Every Define in a project can be used by all
of its files.`,
  )

program
  .command('test')
  .usage('[paths...] [--base-url <url>] [playwright test options...]')
  .description('Run the scenarios as Playwright tests')
  .argument('[paths...]')
  .addOption(new Option('-u, --base-url <url>', 'Where "Visit "/"" goes').env('SPP_BASE_URL'))
  .allowUnknownOption()
  .addHelpText(
    'after',
    `
Runs "playwright test" with the project's Playwright config, or, without one,
on every .spp file under the current directory. A path can be a directory, a
file, or a file and a line, like features/cart.spp:12, for the scenario on that
line, or the one a step on that line is in. The \`\`\`spp blocks in Markdown
files are scenarios too, so README.md:40 works the same.

Everything else, like --headed, --ui, --grep or --project, is passed to
"playwright test" as it is.`,
  )
  .action((args: string[], options: { baseUrl?: string }) => process.exit(runTests(args, options.baseUrl)))

program
  .command('check')
  .description('Check the files without a browser')
  .argument('[paths...]')
  .addHelpText(
    'after',
    `
Checks every file under each path, or the whole project, and exits non-zero if
it finds a mistake. The rest of the project is still loaded, for its Defines.`,
  )
  .action(async (paths: string[]) => process.exit(checkOnly(await loadProjects(), paths)))

program
  .command('dictionary')
  .description('List every word the project can use')
  .addHelpText(
    'after',
    `
Lists the built-in words and the project's own Defines, with what each takes
and leaves.`,
  )
  .action(async () => process.exit(printDictionary(await loadProjects())))

program
  .command('lsp')
  .description('Language server for editors')
  .addHelpText(
    'after',
    `
A language server over stdio: mistakes as you type, signatures on hover,
completion and go to definition.`,
  )
  // What editors' language clients pass. Stdio is the only way it talks, and
  // the server reads the client's process id itself, to exit when it does.
  .addOption(new Option('--stdio').hideHelp())
  .addOption(new Option('--clientProcessId <pid>').hideHelp())
  .action(async () => {
    // Loaded only here, so running tests doesn't pay for it.
    const { startServer } = await import('../src/tools/lsp.ts')
    startServer()
  })

await program.parseAsync()

// Whether a file is one of those the paths name; with none, every file is.
function named(paths: string[], cwd: string) {
  const targets = paths.map((p) => path.resolve(cwd, p.replace(/:\d+$/, '')))
  return (file: string) => !targets.length || targets.some((t) => file === t || file.startsWith(t + path.sep))
}

// A project's files, and why those that don't load don't.
function loadAll(project: Project): { files: SppFile[]; broken: LoadError[] } {
  const files: SppFile[] = []
  const broken: LoadError[] = []
  for (const file of discover(project.features, project.root, project.ignore)) {
    try {
      files.push(load(file))
    } catch (err) {
      if (!(err instanceof LoadError)) throw err
      broken.push(err)
    }
  }
  return { files, broken }
}

function checkOnly(projects: Project[], paths: string[]): number {
  const cwd = process.cwd()
  const shown = named(paths, cwd)
  // Each project is checked whole, since the named files may use Defines from
  // the rest of it. A file in more than one is reported once.
  const seen = new Set<string>()
  const checked = new Set<string>()
  let problems = 0
  for (const project of projects) {
    const { files, broken } = loadAll(project)
    for (const err of broken) {
      if (!shown(err.file) || seen.has(err.file)) continue
      seen.add(err.file)
      checked.add(err.file)
      // A file that doesn't parse: its message already says where.
      console.log(`${path.relative(cwd, err.file)}\n  ${err.message}\n`)
      problems++
    }
    const report = check(files, { words: browser(core()), settle: leftovers, cwd })
    // An Outline's rows share their steps, and so their mistakes.
    const diagnostics = [...report.vocabulary, ...report.scenarios.values()].filter((d: Diagnostic) => {
      const key = `${d.file}:${d.line}:${d.column}:${d.message}`
      return shown(d.file) && !seen.has(key) && seen.add(key)
    })
    for (const d of diagnostics) console.log(`${format(d, fs.readFileSync(d.file, 'utf8'), cwd)}\n`)
    problems += diagnostics.length
    for (const f of files) if (shown(f.file)) checked.add(f.file)
  }

  const count = checked.size
  const files = `${count} file${count === 1 ? '' : 's'}`
  console.log(problems ? `${problems} mistake${problems === 1 ? '' : 's'} in ${files}` : `No mistakes in ${files}`)
  return problems ? 1 : 0
}

function printDictionary(projects: Project[]): number {
  const cwd = process.cwd()
  const words = browser(core())
  for (const [i, project] of projects.entries()) {
    // With more than one project, each has words of its own.
    if (projects.length > 1) {
      const where = project.features.map((f) => path.relative(cwd, f) || '.').join(', ')
      console.log(`${i ? '\n' : ''}${style('bold', `Project: ${where}`)}\n`)
    }
    // A file that doesn't parse has no Defines to list; check says why.
    const { files } = loadAll(project)
    console.log(dictionary(words, analyze(files, { words, settle: leftovers, cwd }), cwd))
  }
  return 0
}

// Runs Playwright with the project's config, or Spec++'s own without one.
// Every argument goes to Playwright, but a .spp or Markdown file and a step's
// line becomes its scenario's line, which is what Playwright knows the test by.
function runTests(args: string[], baseURL: string | undefined): number {
  const require = createRequire(import.meta.url)
  // .ts when run from source, .js once built
  const config =
    findConfig(process.cwd()) ??
    path.join(
      import.meta.dirname,
      `../src/backends/playwright/runner/playwright.config${path.extname(import.meta.filename)}`,
    )

  const result = spawnSync(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', '--config', config, ...args.map(scenarioLine)],
    {
      stdio: 'inherit',
      env: { ...process.env, SPP_CWD: process.cwd(), ...(baseURL ? { SPP_BASE_URL: baseURL } : {}) },
    },
  )
  return result.status ?? 1
}

// "features/cart.spp:14", where line 14 is a step, as "features/cart.spp:12",
// the line of its scenario. Anything else is left as it is.
function scenarioLine(arg: string): string {
  const m = /^(.+\.(?:spp|md)):(\d+)$/.exec(arg)
  if (!m || !fs.existsSync(m[1])) return arg
  const [, file, line] = m
  let loaded: SppFile
  try {
    loaded = load(path.resolve(file))
  } catch {
    return arg
  }
  const n = Number(line)
  const scenario = loaded.features.flatMap((f) => f.scenarios).find((s) => s.lines.includes(n))
  if (!scenario) return arg
  // A step of an Outline is in every row, so it names the Outline, and all of them.
  const target = scenario.outline && n !== scenario.line ? scenario.outline.line : scenario.line
  return target === n ? arg : `${file}:${target}`
}
