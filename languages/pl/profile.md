# Polish (pl_en)

Tier: **Reviewed** in principle (the user reads Polish), but neither this profile nor the 78 grammar lines added on 2026-11-06 have been reviewed yet. Polish passed tier 1 on 2026-11-06, and has had no tier-2 work. It has no context benchmark (`gold/`).

Data: `data/raw/pl.jsonl`, filtered from the 2026-11-01 dump. `data/pl_en.sqlite` (schema v4) has 106,749 entries and 1.67M forms: 46,581 nouns, 20,569 verbs, 17,396 names, 13,421 adjectives. The build from before the reflexive entries is `data/backup-2026-11-06-v3/pl_en.before-reflexive.sqlite`.

Corpus: `../corpus/pl`, 24 texts, 93,085 tokens.
- **Spoken:** 52,938 words in 10 repaired videos, 5 genres. The largest is 23% of the spoken words.
- **Written:** 42,111 words in 14 texts, 14 genres. The largest is 17%. 12 of the texts are Wikipedia articles, added 2026-11-06 (corpus d549ee4), so written Polish is mostly encyclopedic. More news and blog text would help.

## Quirks

### Spelling and headword

- **Spelling.** No marks the dump writes and texts drop, and no letter variants, so `lookupKey` needs nothing for Polish.
- **Headword labels.** Polish uses the default `[headword]` labels (gender, animacy, aspect, number). 38,109 of 46,581 nouns carry gender, and 20,503 of 20,569 verbs carry aspect. No articles.

### Tokens

Words are separated by spaces, and no clitics are written onto words. The conditional endings (`-bym`, `-byś`) attach to verbs (`zrobiłbym`), and the inflection tables list those forms. When they stand alone (`gdybym`, `że bym`), the grammar file covers them.

### Coverage

94.6% of corpus tokens have an entry (run `round3`). The top 50 tokens without one fall into these groups:
- **names:** `Chopin`, `Zborowski`, `Soplica`, `Jungingen`;
- **English in transcripts:** `you`, `the`, `of`, `there's`;
- **Roman numerals:** `II`, `XIX`;
- **abbreviations and chemistry:** `NBP`, `ATP`, `NADP`, `kJ`, `C4`;
- **terms English Wiktionary lacks:** `fotoukładu`, `bisfosforybulozy`, `okołowiązkowych`, `współpartnera`, `bonusy`.

`maksymalnie` has no Polish line of its own in the dump. Only the abbreviation pointing to it does. All of these are data gaps or not Polish, and none is an importer bug.

### Grammar words

`grammar.tsv` has 312 lines. 78 of them came from the judge's first gate run:
- **`i` "and":** the commonest Polish word. The full dump has no Polish line for it, so the popover showed only the letter.
- **forms of `być`:** `jest`, `był`, `będzie`, `byłoby`, `będąc` only said "to be". They now get entries of their own.
- **the conditional particles:** `by`, `bym`, `byś`, `byśmy`, `byście`.
- **units and abbreviations:** `m`, `cm`, `g`, `kg`, `ok.`, `CO2`.
- **the fillers:** `yyy`, `mhm`, `e`.
- **set phrases English Wiktionary lacks:** `za dużo`, `nie wolno`, `mieć dosyć`, `dojść do`, `podjąć decyzję`, `robić zdjęcie`, `można było`, `by było`, `jak wiadomo`, `w związku z tym/czym`.
- **fuller senses:** `czyli`, `w tym`, `w sensie`, `mega`, `super`.

### Structure

- **Reflexive verbs** (`import.reflexive = "after"`, `context.reflexiveParticles`). Learners learn `bawić` "to amuse" and `bawić się` "to play" as two words. Senses Wiktionary labels "reflexive with się/sobie" become an entry of their own (6,007 entries), and the particle may stand before the verb and apart from it (`Dobrze się bawię`). On the corpus, 1,521 popovers in sentences with `się` now lead with the reflexive verb. In the judge, the change came out about neutral: 6 better, 11 worse, mostly judge noise. Two of the worse ones are real. In `jak się oglądała`, `oglądać się` comes first and misleads. In `zawężają`, "to become narrower" moved to `zawężać się`. Kept, because it is the right structure.
- **Declined participles** (`import.participleDeclension`). Verb tables list adjectival participles in the nominative only, so `wymaganego`, `należącej` and `dominującą` had no entry. The masculine singular participle now gets the adjective endings. This took 268 corpus tokens off the no-entry list.
- **Negation** (`context.negation = "nie"`). It puts the object in the genitive (`mieć znaczenie` → `nie ma znaczenia`), shared with Russian. The gap stays 1, because a gap of 2 lets in as many literal readings as idioms.
- **Compounds.** Off. Polish compounds are fewer and mostly have entries of their own. Not measured yet.

## Gates

Judge runs are in `../corpus/eval/out/pl/` (`refl` is the first run, `round3` the latest), on the same 2,200 items.

| Gate | Needs | First run | After round 1 |
|---|---|---|---|
| Common grammar words | 100% | 90.1% | 93.9% |
| Common content words | 95% | 93.6% | **95.9%** |
| Random words | 90% | 85.0% | 86.1% |
| Overall understood | | 88.6% | 90.8% |

Across the three rounds, 48 popovers got better and 1 got worse.

The failures left in `round3`:
- **common grammar words (41):** 15 fixed phrases, 14 missing senses, 4 form glosses, 5 foreign words or transcription slips.
- **random words:** 54 words with no entry, 30 missing senses, 21 foreign words, 8 names.

**Tier 1 passes** (run `../corpus/eval/out/pl/round4`, 2026-11-06, judged with the current prompt and the softer gates; see the German profile for the decisions behind them):

| Gate | Needs | Round 4 |
|---|---|---|
| Common grammar words | 97.5% | **97.6%** |
| Common content words | 92.5% | **98.1%** |
| Random words | 87.5% | **89.1%** |

Round 4 added `zdaniem` "according to", `pewnie` "probably" and `teraz` "by then". 15 grammar items are not counted. 9 of them are false positives (`../corpus/eval/out/pl/false-positives.jsonl`): governed prepositions (`dzielić się na`, `uznać za`, `obawy przed`, `mimo tego, iż`, `w kierunku`), `po`, `czym … tym`, a bare `M.` and a garbled sentence.

**Left for tier 2:**
- phrases the matcher misses, though they have entries (`od czasu do czasu`, `w zależności od`, `nie da rady`);
- senses English Wiktionary lacks (`oj`, `pięknie` as a reply, `u` "oof", `właśnie` "or rather");
- `panie` opening with `pani`.

## Coverage gaps (patch by hand later)

- `maksymalnie`, `bonus` (no Polish line in the dump)
- the technical terms above (`fotoukładu`, `okołowiązkowych`, `współpartnera`)
