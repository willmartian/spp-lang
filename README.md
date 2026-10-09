# 🥒 Spec++

Specs that run. Written by agents, read by people.

```gherkin
Feature: Signing in

  Scenario: The right password
    Given I Visit "/"
    When I Fill the Field "Email" with "will@example.com"
    And I Fill the Field "Password" with "hunter2"
    And I Click the Button "Sign in"
    Then I should See the Heading "Welcome back"
```

Spec++ is Gherkin without step definitions. Capitalised words are code and lowercase words
are prose, so a step runs as written. Every scenario runs as a Playwright test.

## Why

Agents writing tests reach for sleeps, conditionals and CSS selectors until a test passes.
Spec++ doesn't have them. Steps find elements by role, label and visible text, as a user
would, and a scenario does the same thing every run. A reviewer only has to ask whether the
spec tests the right thing. When nothing else works, `TestId` finds an element by test id,
and it stands out in review.

## Getting started

Spec++ needs Node.js 22.13 or later.

```sh
npm install --save-dev spp-lang @playwright/test
npx playwright install chromium
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'
import { defineSppConfig } from 'spp-lang'

export default defineConfig({
  ...defineSppConfig({ features: ['features'] }),
  use: { baseURL: 'http://localhost:3000' },
})
```

```sh
npx playwright test
npx playwright test features/sign-in.spp:12   # the scenario on line 12
```

`defineSppConfig` generates a small test file per `.spp` file in `.spp-tests/`, which you
should add to `.gitignore`. The rest of Playwright works as usual: projects, retries,
sharding, UI mode, the trace viewer and
[its VS Code extension](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright).
Failures point at the word in the `.spp` file that failed.

Without a Playwright config, `npx spp-lang test --base-url http://localhost:3000` runs every
`.spp` file under the current directory.

## The language

Capitalised words run right to left. In `Click the Button "Sign in"`, the text comes first,
`Button` turns it into the button with that name, and `Click` clicks it. Lowercase words
are skipped. Under the hood it's a small stack-based language, borrowed from
[Cognate](https://cognate-lang.github.io/). The [reference](docs/reference.md) covers
everything below in more detail, along with config options and multi-project setups.

Finding things follows [Testing Library](https://testing-library.com/docs/queries/about):

| Word | Finds |
| --- | --- |
| `Button`, `Heading`, `Link`, `Checkbox`, `Row`, `Dialog`… | an element by ARIA role and name |
| `Field`, `Label` | a form control by its label |
| `Text` | an element by its text |
| `Placeholder`, `Alt`, `Title`, `TestId` | an element by that attribute |

Names match exactly. `Containing "Kale"` matches part of a name, and `Within` searches
inside another element.

Actions: `Visit`, `Reload`, `Back`, `Click`, `Double-click`, `Hover`, `Focus`, `Check`,
`Uncheck`, `Clear`, `Fill`, `Type`, `Select`, `Press`.

Checks: `See`, `Visible`, `Hidden`, `Checked`, `Enabled`, `Disabled`, `Focused`, `Empty`,
`Value`, `Read`, `Contain`, `At` and `Titled`. `Not` negates any of them, and they retry
like Playwright's `expect`.

```gherkin
When I Click the Button "Remove" Within the Row Containing "Kale"
Then I should Not See the Cell "Kale"
And I should be At "/list"
```

Backgrounds, Scenario Outlines, Rules and data tables work as in Cucumber. Tags become
Playwright tags, so `@skip`, `@only` and `--grep @smoke` work.

### Your own words

Project vocabulary is written in Spec++ too, with `Define`:

```gherkin
Define: Add Text (Item)
  Fill the Field "Item" with Item
  Click the Button "Add"

Feature: The grocery list

  Scenario: Adding things
    When I Add "Milk" to the list
    Then I should See the Cell "Milk"
```

After its name, a Define lists what it takes: `Text`, `Number`, `Element`, `Table` or
`Any`, with an optional name in brackets. Defines can sit above a Feature or in a file of
their own, and every file in the project can use them. A Define that leaves one value,
like `Define: Cart` leaving a region of the page, becomes a type that other Defines can take.

### Checking

Every word has a type, so steps are checked before a browser starts. The types of your own
Defines are inferred from how they're used.

```
SppError: Click expected something on the page, but got "Add"

  > 4 |     When I Click "Add"
      |            ^
```

```sh
npx spp-lang check        # check without running
npx spp-lang dictionary   # list every word you can use, with its type
```

## In Markdown

` ```spp ` blocks in Markdown files run as tests too, like Rust's doctests, so the examples
in your docs stay true. Mark a block ` ```spp ignore ` to leave it out. See
[`examples/demo/features/README.md`](examples/demo/features/README.md).

## Editors

`spp-lang lsp` is a language server with diagnostics, hover, go to definition, find
references and completion.

- **VS Code:** install
  [the Spec++ extension](https://marketplace.visualstudio.com/items?itemName=spp-lang.spp-vscode).
  It uses your project's `spp-lang` if there is one.
- **Claude Code:** install the plugin, which teaches Claude the language and runs the
  language server.

  ```sh
  claude plugin marketplace add willmartian/spp-lang
  claude plugin install spp-lang@spp-lang
  ```

- **Neovim** (0.11 or later):

  ```lua
  vim.filetype.add({ extension = { spp = 'spp' } })
  vim.lsp.config('spp', {
    cmd = { 'npx', 'spp-lang', 'lsp' },
    filetypes = { 'spp' },
    root_markers = { 'package.json', '.git' },
  })
  vim.lsp.enable('spp')
  ```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
