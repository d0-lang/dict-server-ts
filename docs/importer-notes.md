# Importer: plan and review notes

Working notes for the Wiktionary importer. Start at "Next steps". Numbers come from one build of the old kaikki.org Polish extract (200,176 lines), not the full raw dump, so re-measure before relying on them. Per-language extracts are being deprecated; use the raw dump from now on.

## Measurements on the full dump (2026-11-01)

Measured, not decided. Throwaway scripts, so class counts come from gloss and tag heuristics and are approximate.

- Filter 59 s, import 53 s, 0 invalid lines. Polish is 200,176 lines, 91,691 entries, 1,186,330 `forms` rows, 38.9 MB: the same as the old extract, so its numbers still hold.
- Audio: 6 of 426,431 Polish sound rows have audio; German has 341,053 and Russian 23,826 with the same fields. The importer reads the right field. The gap is in the dump's Polish data.
- Pointer senses: 7,286 Polish `synonym of` senses, not the two seen earlier (German 982, Spanish 1,071, Russian 55).
- Etymology risk: of about 12,000 Polish derived-style senses with a base, 252 have a base with several etymologies (about 2%).
- Copied senses, Polish: median 2, p90 7, p99 21, max 67 (`babka` and `babsko` from `baba`); 442 over 10, 110 over 20.
- Source gloss already has a meaning: female equivalents 2,178 of 2,232; diminutives 316 of 2,764; verbal nouns 31 of 4,722. `nauczycielka` needs no copying.
- Polish lookups returning nothing: about 5,500 inflected words. About 3,150 point at a derived word and 1,280 at a participle or comparative (`tańsi` -> `tańszy`).
- Classifying inflections: "all opening words are in the sense's tags" misses across languages (`weak/mixed all-case plural`, `first/third-person`, `short plural of`). The derived openings are a short, stable list: female equivalent, diminutive, augmentative, verbal noun, agent noun, frequentative, iterative, singulative.
- `książę` (prince) and `księcia` return nothing: all the `książę` senses shown carry `Middle` + `Polish`, so the historical-stage rule drops the word. Cause not checked against Wiktionary.
- Russian: 2.5M of 2.9M forms and most link targets carry stress marks but headwords don't, so about 94% of inflection links miss with `lookupKey`. Needs fixing before adding Russian.

## Current state (2026-11-01)

- Derived words (section 1), table moves and historical-only words are implemented, uncommitted on `importer`, along with real `/v1/lookup`, which includes the `lookup-stub` commit's changes. The proposed details in section 1 are confirmed.
- `data/pl_en.sqlite` is built from `data/raw/pl.jsonl`: 100,019 entries, 43 MB. Run the server with `LANGUAGES=pl_en bun run dev`.
- Compared with the old build, about 64,900 more words are findable and none were lost.
- Not decided: `obsolete` senses (section 3), and failing an import that produces 0 entries (section 2).
- Not tried: the extension against the real endpoint.
- Known: copied senses come in source order, so `babka` (84 senses) starts with `baba`'s meanings. A verbal noun with no line in the dump redirects to its verb (about 7,400).

## Next steps

Test the dictionary by hand for a few days, then decide what to change from what comes up.

## 1. Derived words are treated as inflections

Wiktextract tags inflections and derived words alike as `form-of`. The importer drops the gloss of every `form-of` sense and adds a `forms` row pointing at the target, or nothing when the target has no entry.

| Word                  | Source gloss                               | Lookup today                              |
| --------------------- | ------------------------------------------ | ----------------------------------------- |
| `psa`                 | genitive of `pies`                         | `pies` (correct)                          |
| `nauczycielka`        | female equivalent of `nauczyciel`          | only `nauczyciel`                         |
| `dziewczynka`         | diminutive of `dziewczyna`; little girl    | only `dziewczyna`, "little girl" lost     |
| `matka` (etymology 2) | diminutive of `mata`                       | `mother`, plus unexplained `mata` entries |
| `USA`                 | initialism of the United States of America | nothing                                   |

Rough size, from gloss-prefix matching on the old extract: about 7,260 words return only another lemma and about 490 return nothing. Verbal nouns, diminutives and female equivalents dominate.

### Agreed direction

- **One word, one entry.** Only the same word with different grammar is a form. This has to hold across languages, and the protocol can't carry grammatical information such as gender.
- **One entry must be enough to understand the word.** Showing the base word as a second lookup result was considered and rejected on UX grounds.
- **The relation goes in the translation text**, which carries the gender without a protocol change:

```json
{
  "lemma": "nauczycielka",
  "pos": "NOUN",
  "senses": [
    {
      "translations": [
        "female equivalent of nauczyciel: teacher (person who teaches, especially one employed in a school)"
      ]
    }
  ]
}
```

| Type             | Example                | Result    |
| ---------------- | ---------------------- | --------- |
| Inflection       | `psa` -> `pies`        | Form      |
| Spelling variant | "alternative form of"  | Form      |
| Gender pair      | `nauczycielka`         | Own entry |
| Diminutive       | `dziewczynka`          | Own entry |
| Verbal noun      | "verbal noun of"       | Own entry |
| Initialism       | `USA`                  | Own entry |

