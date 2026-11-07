# Ukrainian (uk_en)

Tier: **Model only, unreviewed.** No reader of Ukrainian has checked this profile, the grammar file or any sample: every point below rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-06/07 as a test of the add-language skill without a reader: the common-word gates pass, the random-word gate doesn't (see Gates). No tier-2 work, no context benchmark (`gold/`).

Data: `data/raw/uk.jsonl`, filtered from the 2026-11-01 dump (60,297 lines). `data/uk_en.sqlite` (schema v5) has 33,102 entries (37,995 in the plain import: verb forms whose form-of target carried an aspect marker now link to their verb instead of standing alone as label entries). English Wiktionary's Ukrainian is thin: Russian has 62k entries, Polish and German about 105k.

Corpus: `../corpus/uk`, 43 texts, 86,952 tokens, gathered 2026-11-06.
- **Spoken:** 40,332 words in 20 YouTube videos (auto-captions repaired by Haiku), 10 genres (food, history, tech, news, science, travel, sport, lifestyle, culture, vlog), at most two per channel. The largest is 8% of the spoken words. No gaming or podcast videos: every candidate ran over 40 minutes.
- **Written:** 48,784 words in 23 texts, 15 genres: 8 Wikipedia articles and 15 articles from Українська правда and its sites (economy, life, sport). The largest is 14%.

## Quirks

### Spelling and headword

