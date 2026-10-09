# Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), checked by
commitlint. Code is formatted and linted with Biome (`npm run format`).

## Setup

Run everything inside `nix develop`. Playwright's Chromium needs libraries NixOS doesn't
have by default.

```sh
nix develop
npm install
npx playwright install chromium
npm run typecheck
npm test             # the language, no browser
npm run test:e2e     # examples/demo and examples/todomvc against their apps, plus test/fixtures, which must all fail
```

## The VS Code extension

The extension is its own package:

```sh
cd editors/vscode
npm install
xvfb-run -a npm test # opens VS Code on a scratch workspace and uses the extension
npm run package      # builds spp-vscode-0.1.0.vsix
```

To try it by hand, use Run and Debug → **Run Spec++ extension**, which opens a second window
on this repo with the extension loaded. Its language server runs from source on Node, through
`scripts/nix-node`. For Playwright's extension to run scenarios on NixOS, start VS Code from
the dev shell (`nix develop -c code .`) so Chromium finds its libraries.
