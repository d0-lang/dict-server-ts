Default to Bun for install, run, and TypeScript. Use Effect 4 APIs from the `effect` package — HTTP and Schema live there, not in the old `@effect/platform` HTTP stack.

The protocol the server implements is `../protocol/PROTOCOL.md` ([d0-lang/protocol](https://github.com/d0-lang/protocol/blob/main/PROTOCOL.md)).

## Layout

Bun workspaces: `apps/server` (`@dict/server`), `apps/importer` (`@dict/importer`), `packages/core` (`@dict/core`, the dictionary file format both share). The importer and the server import each other only through `@dict/core` (the server's tests may use the importer); `boundaries.test.ts` enforces it. Per-language data lives in `languages/<lang>/`: a language's settings go in its `language.toml`, not in TypeScript constants. After changing the `Language` schema (`packages/core/src/language.ts`), run `bun run spec`.

## Bun

- `bun <file>` instead of `node`
- `bun install` instead of npm/yarn/pnpm
- `bun run dev` (`bun --hot apps/server/src/index.ts`) for the HTTP server; run every script from the repo root
- Bun loads `.env` automatically

Do not add Express or Hono. Serve with `HttpRouter.toWebHandler` + `Bun.serve`.

## Effect 4

Read the docs shipped with the installed package before inventing APIs (installs are per workspace, so the package is under `apps/server/node_modules/effect/`):

- `apps/server/node_modules/effect/AGENTS.md` — coding style (`Effect.fn`, services, Layers, Schema)
- `apps/server/node_modules/effect/ai-docs/src/51_http-server/` — HttpApi, handlers, `toWebHandler`, `HttpApiTest`
- `apps/server/node_modules/effect/ai-docs/src/09_testing/` — `@effect/vitest`

Prefer `effect/unstable/httpapi` and `effect/unstable/http`. Sign `/v1/get-meta` over the **exact JSON body bytes** (do not re-serialize after signing).

## Tests

Use Vitest + `@effect/vitest` (`it.effect`, `layer(...)`, `HttpApiTest`), not `bun:test`.

Lookup code is split by feature (`apps/server/src/lookup/features/`), not by language; a language turns features on in its `language.toml`. A language with an analyzer (`context.analyzer`) takes the analyzer's path (`features/analyzedWords/`), every other language the spaced-language features; `paths.test.ts` keeps the two from importing each other. Tests sit next to their feature, one file per language where the cases are language-specific (`phrases.ru.test.ts`), on the in-memory dictionaries in `apps/server/src/lookup/testing/<language>.ts`.

```sh
bun run test
```

## Issues and PRs

Issues and PRs follow the templates in `.github/` (`ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`; `PULL_REQUEST_TEMPLATE/language.md` for a language) and stay as short as the template.
