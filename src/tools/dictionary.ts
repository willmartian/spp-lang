// The dictionary: every word a .spp file can use, built in or Defined, with
// what it takes and what it leaves. It's read from the same forms and
// inferred Defines the checker uses, so it can't drift from what the words
// do. Run it as `spp-lang dictionary`.
//
//     Click, Double-click, Hover, Focus, Check, Uncheck, Clear
//       Element ->    takes something on the page
//
// Words with the same forms, like the ARIA roles, are listed together.

import path from 'node:path'
import type { Analysis } from '../language/check.ts'
import type { Env } from '../language/cognate.ts'
import { keywords } from '../language/steps.ts'
import type { Form } from '../language/types.ts'

const KEYWORDS = keywords(async () => {})

const WIDTH = 96

export function dictionary(words: Env, analysis: Analysis, cwd = process.cwd()): string {
  const out = [
    'Built-in words',
    '',
    'Each line is one way to use a word: what it takes, in reading order, and what it leaves.',
    'The first thing a word takes is written right after it. Define is syntax, not a word,',
    "so it isn't listed.",
    '',
  ]

  out.push(...grouped(words))
  out.push(
    'Step keywords',
    '',
    'A step is a block, and its keyword is a word that runs it. Each leaves its mode for the',
    "next step, and And takes the one above it, so a scenario can't start with And.",
    '',
    ...grouped(KEYWORDS),
  )

  const defines = analysis.words().filter((w) => w.kind === 'define')
  out.push('Defined in this project', '')
  if (!defines.length) out.push('None yet.', '')
  for (const w of defines) {
    out.push(w.name)
    // one line per Define, for a word with several
    w.signatures.forEach((signature, i) => {
      const at = w.places?.[i]
      const where = at ? `${path.relative(cwd, at.file)}:${at.line}` : ''
      out.push(`  ${signature.slice(w.name.length + ' : '.length)}    ${where}`.trimEnd())
    })
    out.push('')
  }
  return out.join('\n').trimEnd()
}

// Words with the same forms, together, one line per form.
function grouped(words: Env): string[] {
  const out: string[] = []
  const groups = new Map<string, { names: string[]; forms: readonly Form[] }>()
  for (const name of new Set(words.names())) {
    const forms = words.lookup(name)
    if (!Array.isArray(forms)) continue
    const key = forms.map((f: Form) => `${shape(f)} ${takes(f)}`).join('\n')
    const group = groups.get(key)
    if (group) group.names.push(name)
    else groups.set(key, { names: [name], forms })
  }
  for (const { names, forms } of groups.values()) {
    out.push(...wrap(names))
    const width = Math.max(...forms.map((f) => shape(f).length))
    for (const f of forms) out.push(`  ${shape(f).padEnd(width)}    ${takes(f)}`)
    out.push('')
  }
  return out
}

// "Text | Pattern, Scope -> Element"
function shape(f: Form): string {
  const inputs = f.inputs.map((t) => t.name).join(', ')
  return `${inputs}${inputs ? ' ' : ''}->${f.output ? ` ${f.output.name}` : ''}`
}

// 'takes a "name" to look for, then Within something'
function takes(f: Form): string {
  return f.inputs.length ? `takes ${f.inputs.map((t) => t.phrase).join(', then ')}` : 'takes nothing'
}

// A list of names, over as many lines as it needs.
function wrap(names: string[]): string[] {
  const lines: string[] = []
  let line = ''
  for (const name of names) {
    const next = line ? `${line}, ${name}` : name
    if (next.length > WIDTH && line) {
      lines.push(`${line},`)
      line = name
    } else line = next
  }
  lines.push(line)
  return lines
}
