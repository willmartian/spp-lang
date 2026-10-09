// The words that drive a browser: the shared words (words/shared.ts) on a
// Playwright driver, and the words only a browser has, like Visit.
//
// Playwright's getBy* locators implement Testing Library's queries, and its
// expect retries until a check passes, which is what the shared words ask of
// a driver.

import type { expect, Locator, Page } from '@playwright/test'
import { Env } from '../../language/cognate.ts'
import type { Context } from '../../language/types.ts'
import { called, formsFor, TextType } from '../../language/types.ts'
import type { Driver } from '../../words/driver.ts'
import {
  actions,
  CheckType,
  checks,
  Expectation,
  escapeRegExp,
  NameType,
  nameOf,
  queries,
  say,
  settler,
} from '../../words/shared.ts'

export interface BrowserContext extends Context {
  page: Page
  expect: typeof expect
}

type AriaRole = Parameters<Page['getByRole']>[0]

// Every ARIA role that makes sense to query by name, as a word.
const ROLES = `alert alertdialog application article banner blockquote button caption cell checkbox
  code columnheader combobox complementary contentinfo definition deletion dialog directory document
  emphasis feed figure form generic grid gridcell group heading img insertion link list listbox
  listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio navigation
  none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader
  scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch
  tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem`.split(/\s+/) as AriaRole[]

// ---------------------------------------------------------------- the driver

export const playwright: Driver<BrowserContext, Locator> = {
  roles: ROLES,
  queries: ['label', 'text', 'placeholder', 'alt', 'title', 'testId'],
  actions: ['click', 'double-click', 'hover', 'focus', 'check', 'uncheck', 'clear', 'fill', 'type', 'select', 'press'],
  states: ['visible', 'hidden', 'checked', 'enabled', 'disabled', 'focused', 'empty', 'value', 'text', 'containing'],

  find({ page }, root, query) {
    const r = root ?? page
    const { name } = query
    switch (query.by) {
      case 'role':
        return r.getByRole(query.role as AriaRole, { name, exact: true })
      case 'label':
        return r.getByLabel(name, { exact: true })
      case 'text':
        return query.loose ? r.getByText(name).first() : r.getByText(name, { exact: true })
      case 'placeholder':
        return r.getByPlaceholder(name, { exact: true })
      case 'alt':
        return r.getByAltText(name, { exact: true })
      case 'title':
        return r.getByTitle(name, { exact: true })
      case 'testId':
        return r.getByTestId(name)
    }
  },

  async act(_, target, action) {
    switch (action.do) {
      case 'click':
        return target.click()
      case 'double-click':
        return target.dblclick()
      case 'hover':
        return target.hover()
      case 'focus':
        return target.focus()
      case 'check':
        return target.check()
      case 'uncheck':
        return target.uncheck()
      case 'clear':
        return target.clear()
      case 'fill':
        return target.fill(action.text)
      case 'type':
        return target.pressSequentially(action.text)
      case 'select':
        await target.selectOption(action.text)
        return
      case 'press':
        return target.press(action.key)
    }
  },

  press({ page }, key) {
    return page.keyboard.press(key)
  },

  expect(ctx, target, state, not) {
    const e = not ? ctx.expect(target).not : ctx.expect(target)
    switch (state.is) {
      case 'visible':
        return e.toBeVisible()
      case 'hidden':
        return e.toBeHidden()
      case 'checked':
        return e.toBeChecked()
      case 'enabled':
        return e.toBeEnabled()
      case 'disabled':
        return e.toBeDisabled()
      case 'focused':
        return e.toBeFocused()
      case 'empty':
        return e.toBeEmpty()
      case 'value':
        return e.toHaveValue(state.text)
      case 'text':
        return e.toHaveText(state.text)
      case 'containing':
        return e.toContainText(state.text)
    }
  },
}

export const settle = settler(playwright)

// ---------------------------------------------------------------- vocabulary

const form = formsFor<BrowserContext>()
const Path = called(TextType, 'a "/path" or URL')

export function browser(parent: Env | null = null): Env {
  const env = queries(new Env(parent), playwright)

  // navigation
  env
    .word(
      'Visit',
      form([Path], (ctx, path) => ctx.page.goto(path)),
    )
    .word(
      'Reload',
      form([], (ctx) => ctx.page.reload()),
    )
    .word(
      'Back',
      form([], (ctx) => ctx.page.goBack()),
    )

  actions(env, playwright)
  checks(env, playwright)

  // checks on the page itself
  return env
    .word(
      'At',
      form(
        [Path],
        CheckType,
        (ctx, where) =>
          new Expectation(`At ${JSON.stringify(where)}`, (not) => {
            const e = ctx.expect(ctx.page)
            return (not ? e.not : e).toHaveURL(urlPattern(where))
          }),
      ),
    )
    .word(
      'Titled',
      form(
        [NameType],
        CheckType,
        (ctx, title) =>
          new Expectation(`Titled ${say(title)}`, (not) => {
            const e = ctx.expect(ctx.page)
            return (not ? e.not : e).toHaveTitle(nameOf(title))
          }),
      ),
    )
}

// "/dashboard" means that path on whatever host the page is on.
function urlPattern(where: string): string | RegExp {
  if (!where.startsWith('/')) return where
  return new RegExp(`^[a-z]+://[^/]+${escapeRegExp(where)}(?:[?#].*)?$`)
}
