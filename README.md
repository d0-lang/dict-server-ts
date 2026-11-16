# server

Bun + Effect 4 dictionary protocol PoC: the HTTP server and the importer that builds its dictionaries, as Bun workspaces. The protocol is [d0-lang/protocol](https://github.com/d0-lang/protocol).

| Path | What |
|---|---|
| `apps/server` (`@dict/server`) | the HTTP API, lookups, sentence context, compound splitting; `eval/` holds the context and segments benchmarks |
| `apps/importer` (`@dict/importer`) | builds `data/<pair>.sqlite` from a wiktextract dump |
| `packages/core` (`@dict/core`) | the dictionary file format both share: schema, `lookupKey`, opening and creating files |
| `spec/` | what any implementation needs as data: the dictionary file format (`dictionary/`: `schema.sql`, `format.json`, `lookupKey` test vectors) and the language record's JSON Schema (`language.schema.json`, written by `bun run spec`) |
| `languages/<lang>/` | per-language data: `language.toml` (the importer's and the server's settings; keys in `spec/language.schema.json`), `grammar.tsv`, what its labels mean (`labels.toml`), the profile (`profile.md`), benchmark gold data. `languages/labels.<target>.toml` names the labels every language shares |
| `data/` | dictionary files, raw dumps and the identity key (gitignored) |

The importer and the server only share `@dict/core`; `boundaries.test.ts` fails on any other import between them (the server's tests may use the importer to build dictionaries). Run every script from the repo root: `data/` and `.env` are read from the working directory.

```bash
bun install
cp .env.example .env   # already gitignored; Bun loads it automatically
bun run dev
```

Settings live in `.env` (`PORT`, `SERVER_NAME`, `LANGUAGES`, `INCLUDE_LEGAL`, `CONTEXT`, the legal documents and links, `VERIFICATION_URLS`, `REPORT_URL`, `IDENTITY_FILE`). See `.env.example`.

Ed25519 identity is stored at `IDENTITY_FILE` (default `data/identity.json`, gitignored). A rebuild/restart reloads that file instead of minting a new key.

- `GET /v1/get-key` — unsigned Ed25519 public key (base64)
- `GET /v1/get-meta` — signed metadata (`X-Nonce` required, `X-Signature` over exact body bytes); lists `"features": ["context", "context-match", "labels"]` (the first two unless `CONTEXT=false`) and `sources`, and `report_url` when `REPORT_URL` is set: the page where users report a wrong or missing answer, e.g. `https://github.com/d0-lang/dict-server-ts/issues/new?template=word.yml`. A client adds `word`, `lang` and `client` as query parameters, so the page should read them; the server refuses to start when it is set and is not an absolute `https` URL
- `GET /v1/get-labels?lang=<pair>[,<pair>...]` — what the labels each served pair can show mean (`{"labels": {"ru_en": {"pf": {"name": "perfective", "text": "..."}}}}`), unsigned; `features` lists `"labels"`. The server reads which label strings a pair's entries have at startup (`apps/server/src/lookup/labels.ts`), and names each from `languages/<lang>/labels.toml`, then `languages/labels.<target>.toml`; a combination none lists (`m/f`) is named by its parts
- `POST /v1/lookup` with a JSON body, `{"word": "<word>", "lang": "<pair>"[, "context": "<sentence>", "at": <n>]}` — entries from `data/<pair>.sqlite`, and `segments` for a split compound. Without `LANGUAGES`, every `data/<pair>.sqlite` is served; a pair listed in `LANGUAGES` needs its file: build it first, see below

The server writes one log line per request: the time, the method, the path without its query string, and the status (Effect's request logger, which `HttpRouter.toWebHandler` adds; no IP address). A lookup's `word` and `context` travel in the request body, which neither this log nor a web server or proxy in front writes by default. No tracer is set up; if you add one, keep request bodies out of it. An unknown route gets a plain 404, so its query string stays out of the log too: that covers a client that still sends lookups as GET. A web server or proxy in front does log the full address of such a request by default, and Docker keeps the server's lines without limit unless log rotation is set.

## Legal texts

`legal/privacy.example.md` and `legal/terms.example.md` are templates of the privacy policy and terms for anyone who runs a public server; `legal/README.md` says what to fill in and what your setup has to do for the texts to be true (proxy logs, log rotation, CDN, other sources). `INCLUDE_LEGAL` is off by default, so clients treat the server as a test server. Turned on, the templates and `example.invalid` links stand in for the documents (`PRIVACY_FILE`, `TOS_FILE`, `PRIVACY_LINK`, `TOS_LINK`), which is enough to try the legal flow. For a public server, copy the templates outside git, fill them in, publish them at `PRIVACY_LINK` and `TOS_LINK`, and point `PRIVACY_FILE` and `TOS_FILE` at the copies (in Docker, mount them into the container). `/v1/get-meta` sends the sha256 of each file as `privacy_hash` and `tos_hash`, so any edit makes clients pause lookups until the user has seen the notice; `PRIVACY_CHANGE` and `TOS_CHANGE` (at most 500 characters) summarise the change. The server refuses to start when a document can't be read, and warns while one still has `[[...]]` placeholders.

```bash
bun run test
```

`bun run test` runs Vitest inside Bun (`bun --bun`), because the dictionary code uses `bun:sqlite`.

## Importing a dictionary

Each language pair is one SQLite file, `data/<lang>_en.sqlite` (e.g. `data/pl_en.sqlite`), built from the [wiktextract](https://github.com/tatuylonen/wiktextract) extract of the English Wiktionary published on [kaikki.org](https://kaikki.org/dictionary/rawdata.html). All files share one schema (`packages/core/src/schema.ts`); the server opens one Drizzle instance per file.

```bash
# stream the raw all-language dump (~3 GB .gz) straight from kaikki.org, keep Polish
bun run import --lang pl

# or use a local copy: the raw dump, or a JSONL already filtered to one language, plain or .gz
curl -LO https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz
bun run import --lang pl --input raw-wiktextract-data.jsonl.gz --out data/pl_en.sqlite
```

Flags: `--lang` (default `pl`; a language needs `languages/<lang>/language.toml`), `--input` (path or URL, default the raw dump URL), `--out` (default `data/<lang>_en.sqlite`), `--force` (overwrite `--out` if it exists; without it the import stops before doing any work), `--no-form-of-fallback`, `--dump <snapshot>` (the dump snapshot the input comes from, such as `dump-2026-10-30`, kept in the file's `meta` as `dump`), `--limit <n>` (stop after n lines of the language, for samples). The file is built as `<out>.tmp` and renamed when the import succeeds, so a running server never sees a half-written file. A JSON summary (counts, size, time) is printed at the end.

To avoid scanning the whole dump on every run, copy each language's lines into its own file and import that (`data/` is gitignored). One pass over the dump writes every language asked for, as `<out-dir>/<lang>.jsonl`:

```bash
bun run filter --lang pl,de --input raw-wiktextract-data.jsonl.gz --out-dir data/raw
bun run import --lang pl --input data/raw/pl.jsonl
```

`--lang` takes a comma-separated list, or `all` (the default) for every language in `languages/`; `--out-dir` defaults to `data/raw`; `--force` overwrites files that exist.

### Dump snapshots

kaikki replaces the dump about once a week and keeps no old ones, so the dictionaries a release ships are built from stored snapshots instead: pre-releases of this repo named `dump-<date>`, each with one gzipped `<lang>.jsonl` per language and a `SHA256SUMS`. `dumps.toml` pins the snapshot each language is imported from. The dump canary (`.github/workflows/canary.yml`, Mondays and by hand) stores every new dump as a snapshot, imports each language from it and from its pin, and opens a PR that moves the pins with the two builds compared (import counts, and the entries and forms added, removed and changed), or an issue when an import fails. `bun run dumps pinned <lang>`, `bun run dumps pin <snapshot>`, `bun run dumps diff <before.sqlite> <after.sqlite>` and `bun run dumps report <dir>` are what it runs.

For Polish, a run over the full local dump takes about 60 s (about 15 s from a pre-filtered `pl` JSONL) and produces a ~43 MB file. German is about the same: 371,793 lines, 99,321 entries, ~44 MB, about 19 s from `data/raw/de.jsonl`.

What gets imported:

- one entry per word + etymology + part of speech (wiktextract lines that repeat that key are merged); `pos` is mapped to a Universal Dependencies tag, `X` if unknown
- senses: the most specific gloss of each sense; archaic senses and the language's historical stages (Middle/Old Polish) are skipped (see the last point below)
- pronunciation: standard IPA (regional variants only when nothing else exists) and `upload.wikimedia.org` audio URLs
- the Wiktionary page each entry comes from (`entries.pages`), for credit: a lookup links it in `sources` (`https://en.wiktionary.org/wiki/Mutter#German`, the section named by `name` in `language.toml`), and each recording in `pron.audio` carries its Commons file page as `source`. `/v1/get-meta` lists Wiktionary (CC BY-SA 4.0) and Wikimedia Commons in `sources` (`apps/server/src/lookup/common/sources.ts`); every link a lookup sends is on one of their origins
- `forms`: every form from the lemma's inflection table plus the lemma itself, normalized (NFC, lowercase, diacritics kept); template rows, multi-word analytic forms and related words (diminutives, aspect partners, ...) are dropped. The `(form, entry_id)` primary key deduplicates
- grammar words (articles, pronouns, possessives, contractions) come from a hand-written file, `languages/<lang>/grammar.tsv`, because Wiktionary only redirects their forms (`des` -> `der`, Polish `mi` -> `ja` "I"). Each line is one word as written, a UD part of speech and its senses. For a word in the file, Wiktionary's determiner, pronoun, preposition, conjunction, particle and auxiliary entries are dropped; its nouns, verbs and other content words stay. The file's entries are written first
- form-of / alt-of senses that are grammar or spelling ("domu: genitive singular of dom") never become entries; they add `form -> lemma` rows when the lemma exists and the form was missing from its table. A word with no entry also passes on its own table, following chains, so `tańsi` (from the table of `tańszy`, comparative of `tani`) returns `tani` (turn all of this off with `--no-form-of-fallback`)
- derived words and abbreviations get their own entry, recognised by the gloss opening (`isOwnEntryGloss` in `rules.ts`). A gloss that only names its base gets the base's meanings, one sense each ("diminutive of bal: log"): same part of speech first, following chains, skipping `synonym of` senses, and every etymology when the base has several. If nothing is found, the bare gloss stays. The entry then credits the base pages the meanings were read from as well as its own
- a word whose only senses are historical keeps them, if it has no other entry
- spellings with a usage label (obsolete, dialectal, poetic, ...), from alt-of senses or the headword line, only point at their standard word when they reach nothing else, so obsolete `für` ("alternative form of vor") doesn't add `vor` to `für`
- table rows that aren't forms of the word are dropped: German verb tables list the perfect auxiliary (`haben`, `sein`)
- an abbreviation is also found without its period (`bzw` -> `bzw.`), which tokenizers drop, when that spelling reaches nothing else
- with `[import] reflexive` (Polish), senses Wiktionary labels "reflexive with się" (or `sobie`) become an entry of their own, `bawić się` "to play" next to `bawić` "to amuse", found by the verb's forms; a sentence with `się` near the verb puts it first (`[context] reflexiveParticles`)

A lookup answers with headwords, as the protocol defines them (`apps/server/src/lookup/headword.ts`): the stored lemma with its article where the language has `[headword] articles` (`der Hund`, `der/das Bonbon`), the grammar features as `labels` elsewhere (`соба́ка` `f`, `anim`), and entries with the same headword merged. Entries whose grammar differs stay apart (`der See` "lake", `die See` "sea"); the importer already splits them. `see` links name their targets' headwords, and a lookup of such a headword with its article (`der See`) finds it.

Lookups rank entries in one query, using what the import stored: first by case (a lowercase word shows lowercase lemmas first, so `oder` gives "or" before the river `Oder`; acronyms go last unless the word is all caps), then the entry whose lemma is the word itself before the words it is a form of (`Frage` before `fragen`), then import order. For German, a word with no entry is split into known parts (`Gemüsefonds` -> `Gemüse` + `Fond`, linking `-s-`, `-n-`, `-en-`, ... allowed) and their entries are returned in reading order (`apps/server/src/lookup/features/compounds/`), with `segments` that slice the word as sent (`Schifffahrt` | `s` | `geschichte`). If normalizing changed the word's length (decomposed accents, spaces around it), the entries come without segments.

With `context` (and `at`, which copy of the word was clicked), the entries matching the sentence come first (`apps/server/src/lookup/features/`, one file per feature; `lookup.ts` puts them in order). Each carries `match`, the parts of the sentence it covers as written, for the client to highlight:

- phrases the word is part of: multi-word forms of multi-word entries, all in a row (`vor allem`, `Stanów Zjednoczonych`). Only a verb phrase's verb may be inflected (`miało miejsce` -> `mieć miejsce`) or stand apart from the rest in its clause (`tritt morgen in Kraft`). In German it must come first, and the rest must end the clause, so `ist an` in `Er ist an der Uni` isn't `an sein`. Longest phrase first, at most three
- German separable verbs: the clicked verb with the particle that ends its clause, or the clicked particle with the nearest verb before it, when particle + verb is a form of a verb starting with that particle (`fand ... statt` -> `stattfinden`; `geht mit ihr` stays `gehen`)
- then the word's own entries, without those already shown

The phrase index is built at startup, about 0.5 s for German. A lookup with context takes about 0.7 ms on average for German and 0.35 ms for Polish, against 0.2 ms without.

The format is described in `spec/dictionary/README.md`. Bump `SCHEMA_VERSION` (in `packages/core/src/schema.ts` and `spec/dictionary/format.json`) when the schema changes; it is stored as `PRAGMA user_version`, and `openDictionary` refuses files built for another version.

## Contributing and licence

[CONTRIBUTING.md](CONTRIBUTING.md) says what helps and how to send a change. The code is under the [MIT licence](LICENSE). Dictionary files built from Wiktionary are under CC BY-SA 4.0.