- **Apostrophe.** The dump writes `'` (11,649 forms, `п'ять`, `м'ясо`); texts also write `’` (U+2019), `ʼ` (U+02BC, the orthography's recommended sign) and `‘`. Chromium's word splitter keeps all of them inside the word. **Fixed** in `lookupKey` for every language (schema v5, spec vectors): the three are read as `'`. The corpus mostly writes `'` (672 against 14), so the corpus gain is small (`зв’язків`, `марʼїнка`, 15 tokens), but news sites and official texts write `ʼ`.
- **Stress.** The dump writes stress as a combining acute (`стари́й`); `lookupKey` already drops it on Cyrillic words. 14 corpus tokens carry one (Wikipedia). `stressedLemmas = true`: 92% of noun lemmas and 99.7% of verb lemmas show their stress.
- **ґ.** A letter of its own (346 dump words, 25 corpus tokens). **Not folded** into г: only 4 corpus tokens would gain (the dump spells `реґламент`, `манґан` with an older ґ), and folding would merge real pairs (`ґрати` "bars", `грати` "to play").
- **ё/е.** Russian's `optionalLetters` dropped: the dump has no ё.
- **Headword labels.** The default `[headword]` labels. 14,283 of 14,528 nouns carry gender and 11,621 animacy; 5,879 of 6,237 verbs carry aspect.
- **Pronunciation.** 12 entries mark the standard IPA "Standard Ukrainian" next to regional ones (`він`, `що`): `standardPronNotes`.

### Tokens

Words are separated by spaces. The reflexive `-ся` is written onto the verb, as in Russian, and verb tables list those forms, so no `import.reflexive`. Hyphen-joined words (290 lemmas: `будь-який`, `по-українськи`) are joined back by `context.hyphenWords`. Abbreviations with periods (`і т. д.`, `у т. ч.`, `н. е.`) split at the period in Chromium, as in Russian.

The browser check found one splitter difference the API collection didn't copy: Chromium splits at a colon between letters (`CPH:DOX`), Bun doesn't. Fixed in `../corpus/eval/collect.ts`.

### Coverage

90.0% of corpus tokens had an entry in the plain import (run `r0`), 90.3% at the end of tier 1 (`r6`): spoken 92.0%, written 88.8%. Russian has 96.1%, Polish 94.6%, German 97.2% on their corpora. The top tokens without one:
- **words English Wiktionary lacks** (the hand-patch list below): `класно`, `максимально`, `смачно`, `реально`, `формат`, `ліміт`, `акумулятор`, `подавати`, `передавання`, `номінал`, `хлорофіл`;
- **names:** `Гетсбі`, `Дейзі`, `Ярмоленко`, `Педріньо`, `Кідрука`;
- **English and Latin script:** `Samsung`, `Galaxy`, `Ultra`, `YouTube`, `the`;
- **Roman numerals:** `XVII`, `XIX`;
- **Russian words in speech (surzhyk):** `тоже`, `вообще`, `короче`. The judge rates these `missing_word`, not `foreign_word`.
- **abbreviations:** `НБУ`, `УП`, `дол.`, `англ.`, `хв`: the last three are in the grammar file now.

Importer bugs found here (all fixed, see the log): form-of targets with the aspect written after them, and a noun table of dashes.

### Grammar words

`grammar.tsv`, 226 lines, written without a reader. The judge's first run pointed to:
- **personal pronouns:** Wiktionary gives them one shared table (template `l-self`), so `мені`, `нас`, `вам`, `них` reached every personal pronoun at once (я, ти, він, вона, ми, ви, вони, себе), and `його`, `її`, `їх` only as possessives. The table's rows carry ordinary person tags, so `untrustedFormTags` can't single them out; grammar lines replace them.
- **plural demonstratives:** `ці`, `ті`, `цих`, `тих` read as "this", "that".
- **forms of бути and могти:** `був`, `буде`, `міг`, `може` "maybe".
- **endings after numbers:** `-й`, `-го`, `-му`, `-х`, `-ту` (`44-го`, `2025-му`, `63-ту`).
- **adverb senses:** `все` + comparative "more and more", `близько` and `десь` "about", `тут` "at this point", `більше не` "no longer".
- **set phrases English Wiktionary lacks:** `залежно від`, `відповідно до`, `тим не менш`, `більше того`, `при цьому`, `не лише … а й`, `за рахунок`, `у разі`.
- **abbreviations and interjections:** `англ.`, `дол.`, `хв.`, `млрд`, `ой`, `угу`, `плюс`.
- **an irregular form:** `року` (genitive of `рік` "year", one of the commonest words) reached `рок` "rock music" first.

Order matters: for one word, grammar lines rank in file order, and before Wiktionary's entries. Putting `що PRON` before `що SCONJ`, `та DET` before `та CCONJ` or `як ADV` before `як CCONJ` made hundreds of popovers worse in the classified diff. `так як` as a phrase line was dropped: transcripts write the manner reading (`так, як він писав`) without a comma, so it fired on both; `так ADV` now gives both readings.

### Structure

Every setting started from Russian's and was checked against the dump:
- **`untrustedFormTags = ["error-unrecognized-form"]`:** 38,454 rows on 5,884 verb tables are the periphrastic future and conditional, written as a heading and a phrase (`він бу́де ма́ти`).
- **Negation** (`не`), **gap 2**, **hyphen words:** kept, as in Russian. Ukrainian has only 43 multi-word verb entries, so these matter little in tier 1.
- **`abbreviationLeads = ["і", "у", "в"]`:** Ukrainian writes `і т. д.`, `у т. ч.`.
- **`ownEntryForms = ["passive", "active participle"]`** (new setting, default off): 377 "passive of" glosses (`використовуватися` "passive of використовувати") and 447 adjectival participles keep an entry with the verb's meaning ("passive of використовувати: to use") instead of a bare link to the verb. As links, `використовується` lost "is used", and the verb ranked before a same-spelled adjective (`поширені`). Adverbial participles (`роблячи`) stay links. Russian has 2,253 "passive of" glosses and Polish 1,548 adjectival participles with the same problem; neither sets it yet (the user's rule for this round: other languages unchanged).
- **Compounds:** Russian's linkers (`о`, `е`, a plain join). Stem endings in Ukrainian spelling (`-ий`, `-ій`, no `-ый`). Adjective endings only with two or more letters, because the one-letter ones are also verb endings (`робила`). Not measured beyond the corpus diff.

### What the general rules do here

- **Comparatives** have entries of their own (`частіше` "comparative degree of часто: frequently, often").
- **Participles** (`розташована`, `призначені`) now show their verb's meaning, and rank after an adjective of the same lemma (`поширені`: "widespread" first): a lookup rule for any verb entry whose senses say "participle of".
- **Endings after numbers** come from the grammar file.

## Coverage gaps (hand-patch list)

Words English Wiktionary lacks that the corpus uses, for a person to patch:
`класно`, `максимально`, `смачно`, `реально`, `прям`, `формат`, `ліміт`, `акумулятор`, `ламінат`, `подавати`, `заставити`, `вкривати`, `перемішувати`, `орендувати`, `зварювання`, `передавання`, `поглинання`, `номінал`, `хлорофіл`, `сингулярність`, `природно`, `слабо`, `декоративно`, `класний`, `пісний`, `ріст`, `ланка`, `порода`, `фаворит`, `старшина`, `забарвлення`, `трек`, `матрас`, `плюс` (now a grammar line), `мінус`.

## Log

All runs are in `../corpus/eval/out/uk/` on the same 2,200 items (sample from `r0`). Judge: Haiku, `--effort medium`, `--concurrency 10`.

