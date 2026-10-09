# Spec++ for VS Code

Support for Spec++'s `.spp` files: Gherkin you can run, with no step definitions. The
` ```spp ` blocks in Markdown files get the same, and are highlighted as Spec++.

The language, how to run it with Playwright, and this extension's source are in the
[spp-lang repository](https://github.com/willmartian/spp-lang).

- Mistakes show up as you type, before any test runs.
- Hover a word to see its type. For your own `Define`d words, the type is worked out from
  how they're used.
- Go to definition goes from a word to its `Define`.
- Completion offers the words that fit first: after `Click the`, things on the page.
- The capitalised words that are code are highlighted apart from the prose.
- Running and debugging come from [Playwright's own extension](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright).
  Spec++'s generated tests map back to the `.spp` files, so it puts run and debug buttons beside
  every scenario, lists them in the Test Explorer, and shows failures at the step that failed.

## Which spp-lang

The language server comes from your workspace's own `node_modules/spp-lang` when it has one, so
the editor agrees with your tests. Otherwise the extension uses the one it ships with. In an
untrusted workspace it always uses its own, and doesn't load your `playwright.config`.

The `defineSppConfig` calls in your `playwright.config` say which files make up each project.
Each project is checked on its own, so two can `Define` the same word.

## Settings

- `spp.path`: an spp-lang to use instead, as the path to its `bin/spp-lang.js`.
- `spp.node`: the Node.js to run your workspace's spp-lang with. The default is `node`. It can be a
  path, relative to the workspace folder, to a script that sets up the environment first.
