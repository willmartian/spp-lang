// The words a scenario is made of.
//
// A scenario is a program too. Its steps run top to bottom, on a stack of
// their own, and each is a keyword word applied to a block: the step's text.
//
//     Given : Step, Mode -> Mode    runs the step, and leaves its mode
//     Given : Step -> Mode          the same, first in a scenario
//     And   : Step, Mode -> Mode    runs the step in the mode above it,
//                                   and leaves it for the next
//
// So And takes the mode off the stack, like any argument, rather than
// remembering it, and a scenario that starts with And has nothing to take.
//
// A step's block runs on a stack of its own, so it can't reach into the
// steps before it, and its mode says what it may leave when it's done.
// For now every mode says the same, the rule in words/shared.ts's settler: only
// checks. Given, When and Then are where each will say more.

import type { Block } from './cognate.ts'
import { call, Env, Stack } from './cognate.ts'
import type { Context, Form } from './types.ts'
import { formsFor, type } from './types.ts'

// A step, waiting for its keyword: its block, and the DocString or DataTable
// under it, which its block finds on its stack.
export class StepBlock {
  block: Block
  argument?: string | string[][]
  // whether its keyword got as far as running it
  ran = false

  constructor(block: Block, argument?: string | string[][]) {
    this.block = block
    this.argument = argument
  }
  describe() {
    return 'the step'
  }
}

// What a keyword leaves for the And after it: the keyword it was, as
// written in English, since that's what an And means.
export class Mode {
  keyword: string

  constructor(keyword: string) {
    this.keyword = keyword
  }
  describe() {
    return this.keyword
  }
}

export const StepType = type('Step', 'a step', (v): v is StepBlock => v instanceof StepBlock)
export const ModeType = type('Mode', 'a Given, When or Then above it', (v): v is Mode => v instanceof Mode)

// Gherkin's own names for its keywords, in any language, as the words
// they are here.
const WORDS: Record<string, string> = {
  Context: 'Given',
  Action: 'When',
  Outcome: 'Then',
  Conjunction: 'And',
  Unknown: '*',
}

// The forms of a step's keyword, from a vocabulary keywords() made.
export function keywordForms(words: Env, keywordType: string | undefined): readonly Form[] {
  const word = WORDS[keywordType ?? 'Unknown'] ?? '*'
  const forms = words.forms(word)
  if (!forms) throw new Error(`${word} isn't a keyword word`)
  return forms
}

// The keyword words, given the rule for what a step may leave.
export function keywords<C extends Context>(settle: (stack: Stack, ctx: C) => Promise<void>): Env {
  const form = formsFor<C>()
  // Runs the step, then leaves the mode it's in.
  const runs = async (ctx: C, step: StepBlock, mode: Mode) => {
    step.ran = true
    const stack = new Stack()
    if (step.argument !== undefined) stack.push(step.argument)
    await call(step.block, stack, ctx)
    await settle(stack, ctx)
    return mode
  }
  const keyword = (name: string) => [
    form([StepType, ModeType], ModeType, (ctx, step) => runs(ctx, step, new Mode(name))),
    form([StepType], ModeType, (ctx, step) => runs(ctx, step, new Mode(name))),
  ]
  const conjunction = form([StepType, ModeType], ModeType, (ctx, step, mode) => runs(ctx, step, mode))
  return (
    new Env()
      .word('Given', ...keyword('Given'))
      .word('When', ...keyword('When'))
      .word('Then', ...keyword('Then'))
      .word('And', conjunction)
      .word('But', conjunction)
      // A bullet carries on the mode above, or, first, is a step of no mode.
      .word(
        '*',
        conjunction,
        form([StepType], ModeType, (ctx, step) => runs(ctx, step, new Mode('*'))),
      )
  )
}
