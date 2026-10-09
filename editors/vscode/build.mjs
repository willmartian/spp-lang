// Bundles the extension and Spec++'s language server, each into one file, so
// the extension needs nothing installed to work.
import { build } from 'esbuild'

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', sourcemap: true, logLevel: 'warning' }

await Promise.all([
  build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js', external: ['vscode'] }),
  build({ ...common, entryPoints: ['src/server.ts'], outfile: 'out/server.js' }),
])
