// Serves examples/todomvc/app on http://localhost:4174 (or $PORT).

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const root = path.join(import.meta.dirname, 'app')
const port = Number(process.env.PORT ?? 4174)
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const file = path.join(root, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
    if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end('not found')
    res
      .writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
      .end(fs.readFileSync(file))
  })
  .listen(port, () => console.log(`TodoMVC on http://localhost:${port}`))
