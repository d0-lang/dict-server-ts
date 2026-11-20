# Development

How the repo is laid out, how to run the server from source, and what it serves. Run every script from the repo root.

## Layout

| Path | What |
|---|---|
| `apps/server` (`@dict/server`) | the HTTP API, lookups, sentence context, compound splitting; `eval/` holds the context and segments benchmarks |
| `apps/importer` (`@dict/importer`) | builds `data/<pair>.sqlite` from a wiktextract dump |
| `packages/core` (`@dict/core`) | the dictionary file format both share: schema, `lookupKey`, opening and creating files |
| `spec/` | what any implementation needs as data: the dictionary file format (`dictionary/`: `schema.sql`, `format.json`, `lookupKey` test vectors) and the language record's JSON Schema (`language.schema.json`, written by `bun run spec`) |
| `languages/<lang>/` | per-language data: `language.toml` (the importer's and the server's settings; keys in `spec/language.schema.json`), `grammar.tsv`, what its labels mean (`labels.toml`), the profile (`profile.md`), benchmark gold data. `languages/labels.<target>.toml` names the labels every language shares |
| `data/` | dictionary files, raw dumps and the identity key (gitignored) |

The importer and the server only share `@dict/core`; `boundaries.test.ts` fails on any other import between them (the server's tests may use the importer to build dictionaries). Run every script from the repo root: `data/` and `.env` are read from the working directory.

## Running from source

```bash
bun install
cp .env.example .env   # already gitignored; Bun loads it automatically
bun run dev
```

## Settings

Settings live in `.env` (`PORT`, `SERVER_NAME`, `LANGUAGES`, `INCLUDE_LEGAL`, `CONTEXT`, the legal documents and links, `VERIFICATION_URLS`, `REPORT_URL`, `IDENTITY_FILE`). See `.env.example`.

## The key

Ed25519 identity is stored at `IDENTITY_FILE` (default `data/identity.json`, gitignored). A rebuild/restart reloads that file instead of minting a new key.

## Endpoints

- `GET /v1/get-key` — unsigned Ed25519 public key (base64)
- `GET /v1/get-meta` — signed metadata (`X-Nonce` required, `X-Signature` over exact body bytes); lists `"features": ["context", "context-match", "labels"]` (the first two unless `CONTEXT=false`) and `sources`, and `report_url` when `REPORT_URL` is set: the page where users report a wrong or missing answer, e.g. `https://github.com/d0-lang/dict-server-ts/issues/new?template=word.yml`. A client adds `word`, `lang` and `client` as query parameters, so the page should read them; the server refuses to start when it is set and is not an absolute `https` URL
- `GET /v1/get-labels?lang=<pair>[,<pair>...]` — what the labels each served pair can show mean (`{"labels": {"ru_en": {"pf": {"name": "perfective", "text": "..."}}}}`), unsigned; `features` lists `"labels"`. The server reads which label strings a pair's entries have at startup (`apps/server/src/lookup/labels.ts`), and names each from `languages/<lang>/labels.toml`, then `languages/labels.<target>.toml`; a combination none lists (`m/f`) is named by its parts
- `POST /v1/lookup` with a JSON body, `{"word": "<word>", "lang": "<pair>"[, "context": "<sentence>", "at": <n>]}` — entries from `data/<pair>.sqlite`, and `segments` for a split compound. Without `LANGUAGES`, every `data/<pair>.sqlite` is served; a pair listed in `LANGUAGES` needs its file: build it first, see below

## Logs

The server writes one log line per request: the time, the method, the path without its query string, and the status (Effect's request logger, which `HttpRouter.toWebHandler` adds; no IP address). `LOG_REQUESTS=false` turns that logger off: the server then logs only a request it failed (a 5xx), with the cause, alongside its start-up lines. A lookup's `word` and `context` travel in the request body, which neither this log nor a web server or proxy in front writes by default. No tracer is set up; if you add one, keep request bodies out of it. An unknown route gets a plain 404, so its query string stays out of the log too: that covers a client that still sends lookups as GET. A web server or proxy in front does log the full address of such a request by default, and Docker keeps the server's lines without limit unless log rotation is set.

## Tests

```bash
bun run test
```

`bun run test` runs Vitest inside Bun (`bun --bun`), because the dictionary code uses `bun:sqlite`.

## Docker

`compose.yaml` runs a published image: a one-shot `dictionaries` service downloads the `.sqlite` files of the image's release into a volume and checks them against its `SHA256SUMS` (`apps/server/src/fetchDictionaries.ts`), then the server starts on them. Each release attaches a copy pinned to its image, so the newest is always at `https://github.com/d0-lang/dict-server-ts/releases/latest/download/compose.yaml`. Settings go in `.env` next to it; `DICT_PORT` changes the port (default 3000). To try an image built from this checkout:

```bash
docker build --build-arg VERSION=v0.1.0-rc.3 --tag ghcr.io/d0-lang/dict-server-ts:local .
DICT_VERSION=local docker compose up
```

`VERSION` is the release whose dictionaries it downloads.

## Legal texts

`legal/privacy.example.md` and `legal/terms.example.md` are templates of the privacy policy and terms for anyone who runs a public server; `legal/README.md` says what to fill in and what your setup has to do for the texts to be true (proxy logs, log rotation, CDN, other sources). `INCLUDE_LEGAL` is off by default, so clients treat the server as a test server. Turned on, the templates and `example.invalid` links stand in for the documents (`PRIVACY_FILE`, `TOS_FILE`, `PRIVACY_LINK`, `TOS_LINK`), which is enough to try the legal flow. For a public server, copy the templates outside git, fill them in, and point `PRIVACY_FILE` and `TOS_FILE` at the copies (in Docker, mount them into the container). The server publishes them itself: with `INCLUDE_LEGAL` on, `/privacy` and `/terms` show each file as a web page, so `PRIVACY_LINK` and `TOS_LINK` can be `https://<your server>/privacy` and `https://<your server>/terms`. Publish them elsewhere only if you keep that copy identical to the files. `/v1/get-meta` sends the sha256 of each file as `privacy_hash` and `tos_hash`, so any edit makes clients pause lookups until the user has seen the notice; `PRIVACY_CHANGE` and `TOS_CHANGE` (at most 500 characters) summarise the change. The server refuses to start when a document can't be read, and warns while one still has `[[...]]` placeholders.
