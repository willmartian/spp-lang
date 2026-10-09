# Spec++ for Claude Code

A Claude Code plugin that helps Claude write `.spp` files. It has two parts.

**A skill, `writing-spp`,** which Claude uses when it writes or edits `.spp` files. It
teaches Claude:

- the language's rules
- to read `spp-lang dictionary` first, so it uses your project's own words
- to run `spp-lang check` after every edit, and fix what it reports

**The language server, `spp-lang lsp`.** After Claude edits a `.spp` file, or a Markdown file
with ` ```spp ` blocks, Claude Code hands it the mistakes the server finds, without Claude
running anything. Claude's `LSP` tool can also use the server to show a word's type, go to its
`Define`, find everywhere it's used, and list or search the project's `Define`s and scenarios.

Both come from your project's own `spp-lang`, so install that first
(`npm install --save-dev spp-lang`). The language server runs through `npx`, from the
directory Claude Code was started in.

## Installing

This repository is a plugin marketplace:

```sh
claude plugin marketplace add willmartian/spp-lang
claude plugin install spp-lang@spp-lang
```

To install from a clone instead, give `marketplace add` its path, like
`./path/to/spp-lang`.

To try it without installing, start Claude Code with the plugin loaded:

```sh
claude --plugin-dir ./path/to/spp-lang/editors/claude
```

Claude uses the skill when it's working on `.spp` files. You can also run it yourself as
`/spp-lang:writing-spp`.

## Limits

- The language server starts on Claude's first edit to a `.spp` file. That edit's mistakes,
  and sometimes a later edit's, reach Claude on its next step rather than straight away.
  The skill's `spp-lang check` covers the gap.
- Claude Code doesn't start plugin language servers in cloud sessions, so there Claude has
  only the skill.
- If `spp-lang` isn't installed in the project, the server fails to start and the session
  carries on without it. `npx --no-install` won't install it for you. `claude --debug` logs
  why the server failed.
