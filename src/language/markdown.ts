// The Markdown Spec++ reads: fenced code blocks, and which of them are
// ```spp blocks to load. It knows nothing of Gherkin; how a block's lines
// divide into Defines and Features is in sections.ts.

export const isMarkdown = (file: string) => file.endsWith('.md')

// A fenced code block: the lines between its fences (from 0, end exclusive),
// and the words of its info string, as in ```spp ignore or ```spp,ignore.
export interface Fence {
  start: number
  end: number
  info: string[]
}

// Every fenced code block, as CommonMark finds them: a fence of three or more
// backticks or tildes, closed by as many or more of the same, or by the end
// of the file. A fence inside another block is only its content.
export function fences(src: string): Fence[] {
  const lines = src.split('\n')
  const found: Fence[] = []
  let open: { char: string; length: number; start: number; info: string[] } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (!open) {
      // A backtick fence's info string can't have a backtick in it.
      if (!m || (m[1][0] === '`' && m[2].includes('`'))) continue
      open = {
        char: m[1][0],
        length: m[1].length,
        start: i + 1,
        info: m[2]
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean),
      }
    } else if (m && m[1][0] === open.char && m[1].length >= open.length && !m[2].trim()) {
      found.push({ start: open.start, end: i, info: open.info })
      open = null
    }
  }
  if (open) found.push({ start: open.start, end: lines.length, info: open.info })
  return found
}

// The blocks that are loaded: ```spp, but not ```spp ignore, which is only shown.
export function sppFences(src: string): Fence[] {
  return fences(src).filter((f) => f.info[0] === 'spp' && !f.info.includes('ignore'))
}

// Which lines are Spec++: all of a .spp file's, and in Markdown, those in
// the blocks that are loaded.
export function sppLines(file: string, src: string): boolean[] {
  const lines = src.split('\n')
  if (!isMarkdown(file)) return lines.map(() => true)
  const inside = lines.map(() => false)
  for (const f of sppFences(src)) for (let i = f.start; i < f.end; i++) inside[i] = true
  return inside
}
