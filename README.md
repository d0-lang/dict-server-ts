# server

Bun + Effect 4 dictionary protocol PoC.

```bash
bun install
cp .env.example .env   # already gitignored; Bun loads it automatically
bun run dev
```

Settings live in `.env` (`PORT`, `SERVER_NAME`, `LANGUAGES`, `INCLUDE_LEGAL`, legal copy/links, `VERIFICATION_URLS`, `IDENTITY_FILE`). See `.env.example`.

Ed25519 identity is stored at `IDENTITY_FILE` (default `data/identity.json`, gitignored). A rebuild/restart reloads that file instead of minting a new key.

- `GET /v1/get-key` — unsigned Ed25519 public key (base64)
- `GET /v1/get-meta` — signed metadata (`X-Nonce` required, `X-Signature` over exact body bytes)
- `GET /v1/lookup?payload=<url-encoded JSON>` — stub translation

```bash
bun run test
```

`bun run test` runs Vitest inside Bun (`bun --bun`), because the dictionary code uses `bun:sqlite`.

## Importing a dictionary

Each language pair is one SQLite file, `data/<lang>_en.sqlite` (e.g. `data/pl_en.sqlite`), built from the [wiktextract](https://github.com/tatuylonen/wiktextract) extract of the English Wiktionary published on [kaikki.org](https://kaikki.org/dictionary/rawdata.html). All files share one schema (`src/dictionary/schema.ts`); the server opens one Drizzle instance per file.

```bash
# stream the raw all-language dump (~3 GB .gz) straight from kaikki.org, keep Polish
bun run import --lang pl

# or use a local copy: the raw dump, or a JSONL already filtered to one language, plain or .gz
curl -LO https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz
bun run import --lang pl --input raw-wiktextract-data.jsonl.gz --out data/pl_en.sqlite
```

Flags: `--lang` (default `pl`; rules per language in `src/importer/transform/languages.ts`), `--input` (path or URL, default the raw dump URL), `--out` (default `data/<lang>_en.sqlite`), `--no-form-of-fallback`, `--limit <n>` (stop after n lines of the language, for samples). The file is built as `<out>.tmp` and renamed when the import succeeds, so a running server never sees a half-written file. A JSON summary (counts, size, time) is printed at the end.

For Polish, a run over the full local dump takes about 70 s (about 10 s from a pre-filtered `pl` JSONL) and produces a ~39 MB file.

What gets imported:

- one entry per word + etymology + part of speech (wiktextract lines that repeat that key are merged); `pos` is mapped to a Universal Dependencies tag, `X` if unknown
- senses: the most specific gloss of each sense; archaic senses and the language's historical stages (Middle/Old Polish) are skipped
- pronunciation: standard IPA (regional variants only when nothing else exists) and `upload.wikimedia.org` audio URLs
- `forms`: every form from the lemma's inflection table plus the lemma itself, normalized (NFC, lowercase, diacritics kept); template rows, multi-word analytic forms and related words (diminutives, aspect partners, ...) are dropped. The `(form, entry_id)` primary key deduplicates
- form-of / alt-of entries ("domu: genitive singular of dom") never become entries; they add `form -> lemma` rows when the lemma exists and the form was missing from its table (turn off with `--no-form-of-fallback`)

Bump `SCHEMA_VERSION` in `src/dictionary/schema.ts` when the schema changes; it is stored as `PRAGMA user_version`, and `openDictionary` refuses files built for another version.