| Run | Change | Common grammar | Common content | Random |
|---|---|---|---|---|
| r0 | plain import, Russian's settings copied | 83.6% | 93.5% | 80.1% |
| r1 | `language.toml` checked, apostrophe fold, form-of aspect, empty tables, grammar file (214 lines) | 96.0% | 96.3% | 80.3% |
| r3 | `ownEntryForms`, grammar order fixed, 10 lines | 97.0% | 96.2% | 80.6% |
| r6 | participles after adjectives, `року`, `так`, `один в один` | **98.0%** | **96.2%** | 80.6% |

Judging r0 cost $0.55 (88 batches, 6.5 minutes); later runs only judged changed popovers (16, 4 and 1 batches).

Classified diffs (Haiku, words per verdict): r0→r1 10,928 better, 2,784 worse; r1→r3 2,834 better, 650 worse; r3→r6 1,239 better, 12 worse. The worse ones were read; what stays:
- **participles:** where the sentence uses the verbal sense, the adjective now leads (`зафіксована` "recorded" gets "fixed" first; `спрямовані` "aimed"). 12 words in r3→r6.
- **homographs ranked by dump order:** the form-of fix removed label entries ("third-person singular future of стати") that used to win as the word's own lemma, so `стане` now leads with the vocative of `стан` and `діє` with `дія`. Russian has always worked this way. Tier 2 (ranking).
- **`вбраний`:** its only sense links to `вбрати`, which the dump lacks, so it lost its entry (1 corpus token).
- **`геліобактеріях`:** the new compound endings no longer split it (2 tokens).

Other languages (API collections against `uk-base`, run before any change): German 0 changes, Polish 0, Russian 50. All 50 Russian ones were read: 48 drop a label entry ("plural past indicative of стать pf") so the verb's own entry leads, as for every other Russian verb form; `о'кей` gains an entry through the apostrophe fold; `включали` drops a label entry behind a phrase.

## Gates

Scored with `score.ts` as of 2026-11-07: a common word with no entry counts toward neither common gate, and each gate also gives its figure without the judge's `missing_word` misses.

| Gate | Needs | r0 | r1 | r3 | r6 |
|---|---|---|---|---|---|
| Common grammar words | 97.5% | 85.9% (86.5%) | 97.9% | 99.0% | **99.7%** of 580 |
| Common content words | 92.5% | 93.5% | 96.3% | 96.2% | **96.2%** of 602 |
| Random words | 87.5% | 80.1% (93.5%) | 80.3% (93.6%) | 80.6% (93.8%) | 80.6% (**93.8%** without 138 missing words) |
| Common words without an entry (no gate) | | 15 | 11 | 11 | 11, 9% understood |
| Judge: overall understood | | 83.9% | 88.0% | 88.4% | 88.6% |

In brackets: without `missing_word` (the same where not given). The common grammar gate passes from r1 on; on r6 it fails 2 items (`тому` in `в тому, щоб`, and a Cyrillic `О` written for the chemical symbol), with 2 false positives. Before the scoring change it was 98.0% of 591, counting the 11 words without an entry as grammar words.

The random-word gate fails on data, not lookups: 138 of its 190 failures are words English Wiktionary has no Ukrainian entry for (`подають`, `акумулятор`, `ламінат`, `орендувати`, `пісні` as in `пісні дні` "Lenten days"). The 11 common words without an entry are the same kind (`класно`, `реально`, `максимально`, `смачно`). Both need hand patches.

### False positives

In `../corpus/eval/out/uk/false-positives.jsonl`:
- `не` in `ледь не ідентичні`: clicking `ледь` shows the phrase "almost, nearly", and `не` gives its own meaning.
- `частіше`: the entry says "comparative degree of часто: frequently, often", the dictionary's comparative label (as in Russian).

### Not counted, with a doubtful label

- `Герої_ні` is labelled a transcription slip, but it is the gender-inclusive spelling (героїні/герої), which the splitter keeps as one word. One item.
- Russian words in Ukrainian speech: `короче`, `вообще`, `опять` are labelled `foreign_word` (not counted), `тоже` `missing_word` (counted).

## Tier 2

Not started. Candidates: adverbs in `-о` from adjectives in `-ий` (240 corpus tokens without an entry, `максимально`, `реально`, `природно`, but also `конечно` → `конечний` "finite", a Russian word); homograph ranking (`стане`, `діє`); `в тому, щоб`; football phrases.
