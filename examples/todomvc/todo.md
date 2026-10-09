# TodoMVC: gaps

What came up converting Playwright's
[`demo-todo-app.spec.ts`](demo-todo-app.spec.ts) to [`features`](features). Each gap has
the closest thing Spec++ can say today, which is what the features use. Scenarios that
can't run yet are tagged `@fixme`.

18 of the 24 scenarios are `@fixme`, all because of the first gap. With a temporary patch
that made `Listitem Containing "…"` fall back to the item's text, all 24 passed, so nothing
else is blocking.

## Blocking

- [ ] **Finding something by the text inside it.** A TodoMVC list item has no accessible
      name, so `the Listitem Containing "feed the cat"` finds nothing, and there's no way to
      pick one todo out of several. Playwright has `filter({ hasText })`, and the spec uses
      `nth()`. Rows work only because a row takes its name from its content. `Todo` in
      [`words.spp`](features/words.spp) is written as if it worked, so fixing this should
      only mean removing the `@fixme` tags.

## Coverage the features lose

- [ ] **A list's exact contents, in order.** The spec checks
      `toHaveText(['buy some cheese', 'feed the cat', …])`. The features `See` each todo,
      which misses the order and anything extra. This affects adding, appending to the
      bottom, and every edit.
- [ ] **Counting.** This is already in the repo's [`todo.md`](../../docs/todo.md). The spec's
      `toHaveCount(2)` became "2 items left", which is what a user sees, but it counts
      active todos, not the todos shown.
- [ ] **Classes: `completed` and `selected`.** The features check the checkbox instead of
      `completed`, and the URL (`At "/#/active"`) instead of `selected`. Should "struck
      through" or "highlighted" count as something a user can see (see "Enforce Given /
      When / Then" in the repo's `docs/todo.md`)? TodoMVC doesn't set `aria-current`, so there's
      nothing accessible to check instead.
- [ ] **Checking localStorage, and `afterEach`.** The spec waits on
      `localStorage['react-todos']` in most tests, including an `afterEach`. These checks
      are left out, and `Reload` covers persistence the way a user would notice it. Doing
      them would need the JavaScript escape hatch, plus somewhere to put an after-hook,
      which Gherkin doesn't have.

## Friction

- [ ] **A Define can't add a form to a built-in word it also uses.** `Define: Check Todo`,
      whose body is `Check the Checkbox "Toggle Todo" Within Todo`, is reported as "Check
      uses itself, so it would never finish", even though the inner `Check` takes an Element
      and would resolve to the built-in. The features use `Tick` and `Untick` instead.
      `When I Check the Todo "feed the cat"` is what you'd write first.
- [ ] **A Define's value can't be called by a word that's already taken.**
      `Define: Add Text (Title)` fails because `Title` is a query, so it had to be called
      `Name`. Nearly 90 role and query words are taken, including natural names like
      `Title`, `Text`, `Label`, `Link` and `Row`. Should a value's name hide the word inside
      its own body?
- [ ] **A Define can't go through a table's rows.** Most features start with the same three
      todos, and the scenarios then name them, so the todos belong in the feature, not
      hidden in a word. Each Background spells out three `Add` steps. What you'd write is:

      ```gherkin
      Given I Add these todos:
        | buy some cheese            |
        | feed the cat               |
        | book a doctors appointment |
      ```

      That needs `Add` to take a table and do its body once per row. `Fill` already does
      that as a built-in, and doing the same thing for each row isn't branching, so it
      wouldn't break the rule that a spec reads the same every time it runs.
- [ ] **Parts of a noun.** Once a Todo is a noun, you'd want to say
      `the Todo "feed the cat" should be Checked`, meaning its checkbox. Instead the
      features say `the Checkbox "Toggle Todo" Within the Todo "feed the cat" should be
      Checked`, and they say it seven times. This relates to "Reading fields from values" in
      the repo's `docs/todo.md`.
- [ ] **Blur.** The spec calls `dispatchEvent('blur')`. The features click the heading
      instead, which is how a user would do it, and may be fine as it is.

## Not a gap

- Trimming can't be checked by text, because Playwright normalises whitespace even for exact
  matches. The spec's own check has the same weakness.
