# TodoMVC

Playwright's demo TodoMVC spec, in Spec++, as a test of the language's design.

- [`demo-todo-app.spec.ts`](demo-todo-app.spec.ts): the original. It was in
  [create-playwright](https://github.com/microsoft/create-playwright) until September 2025
  (MIT, © Microsoft). It's kept for comparison and isn't run.
- [`features`](features): the same tests in Spec++, one file per `describe` block.
- [`app`](app): the React TodoMVC served at
  [demo.playwright.dev/todomvc](https://demo.playwright.dev/todomvc), vendored so the
  tests don't need the network. It's from [TodoMVC](https://todomvc.com) (MIT, © TasteJS),
  with React, director and the rest under their own MIT licenses, as noted in the bundles.
- [`todo.md`](todo.md): what Spec++ couldn't say, and what the features do instead.

It's a project of its own, with its own [`playwright.config.ts`](playwright.config.ts), so run it
from here:

```sh
npx playwright test
```

`npm run test:e2e` from the repo's root runs it too.
