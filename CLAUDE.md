Default to Bun for install, run, and TypeScript. Use Effect 4 APIs from the `effect` package — HTTP and Schema live there, not in the old `@effect/platform` HTTP stack.

## Bun

- `bun <file>` instead of `node`
- `bun install` instead of npm/yarn/pnpm
- `bun --hot src/index.ts` for the HTTP server
- Bun loads `.env` automatically

Do not add Express or Hono. Serve with `HttpRouter.toWebHandler` + `Bun.serve`.

## Effect 4

Read the docs shipped with the installed package before inventing APIs:

- `node_modules/effect/AGENTS.md` — coding style (`Effect.fn`, services, Layers, Schema)
- `node_modules/effect/ai-docs/src/51_http-server/` — HttpApi, handlers, `toWebHandler`, `HttpApiTest`
- `node_modules/effect/ai-docs/src/09_testing/` — `@effect/vitest`

Prefer `effect/unstable/httpapi` and `effect/unstable/http`. Sign `/v1/get-meta` over the **exact JSON body bytes** (do not re-serialize after signing).

## Tests

Use Vitest + `@effect/vitest` (`it.effect`, `layer(...)`, `HttpApiTest`), not `bun:test`.

```sh
bun run test
```
