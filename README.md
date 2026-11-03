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
- `GET /v1/lookup?word=<word>&lang=<pair>` — entries from `data/<pair>.sqlite`. Every pair in `LANGUAGES` needs its file: build it first, see below

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

Flags: `--lang` (default `pl`; `pl` and `de` have rules, in `src/importer/transform/languages.ts`), `--input` (path or URL, default the raw dump URL), `--out` (default `data/<lang>_en.sqlite`), `--force` (overwrite `--out` if it exists; without it the import stops before doing any work), `--no-form-of-fallback`, `--limit <n>` (stop after n lines of the language, for samples). The file is built as `<out>.tmp` and renamed when the import succeeds, so a running server never sees a half-written file. A JSON summary (counts, size, time) is printed at the end.

To avoid scanning the whole dump on every run, copy one language's lines into their own file and import that (`data/` is gitignored):

```bash
bun run filter --lang pl --input raw-wiktextract-data.jsonl.gz --out data/raw/pl.jsonl
bun run import --lang pl --input data/raw/pl.jsonl
```

For Polish, a run over the full local dump takes about 60 s (about 15 s from a pre-filtered `pl` JSONL) and produces a ~43 MB file. German is about the same: 371,793 lines, 99,321 entries, ~44 MB, about 19 s from `data/raw/de.jsonl`.

What gets imported:

- one entry per word + etymology + part of speech (wiktextract lines that repeat that key are merged); `pos` is mapped to a Universal Dependencies tag, `X` if unknown
- senses: the most specific gloss of each sense; archaic senses and the language's historical stages (Middle/Old Polish) are skipped (see the last point below)
- pronunciation: standard IPA (regional variants only when nothing else exists) and `upload.wikimedia.org` audio URLs
- `forms`: every form from the lemma's inflection table plus the lemma itself, normalized (NFC, lowercase, diacritics kept); template rows, multi-word analytic forms and related words (diminutives, aspect partners, ...) are dropped. The `(form, entry_id)` primary key deduplicates
- grammar words (articles, pronouns, possessives, contractions) come from a hand-written file, `src/importer/grammar/<lang>.tsv`, because Wiktionary only redirects their forms (`des` -> `der`, Polish `mi` -> `ja` "I"). Each line is one word as written, a UD part of speech and its senses. For a word in the file, Wiktionary's determiner, pronoun, preposition, conjunction, particle and auxiliary entries are dropped; its nouns, verbs and other content words stay. The file's entries are written first
- form-of / alt-of senses that are grammar or spelling ("domu: genitive singular of dom") never become entries; they add `form -> lemma` rows when the lemma exists and the form was missing from its table. A word with no entry also passes on its own table, following chains, so `tańsi` (from the table of `tańszy`, comparative of `tani`) returns `tani` (turn all of this off with `--no-form-of-fallback`)
- derived words and abbreviations get their own entry, recognised by the gloss opening (`isOwnEntryGloss` in `rules.ts`). A gloss that only names its base gets the base's meanings, one sense each ("diminutive of bal: log"): same part of speech first, following chains, skipping `synonym of` senses, and every etymology when the base has several. If nothing is found, the bare gloss stays
- a word whose only senses are historical keeps them, if it has no other entry
- spellings with a usage label (obsolete, dialectal, poetic, ...), from alt-of senses or the headword line, only point at their standard word when they reach nothing else, so obsolete `für` ("alternative form of vor") doesn't add `vor` to `für`
- table rows that aren't forms of the word are dropped: German verb tables list the perfect auxiliary (`haben`, `sein`)
- an abbreviation is also found without its period (`bzw` -> `bzw.`), which tokenizers drop, when that spelling reaches nothing else

Lookups rank entries in one query, using what the import stored: first by case (a lowercase word shows lowercase lemmas first, so `oder` gives "or" before the river `Oder`; acronyms go last unless the word is all caps), then the entry whose lemma is the word itself before the words it is a form of (`Frage` before `fragen`), then import order. For German, a word with no entry is split into known parts (`Gemüsefonds` -> `Gemüse` + `Fond`, linking `-s-`, `-n-`, `-en-`, ... allowed) and their entries are returned in reading order (`src/dictionary/compounds.ts`). `Proposal-word-segments.md`, next to `Protocol.md`, proposes how the response could show the split.

Bump `SCHEMA_VERSION` in `src/dictionary/schema.ts` when the schema changes; it is stored as `PRAGMA user_version`, and `openDictionary` refuses files built for another version.
