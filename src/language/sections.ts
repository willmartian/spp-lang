// How a file divides into its Defines and its Gherkin, and, for editors,
// where on each line the code is. Every part is a copy of the whole file with
// the other lines blanked, so line numbers in errors stay true.

import { dialects } from '@cucumber/gherkin'
import { isMarkdown, sppFences } from './markdown.ts'

// A file's parts: its Defines, and its Gherkin, a Feature each. orphan is
// the line of a Markdown block that carries on a Feature when there's none
// above it.
export interface Sections {
  preambles: string[]
  documents: string[]
  orphan?: number
}

export function sections(file: string, src: string): Sections {
  if (isMarkdown(file)) return markdownSections(src)
  const { preamble, gherkin } = split(src)
  return { preambles: [preamble], documents: gherkin === null ? [] : [gherkin] }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const featureKeywords = [...new Set(Object.values(dialects).flatMap((d) => d.feature))]
const FEATURE = new RegExp(`^\\s*(?:${featureKeywords.map(escapeRegExp).join('|')}):`)

// Splits a file at its Feature line, taking the tags and comments just above
// it along. Both halves keep every line, blanked where they belong to the
// other, so line numbers in errors stay true.
export function split(src: string): { preamble: string; gherkin: string | null } {
  const lines = src.split('\n')
  let start = lines.findIndex((l) => FEATURE.test(l))
  if (start === -1) return { preamble: src, gherkin: null }
  while (start > 0 && /^\s*(?:@|#|$)/.test(lines[start - 1])) start--
  const comment = (l: string) => /^\s*#/.test(l)
  return {
    preamble: lines.map((l, i) => (i < start ? l : '')).join('\n'),
    gherkin: lines.map((l, i) => (i >= start || comment(l) ? l : '')).join('\n'),
  }
}

// Whether a block starts like the middle of a Feature: with any Gherkin
// keyword but Feature, a tag or a table.
function carriesOn(first: string, language: string): boolean {
  const d = dialects[language] ?? dialects.en
  const sections = [...d.background, ...d.scenario, ...d.scenarioOutline, ...d.rule, ...d.examples].map((k) => `${k}:`)
  const steps = [...d.given, ...d.when, ...d.then, ...d.and, ...d.but]
  const trimmed = first.trimStart()
  return /^[@|]/.test(trimmed) || [...sections, ...steps].some((k) => trimmed.startsWith(k))
}

// A Markdown file's ```spp blocks, in order. A block with a Feature line
// starts a new Feature, and anything above that line in it is Defines. A
// block that starts like Gherkin carries on the Feature before it, so prose
// can sit between the scenarios of one Feature. Any other block is Defines,
// and every file shares them, as it does a .spp file's.
function markdownSections(src: string): Sections {
  const lines = src.split('\n')
  const language = /^\s*#\s*language:\s*(\S+)/m.exec(src)?.[1] ?? 'en'
  const preambles: Set<number>[] = []
  const documents: Set<number>[] = []
  let orphan: number | undefined
  // A block's lines that a view of it keeps, as lines of the whole file.
  const kept = (view: string, start: number) => new Set(view.split('\n').flatMap((l, i) => (l ? [start + i] : [])))

  for (const fence of sppFences(src)) {
    const block = lines.slice(fence.start, fence.end)
    const { preamble, gherkin } = split(block.join('\n'))
    const first = block.find((l) => l.trim() && !/^\s*#/.test(l))
    if (gherkin !== null) {
      preambles.push(kept(preamble, fence.start))
      documents.push(kept(gherkin, fence.start))
    } else if (first !== undefined && carriesOn(first, language)) {
      let last = documents.at(-1)
      if (!last) {
        orphan ??= fence.start + 1
        last = new Set()
        documents.push(last)
      }
      for (const i of kept(preamble, fence.start)) last.add(i)
    } else {
      preambles.push(kept(preamble, fence.start))
    }
  }
  const view = (keep: Set<number>) => lines.map((l, i) => (keep.has(i) ? l : '')).join('\n')
  return { preambles: preambles.filter((p) => p.size).map(view), documents: documents.map(view), orphan }
}

// ---------------------------------------------------------------- editors

// Where each line's code is, for editors: all of a Define line, the text after
// a step's keyword, nothing on the rest. keyword is a step's, if it has one.
export interface CodeLine {
  offset: number
  text: string
  keyword?: { offset: number; length: number }
}

export function codeLines(src: string, file = ''): (CodeLine | null)[] {
  const lines = src.split('\n')
  const { preambles, documents } = sections(file, src)
  const kept = (views: string[]) => {
    const keep = lines.map(() => false)
    for (const view of views) {
      for (const [i, l] of view.split('\n').entries()) if (l) keep[i] = true
    }
    return keep
  }
  const defines = kept(preambles)
  const gherkin = kept(documents)
  const language = /^\s*#\s*language:\s*(\S+)/m.exec(src)?.[1] ?? 'en'
  const d = dialects[language] ?? dialects.en
  const stepKeywords = [...new Set([...d.given, ...d.when, ...d.then, ...d.and, ...d.but])].sort(
    (a, b) => b.length - a.length,
  )
  let docString: string | null = null
  return lines.map((line, i) => {
    const trimmed = line.trimStart()
    const indent = line.length - trimmed.length
    if (!trimmed || trimmed.startsWith('#')) return null
    if (defines[i]) return { offset: 0, text: line }
    if (!gherkin[i]) return null
    // Doc strings can hold anything, including lines that look like steps.
    const fence = /^("""|```)/.exec(trimmed)?.[1]
    if (fence && (docString === null || docString === fence)) {
      docString = docString === null ? fence : null
      return null
    }
    if (docString !== null) return null
    const keyword = stepKeywords.find((k) => trimmed.startsWith(k))
    if (!keyword) return null
    const offset = indent + keyword.length
    return { offset, text: line.slice(offset), keyword: { offset: indent, length: keyword.trimEnd().length } }
  })
}
