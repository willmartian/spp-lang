# Reference

The details the [README](../README.md) leaves out.

## Built-in words

### Finding things

A finding word takes the name to its right and leaves a locator.

| Word | Finds | Playwright |
| --- | --- | --- |
| `Button`, `Heading`, `Link`, `Checkbox`, `Row`, `Cell`, `Dialog`… | any ARIA role, by accessible name | `getByRole` |
| `Field`, `Label` | a form control by its label | `getByLabel` |
| `Text` | an element by its text | `getByText` |
| `Placeholder`, `Alt`, `Title`, `TestId` | by placeholder, alt text, title, test id | `getBy…` |

Names match exactly. `Containing "Eggs"` matches a case-insensitive substring instead, which
is handy for rows. `Within` (or `In`) searches inside another element:

```gherkin
When I Click the Button "Remove" Within the Row Containing "Kale"
```

### Doing things

`Visit "/path"`, `Reload`, `Back`, `Click`, `Double-click`, `Hover`, `Focus`, `Check`,
`Uncheck`, `Clear`, `Fill`, `Type`, `Select`, `Press "Enter"`.

`Fill`, `Type` and `Select` take an element and some text in either order, so
`Fill the Field "Email" with "a@b"` and `Fill "a@b" into the Field "Email"` both work. Given
a data table, `Fill` fills each label with its value:

```gherkin
When I Fill in the form:
  | Email    | will@example.com |
  | Password | hunter2          |
```

### Checking things

`See` an element, or `See "some text"` anywhere on the page. Or say what an element should
be: `Visible`, `Hidden`, `Checked`, `Enabled`, `Disabled`, `Focused`, `Empty`, `Value "…"`,
`Read "…"` (exact text) or `Contain "…"`. For the page itself, `At "/path"` and
`Titled "…"`. `Not` negates any of them.

```gherkin
Then the Checkbox "Terms" should be Checked
And I should Not See the Button "Delete"
And I should be At "/dashboard"
```

Checks retry until they pass or time out, like Playwright's `expect`.

### Everything else

`Define`, `Print`, and `I`, which does nothing, so "Given I Visit…" reads naturally.

## Defines

A Define takes a name after its colon and an indented body under it, like `Feature:` and
`Scenario:`. After the name come the kinds of things it takes: `Text`, `Number`, `Element`,
`Table` or `Any`. In the body, each is called by its kind, or by the name in brackets after
it: `Text (Item)` is some text called `Item`. Two of the same kind need names, as in
`Define: Move Element (Source) to Element (Target)`. Lowercase words are prose here too.

Defines go above the `Feature:` line, or in a `.spp` file with no Feature at all. Every file
in the project can use them.

### Nouns

A Define that leaves one thing, like an element or some text, is a noun. Its name becomes a
kind of its own, which other Defines can take:

```gherkin
Define: Cart
  the Region "Shopping cart"

Define: Add Text (Item) to Cart
  Fill Item into the Field "Item" Within Cart
```

`When I Add "Milk" to the Cart` works. `Add "Milk" to the Region "Shopping cart"` is a
mistake, even though it's the same region, because `Add` takes a Cart. A Cart is still an
element, so `Click the Cart` and `the Cart should be Visible` work too.

### Overloads

A word can have several Defines, told apart by what they take:

```gherkin
Define: Add Text (Item) to Cart
  Fill Item into the Field "Item" Within Cart

Define: Add Text (Email) to Settings
  Fill Email into the Field "Email" Within Settings
```

`Add "Milk" to the Cart` runs the first and `Add "a@b" to the Settings` the second. When
more than one fits, the one that takes more wins, then the one with narrower kinds: a Cart
before an Element, anything before `Any`. Two Defines that could always both fit are a
mistake, reported where they're defined, so a step never has to guess. A noun can only have
one Define, since its name is a kind.

## Checking

Every word has a type: what it takes and what it leaves.

```
Button  : Text | Pattern -> Element
Click   : Element ->
Checked : -> Matcher
```

A scenario with a mistake fails straight away, without starting a browser. The types of your
own Defines are inferred from their bodies: `Add Text (Item)` passes `Item` to
`Fill … with`, so `When I Add the Button "Milk"` is a mistake. A Define with a mistake of
its own fails as a test of its own.

Step keywords are words too. Each step is a block with its own stack, and its keyword runs
it. `Given`, `When` and `Then` take the step and leave their mode for the next one. `And` and
`But` take the mode from the step above, so a scenario can't start with `And`:

```
Given : Step -> Mode
And   : Step, Mode -> Mode
```

## Running

### Config

```ts
defineSppConfig({
  features: ['features'],       // where the .spp files are; by default, everywhere
  ignore: ['features/drafts'],  // files and directories to leave out
})
```

Paths are relative to the config file. Each time Playwright loads its config,
`defineSppConfig` writes a small test file per `.spp` file into `.spp-tests` and returns the
`testDir` and `testMatch` that find them. The files only list the scenarios. What a scenario
does is read from its `.spp` file when it runs, so they can't go out of date.

`defineSppConfig` works out its directory from the file that called it. If you call it from
a helper in another file, pass `root`.

### Projects

Every Define in a project can be used by all of its files. For sets of features with their
own words, give each Playwright project its own `defineSppConfig` and `outputDir`:

```ts
projects: [
  { name: 'shop', ...defineSppConfig({ features: ['shop'], outputDir: '.spp-tests/shop' }) },
  { name: 'admin', ...defineSppConfig({ features: ['admin'], outputDir: '.spp-tests/admin' }) },
],
```

`spp-lang` finds the config by looking up from the current directory, so `check`,
`dictionary` and the language server load the same files from anywhere in the project.

### `spp-lang test`

```
npx spp-lang test [paths...] [--base-url <url>] [playwright test options...]
```

This runs `playwright test` with your config. Without one, it runs every `.spp` file, and
every Markdown file with a ` ```spp ` block, under the current directory. A path can be a
directory, a file, or a file and a line: the line of a scenario or of one of its steps.
Other options, like `--headed` or `--grep @smoke`, go to Playwright. `--base-url` and
`$SPP_BASE_URL` override the config's `baseURL`.

### Tags

Gherkin tags become Playwright tags. `@skip`, `@fixme`, `@fail`, `@slow` and `@only` do what
they do in Playwright.

## Markdown

A block with a `Feature:` line starts a Feature. A block that starts with a `Scenario:` or a
step carries on the Feature above it, so prose can sit between scenarios:

````markdown
Signing in takes an email and a password.

```spp
Feature: Signing in

  Scenario: The right password
    Given I Visit "/"
    ...
```

With the wrong password, you stay where you are:

```spp
  Scenario: The wrong password
    ...
```
````

Any other block holds Defines, as does anything above a block's `Feature:` line, and every
file can use them. ` ```spp ignore ` shows an example without loading it. Only Markdown files
with a ` ```spp ` block are part of the project. `spp-lang test README.md:12` runs the
scenario on line 12, and mistakes point at lines in the Markdown file.

## Editors

The language server shows mistakes as you type and a word's type on hover. It goes to a
word's Define, finds everywhere a word is used, lists a file's Defines and scenarios, and
completes words with the ones that fit first: after `Click the`, it offers elements. It also
marks which words are code, so they stand out from the prose. All of this works in Markdown
` ```spp ` blocks too.

The VS Code extension ships its own copy of the server but uses your project's
`node_modules/spp-lang` when there is one. For running and debugging scenarios, add
[Playwright's extension](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright),
which puts run and debug buttons beside every scenario and shows failures at the step that
failed.