### Details (confirmed)

- Recognise derived words and abbreviations from a short list of gloss openings (`isOwnEntryGloss`); everything else is a form. A word missing from the list redirects to its base, as it did before.
- No fixed sense cap. The 3-sense cap from the earlier proposal is dropped, because it hides meanings arbitrarily. Long entries are a client display problem. Revisit only if the measurements show absurd cases.
- If the source gloss already has a meaning, use it and copy nothing (`dziewczynka` keeps "little girl").
- Follow chains (`koteczek` -> `kotek` -> `kot`) up to 3 steps, and stop safely on loops.
- Prefer a target with the same part of speech.
- Initialisms and abbreviations get their own entry even when tagged `alt-of`.
- If the target has no entry, keep the bare gloss. This also applies to an inflection whose lemma isn't in the dictionary.
- One repeated prefix per sense for now. A shared header line would need a schema change.

### Pointer senses

Some senses only point to another word ("synonym of matka", "synonym of dużo"). Skip them when copying, but keep them on their own entry. If nothing usable remains, keep the bare gloss. Only two "synonym of" examples have been seen so far, so fix the list from the measurements.

### Etymology (decided: copy all, see step 3)

A link names a word, not an etymology. `mata` is five JSONL lines:

| Etymology | POS  | Gloss                                    | Result |
| --------- | ---- | ---------------------------------------- | ------ |
| 1         | noun | mat (floor pad)                          | entry  |
| 2         | noun | synonym of matka                         | entry  |
| 3         | noun | genitive/accusative singular of `mat`    | link   |
| 4         | noun | genitive/accusative singular of `mat`    | link   |
| 5         | verb | third-person singular present of `matać` | link   |

"diminutive of mata" can't say which `mata` it means, so a derived word can inherit a wrong meaning that now looks like part of its own definition.

About 2% of derived senses have a base like this. They copy every etymology, so an entry can show a meaning that doesn't apply, but the prefix shows the meanings belong to the base.

## 2. A bad run can overwrite a good dictionary (partly fixed)

An import now refuses to replace an existing output file without `--force`, which replaced the earlier proposal. Still open: `--force` with an empty input or a low `--limit` replaces a good dictionary, and an empty input with no existing file publishes an empty one. A 0-entries failure was left out to keep the fix simple.

## 3. Data questions (not discussed yet)

- Audio: the Polish extract has only 12 audio URLs against 94.5k pronunciation rows. Cause unknown: the importer may read the wrong field, or this per-language file may lack audio. The raw dump can settle this.
- Obsolete senses: 2,143 `archaic` senses are dropped, but 5,125 `obsolete` ones are kept. Proposal: drop `obsolete`, keep `dated`.

## 4. Multi-word forms (depends on the tokenizer)

`keepForm` drops multi-word forms of single-word lemmas. In the Polish extract, this rule alone removes 458,903 rows (381,602 unique strings), nearly all verb forms: `będę wymagał`, `bym wymagał`, `niech wymaga`, `wymaga się`. That is about 40% more on top of the 1.19M `forms` rows.

Each word still resolves on its own (`wymagał` -> `wymagać`), so this only matters if a tokenizer sends the whole span. The protocol allows spans, and German separable verbs (`fängt an`) may need them. Polish doesn't need these rows. `się` moves around in a sentence (`boję się`, `się boję`), so a tokenizer can't build that span reliably, but the verb alone resolves: `boję` -> `bać`, `wymagałbym` -> `wymagać`. Only 2 verb lemmas in the Polish build end in ` się`, both long idioms. A tokenizer sending `boję się` as one span finds nothing, so the Polish tokenizer should send the verb alone.

German separable verbs (`fängt an`) may need a per-language setting. Add it with German.

## Minor

- The README says only `upload.wikimedia.org` audio is kept, but the code accepts any `https://` URL.
- A failed run leaves `<out>.tmp` behind until the next run removes it.
- From reading the code, not tested: SQLite errors during `writeBatch`, `ANALYZE` or `VACUUM` crash as defects instead of `ImportError`.
- `ImportError`s print a stack trace from the CLI, including the "already exists" refusal.
- Not tested: the full raw dump and importing from a URL.

## Separate experiment: lookup popover

Not part of the importer, and only on local unpushed branches. Both are worktrees next to the checkouts:

- Server: `lookup-stub` in `../server-lookup-stub`. `/v1/lookup` follows `Protocol.md` and returns hardcoded samples.
- Extension: `lookup-popover` in `../extension-lookup-popover`. Right-click "Look up" opens an in-page popover.

Still to try by hand: the real menu item, Firefox, audible audio and binding through setup. Known issues: the "Word lookup" switch in the toolbar popup is ignored, the content script adds about 155 kB to every frame, and `matka`'s two origins merge into one group as the protocol specifies.
