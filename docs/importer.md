# The importer

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

## Dump snapshots

kaikki replaces the dump about once a week and keeps no old ones, so the dictionaries a release ships are built from stored snapshots instead: pre-releases of this repo named `dump-<date>`, each with one gzipped `<lang>.jsonl` per language and a `SHA256SUMS`. `dumps.toml` pins the snapshot each language is imported from. The dump canary (`.github/workflows/canary.yml`, Mondays and by hand) stores every new dump as a snapshot, imports each language from it and from its pin, and opens a PR that moves the pins with the two builds compared (import counts, and the entries and forms added, removed and changed), or an issue when an import fails. `bun run dumps pinned <lang>`, `bun run dumps pin <snapshot>`, `bun run dumps diff <before.sqlite> <after.sqlite>` and `bun run dumps report <dir>` are what it runs.

For Polish, a run over the full local dump takes about 60 s (about 15 s from a pre-filtered `pl` JSONL) and produces a ~43 MB file. German is about the same: 371,793 lines, 99,321 entries, ~44 MB, about 19 s from `data/raw/de.jsonl`.

## What gets imported

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

## The file format

The format is described in `spec/dictionary/README.md`. Bump `SCHEMA_VERSION` (in `packages/core/src/schema.ts` and `spec/dictionary/format.json`) when the schema changes; it is stored as `PRAGMA user_version`, and `openDictionary` refuses files built for another version.
