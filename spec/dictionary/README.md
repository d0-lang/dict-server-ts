# Dictionary file format

One SQLite file per language pair, `data/<source>_<target>.sqlite` (e.g. `data/ru_en.sqlite`). The importer writes the files and the server only reads them. Any implementation that reads or writes them should work from this folder, not from the TypeScript:

| File | What |
|---|---|
| `schema.sql` | The DDL, run as is on an empty file |
| `format.json` | The schema version, and the codes stored in the integer and text columns |
| `lookup-key.jsonl` | Test vectors for the two normalizations every reader and writer must share: `lookupKey` and `caseClass` |

`packages/core` mirrors these files in TypeScript, and its tests fail when the two drift apart.

## Versioning

`PRAGMA user_version` holds `format.json`'s `schemaVersion`. Readers refuse any other version. Files are rebuilt, never migrated. Bump the version when the DDL changes, or when the meaning of a stored value changes, `lookupKey` included: old `forms` rows would silently stop matching.

## Tables

- **`meta`**: key/value pairs about the import, with the keys in `format.json`'s `metaKeys` (pair, source, date, counts). Informational only.
- **`entries`**: one row per word + etymology + part of speech. The `id` order is the order lookups return entries in, ties aside.
  - `lemma`: the headword. For Russian it carries stress marks (`соба́ка`).
  - `pos`: a Universal Dependencies tag from `udPos`, `X` when unmapped.
  - `source_pos`: the raw wiktextract part of speech (`noun`, `name`, `phrase`, …), or one of the importer's own values in `sourcePos`: `grammar` marks entries from a language's hand-written `languages/<lang>/grammar.tsv`, and `letter-name` marks entries that name a letter.
  - `etymology`: wiktextract's etymology number, 0 when the word has one etymology.
  - `case_class`: `caseClass` of the lemma (see below).
- **`senses`**: ordered by `idx` within an entry. `translations` is a JSON array of strings and is never empty. `see` is a JSON array of words that have entries, or null.
- **`pronunciations`**: ordered by `idx`, with `kind` from `pronKinds`. `ipa` and `audio` rows become the protocol's `pron.ipa[]` and `pron.audio[]`. An entry has at most one `reading`.
- **`forms`**: the deinflection index, `lookupKey(surface form) → entry`. The lemma itself is a row too, so a lookup is one primary-key prefix scan. `source` is a code from `formSource`:
  - `Lemma`: the entry's own headword.
  - `Inflection`: a form from the lemma's inflection table or head forms.
  - `FormOf`: a separate "X is a form of Y" entry pointing at the lemma.
  - `Abbreviation`: an abbreviation without its period (`bzw` → `bzw.`).
  - `LetterVariant`: a form spelled another common way: an optional letter written plainly (`все` for `всё`), or an abbreviation without its spaces (`z.B.`).

## Normalization

**`lookupKey(word)`** is the spelling words are indexed and searched by:
1. NFC.
2. Trim.
3. Lowercase.
4. For a word that contains a Cyrillic letter, drop the combining acute and grave (U+0301, U+0300): decompose to NFD, remove them, recompose to NFC. `й` and `ё` keep their marks.

All other diacritics are kept (Polish `łza` and `lza` are different words).

**`caseClass(word)`** looks at the letters only:
- `AllCaps` (2): two or more letters, all uppercase (`EU`).
- `Lower` (0): the first letter is lowercase.
- `Capitalised` (1): anything else, words without letters included.

`lookup-key.jsonl` holds one `{ word, key, caseClass }` per line. An implementation passes when it gives `key` and `caseClass` for every `word`.
