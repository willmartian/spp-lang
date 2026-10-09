// Which .spp files make up a project, for the tools that don't run Playwright:
// the checker, the dictionary and the language server. Playwright's config
// says, through its defineSppConfig calls (backends/playwright/generate.ts).
//
// The config is found by looking up from the current directory. Loading it
// runs it, but only to collect what its defineSppConfig calls say: nothing is
// generated. Without a config, or one with no defineSppConfig in it, the
// project is every .spp file under the current directory.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// A defineSppConfig's options, with its paths made absolute: one set of .spp
// files that share their Defines.
export interface Project {
  root: string
  features: string[]
  ignore: string[]
  outputDir: string
}

// Every project a config has defined, for tools like the checker and the
// language server, which load a Playwright config to find out what's in it.
// Kept on globalThis, since a config may load a different copy of Spec++ than
// the tool that loads the config.
interface Registry {
  // While a tool loads a config: collect projects, and generate nothing.
  collecting: boolean
  projects: Project[]
}

const holder = globalThis as typeof globalThis & { sppRegistry?: Registry }
holder.sppRegistry ??= { collecting: false, projects: [] }
export const registry: Registry = holder.sppRegistry

const NAMES = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `playwright.config.${ext}`)

export function findConfig(from: string): string | undefined {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = NAMES.map((name) => path.join(dir, name)).find((f) => fs.existsSync(f))
    if (file) return file
    if (dir === path.dirname(dir)) return undefined
  }
}

// Every .spp file under a directory, when nothing says otherwise.
export const everything = (root: string): Project => ({
  root: path.resolve(root),
  features: [path.resolve(root)],
  ignore: [],
  outputDir: path.resolve(root, '.spp-tests'),
})

// The projects the config above a directory defines. Loading a config runs
// it, so pass trusted: false where the project's code mustn't run, and get
// the default instead.
export async function loadProjects(from = process.cwd(), { trusted = true } = {}): Promise<Project[]> {
  const file = trusted ? findConfig(from) : undefined
  if (!file) return [everything(from)]

  registry.collecting = true
  registry.projects = []
  try {
    // A new URL each time, so a config that's changed is read again.
    await import(`${pathToFileURL(file).href}?spp=${Date.now()}`)
    return registry.projects.length ? [...registry.projects] : [everything(path.dirname(file))]
  } finally {
    registry.collecting = false
    registry.projects = []
  }
}

// Whether a file is one of a project's: under its features, and not ignored.
export function contains(project: Project, file: string): boolean {
  const within = (dir: string) => file === dir || file.startsWith(dir + path.sep)
  return project.features.some(within) && !project.ignore.some(within)
}
