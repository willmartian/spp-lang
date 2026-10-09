---
name: writing-spp
description: Write, fix or review Spec++ (.spp) files, the runnable Gherkin where capitalised words are code and there are no step definitions. Use when creating or editing a .spp file or a Markdown file's ```spp blocks, adding scenarios or Defines, or when `spp-lang check` reports a mistake.
---

# Writing Spec++

A `.spp` file is Gherkin whose steps run as they're written. There are no step definitions:
every step is code in a small stack language, and the prose around the code is ignored.

```gherkin
Feature: Signing in

  Scenario: The right password
    Given I Visit "/"
    When I Fill the Field "Email" with "will@example.com"
    And I Click the Button "Sign in"
    Then I should See the Heading "Welcome back"
```

## Before writing: read the dictionary

Run this from the project root before writing any steps:

```sh
npx spp-lang dictionary
```

It lists every word the project's `.spp` files can use, both built-in words and the
project's own `Define`s, with what each takes and leaves. It comes from the same
declarations the checker uses, so it's always current. Use only words that it lists or that
you `Define`. Don't invent words, and reuse the project's `Define`s instead of repeating
their steps.

## The rules

- **Case decides what runs.** Capitalised words are code. Lowercase words are prose, there
  only for people: `the`, `with`, `should`, `to the list`. `"Quoted text"` and numbers are
  values.
- **Code runs right to left.** In `Click the Button "Sign in"`, `"Sign in"` comes first,
  `Button` turns it into the button with that accessible name, and `Click` clicks it. So a
  verb comes before the thing it acts on, as in English.
- **A step has to use everything it makes.** A step that only finds something, like
  `When the Button "Add"`, is a mistake. Any value left over at the end of the step has to
  be a check.
- **`I` does nothing.** It's there so that `Given I Visit "/"` reads naturally.
- **Find things the way a user does**: by role and accessible name (`Button`, `Heading`,
  `Checkbox`, `Row`…), label (`Field`), text (`Text`), and so on. Don't use CSS selectors;
  there's no way to write one.
- **Names match exactly.** `Containing "Kale"` matches a case-insensitive substring instead.
  `Within` (or `In`) looks inside something else:
  `Click the Button "Remove" Within the Row Containing "Kale"`.
- **Checks read like English.** Use `See` a thing or `See "some text"`, or put what the
  thing should be after it: `the Checkbox "Terms" should be Checked`. `Not` flips any
  check: `I should Not See "Kale"`. Checks retry until they pass or time out.
- **A step's data table or doc string acts as if it were written at the end of the step.**
  Write `When I Fill in the form:` with a `| label | value |` table, or
  `When I Fill the Field "Notes" with:` with a doc string.

## Your own words

`Define` makes a new word. Write it above the `Feature:` line, or in a `.spp` file with no
Feature at all, such as `features/words.spp`. Every file can use it. Like `Feature:`, the
name goes after the colon, and the body is indented under it, one statement per line:

```gherkin
# Add "Milk": Add takes some text, called Item in its body.
Define: Add Text (Item)
  Fill the Field "Item" with Item
  Click the Button "Add"

Define: Signed-in
  Visit "/"
  Fill the Field "Email" with "will@example.com"
  Fill the Field "Password" with "hunter2"
  Click the Button "Sign in"
```

- After the name come the kinds it takes: `Text`, `Number`, `Element`, `Table` or
  `Any`, in the order the caller writes them. In the body, each is called by its kind, or
  by the name in `( )` after it. `Text` is also a query word, so always name it, as in
  `Text (Item)`. Two of the same kind need names: `Element (Source) to Element (Target)`.
- A Define takes only what its header lists, and nothing with nothing after its name.
- A Define that leaves one thing is a noun, and its name is a kind: after
  `Define: Cart` with `the Region "Shopping cart"` in its body, another Define can take
  `Cart`, and is then only given a Cart. A Cart still works anywhere something on the page
  does. Name the parts of the app a spec talks about this way.
- A word can have several Defines if they take different things: `Add Text (Item) to Cart`
  and `Add Text (Email) to Settings` are two `Add`s, and each step runs the one that fits.
  Prefer this to inventing verbs like `Add-to-cart`. Two Defines that could always both fit
  are a mistake.
- There are no variables in scenarios. Write values out in each step, or use a Scenario
  Outline when they vary.
- The dictionary shows what each Define takes.

Prefer one clear word for a repeated sequence of steps, like `Signed-in` for signing in in
a Background, over copying the steps into every scenario.

## Gherkin

Feature, Background, Scenario, Scenario Outline with Examples, and Rule all work as they do
in Cucumber. Tags become Playwright tags. `@skip`, `@fixme`, `@fail`, `@slow` and `@only`
do what they do in Playwright. In an Outline, put a placeholder inside quotes to use it as a
value: `Fill the Field "<field>" with "something"`.

## Pitfalls

- **Capitalised prose.** A person's name, a day or any other capitalised English word is
  read as code, and is an unknown word. Put it in quotes if it's a value, or write it in
  lowercase.
- **Numbers in prose.** `Click the Button "Add" 3 times` leaves an unused `3`. Numbers are
  values, so keep them out of the prose.
- **Lowercase verbs.** `When I click the Button "Add"` doesn't click anything: `click` is
  prose. The checker reports that the button is unused.
- **One statement per line.** There's no `;`, and blocks use a colon and an indented body,
  not `( )`.

## After every edit: check

```sh
npx spp-lang check
```

It checks every step, types included, without starting a browser, and exits non-zero on a
mistake. Each message says which word is wrong and often suggests a fix, like "Did you mean
Click?". Fix every mistake and run it again until it reports none. The plugin's language server
may also show you mistakes after an edit. Fix those the same way, but still run `check`,
since the server's report can arrive late.

Before changing or renaming a `Define`, use the `LSP` tool's find references on it to see
everywhere it's used. To run the scenarios in
a browser, use `npx spp-lang test [paths...]`, which runs Playwright with the project's
`playwright.config`; add `--base-url <url>` if it has none. A path can be a file and a line,
like `features/cart.spp:12`, to run one scenario, or the scenario a step is in.
