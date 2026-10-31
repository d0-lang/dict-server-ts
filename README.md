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

## Dictionary import

Lookups are served from one SQLite file per language pair (`data/pl_en.sqlite` is Polish lemmas with English glosses). The file is built from the raw English Wiktionary wiktextract dump ([kaikki.org/dictionary/rawdata.html](https://kaikki.org/dictionary/rawdata.html), `raw-wiktextract-data.jsonl.gz`). Per-language Kaikki files are not used.

`bun run import -- --help` lists the commands. `import` streams the dump (gzip included), keeps one language, and writes SQLite. `filter` copies that language's JSONL lines out of a multi-language dump so a later import can read a local file.

```bash
# Stream the raw dump straight into data/pl_en.sqlite
bun run import -- import --lang pl --input /path/to/raw-wiktextract-data.jsonl.gz

# Or cut Polish out first, then import the smaller file
bun run import -- filter --lang pl \
  --input /path/to/raw-wiktextract-data.jsonl.gz \
  --output data/pl.jsonl
bun run import -- import --lang pl --input data/pl.jsonl --output data/pl_en.sqlite
```

Inflected forms are indexed on the lemma entry. Pages that are only "form of …" or "alternative form of …" are not stored as entries; they add a form row when the lemma's own forms list missed that inflection. Archaic and obsolete senses are dropped. For Polish, a sense is also dropped when its tags are the pair Middle + Polish (Wiktionary's Middle Polish label). The category of that name is left alone, because living entries such as mapa carry it too. The lookup HTTP API is not part of this import.
