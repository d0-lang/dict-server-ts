import { loadConfig } from "./config.ts"
import { makeWebHandler } from "./http/app.ts"

const { handler } = makeWebHandler()
const { port } = loadConfig()

Bun.serve({
  port,
  fetch: (request) => handler(request)
})

console.log(`dict server listening on http://localhost:${port}`)
