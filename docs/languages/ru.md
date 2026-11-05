# Russian (ru_en)

Tier: **Reviewed**. The user reads Russian. They reviewed this profile and `grammar/ru.tsv` on 2026-11-04 (241 of 262 items agreed; the rest are worked in below). On 2026-11-05 they graded 57 random verified benchmark cases and marked 56 right (98%). The one miss (`ru-0067-p2`, `нельзя почить теперь на лаврах`) is unnatural rather than mislabelled, and is removed from the set. Two ticked cases had notes: `я хочу знать` is hardly an idiom, and `вываливать язык` is rare. Both are fine for testing. Benchmark generation and verification use Haiku, at the user's request.

Data: `data/raw/ru.jsonl`, filtered from the 2026-11-01 dump: 443,260 lines. `data/ru_en.sqlite` has 61,623 entries and about 1.07M forms.

Corpus: `dict-corpus/ru`, 29 texts on 2026-11-04 (the numbers below are for the first 28, 65,117 tokens):
- 24 openly licensed or official texts (ru.wikinews, ru.wikipedia, ru.wikivoyage, kremlin.ru transcripts under CC BY 4.0), about 19,500 words;
- two videos with captions written by their authors (`politics-interview`, `history-video`), filed unrepaired, since author-made subtitles are not changed;
- three videos (gaming, sport, science) repaired by Haiku with `repair.ts`.

## Quirks

### Spelling

- **Stress marks.** 2,504,859 of 2,924,863 raw forms (86%) carry a combining acute (`соба́ки`), and 5,768 a grave. Running text has none. `lookupKey` now drops U+0301 and U+0300 from any word with Cyrillic letters, after NFD, then recomposes, so `й` and `ё` keep their marks and `ѐ` becomes `е`. Polish and German keys are unchanged: no form in either file has Cyrillic plus a stress mark, so no schema bump was needed. Before the fix, inflected forms were unreachable, and they are a third of corpus tokens.
- **Stressed lemmas.** The lemma a reader sees keeps its stress (`соба́ка`, `за́мок` "castle" next to `замо́к` "lock"): the importer shows the headword's `canonical` form when it spells the same word (`stressedLemmas`). 56,413 of 62,599 lemmas have one. Words of one syllable and words with `ё` need no mark. Words inside phrase lemmas without a stressed canonical form stay unstressed, since the reader also sees each word's own entry. Grammar-file words are written with their marks.
- **ё and е.** 80,426 raw forms contain `ё`. Most texts write `е` (`все` for `всё`, `еще` for `ещё`). The importer also indexes every `ё` form with `е` (`optionalLetters`, form source `LetterVariant`, 44,762 rows), ranked after forms really spelled with `е`. Lemmas keep `ё` (`всё`, `ещё`); only the index holds the `е` spellings. So `все` gives `все`/`весь` before `всё`, and `всё` written with `ё` finds only `всё`. 0.3% of corpus tokens are found only this way.
- **Case.** Standard; no special rules. Names that are also common words (`Вера`, `Роман`, `Надежда`) are handled by the existing case ranking.
- **Apostrophes.** Not relevant; Russian uses `ъ`.
- **Pre-reform spellings.** 41,246 forms are tagged `dated`, mostly pre-1918 declension rows (`собакъ`, `кошекъ`). They are kept: they don't collide with modern words, and a reader of older text needs them.

### Tokens

- Words are separated by spaces.
- **Hyphenated words are split by the tokenizer.** `Intl.Segmenter("ru")` splits `что-то`, `кто-нибудь`, `по-русски`, `юго-запад` and `Шри-Ланка` into two words, and the extension sends only one half. There are 987 hyphenated lemmas, and they are 26% of the multi-word sample below. Five of the top 60 corpus words with no entry are hyphen halves (`нибудь`, `северо`, `юго`, `Санкт`, `Шри`). The phrase index only reads forms with a space, so these never match, even with context. Done (iteration 1): with context, a clicked word joined to its neighbour by a hyphen and no space is looked up as the whole hyphenated word (`нибудь` in `что-нибудь` → `что-нибудь`).
- No clitics written onto words. The reflexive `-ся`/`-сь` is part of the verb and its entries.

### Inflection

Rich: six cases, three genders, verb aspect pairs. Corpus tokens (65,117): 95.6% have an entry. 60.6% are found as a lemma, 33.5% only through an inflection table, 1.3% only through form-of entries, and 0.3% only through `ё`/`е`.

Top 60 corpus words with no entry, sorted by cause to find what the importer or lookup can fix:
- Latin-script words (`Linux`, `GNU`, `NASA`);
- names (`Керфура`, `Капабланкой`, `Мстислав`, `Тукая`);
- abbreviations (`МСБ`, `АТФ`, `ул`, `тыс`);
- hyphen halves (`нибудь` 16, `северо`, `юго`, `Санкт`, `Шри`);
- game slang and fillers (`крафта`, `фармил`, `ээ`);
- terms Wiktionary lacks (`биатлонных`, `перхлоратов`).

Only the hyphen halves are ours to fix; the other causes are gaps in Wiktionary or words outside Russian. `нибудь` is the most frequent ordinary word without an entry; the hyphen rule above makes it `что-нибудь`.

Fixed at import:

- **Verbal nouns tagged `form-of` without a target.** 28 entries lost all their senses and vanished (`продолжение`, `стоимость`, `родитель`, `пища`). A form-of sense that names no target is now a gloss. Polish and German have none.
- **Shared pronoun table.** `мне`, `ей` and `него` reached every personal pronoun. `grammar/ru.tsv` (218 entries) replaces Wiktionary's pronoun, determiner, preposition and conjunction entries for pronouns, possessives, demonstratives, `кто`/`что`/`который`, `весь`, `сам` and 29 prepositions. Each sense names its case. A phrase with its own entry (`так себе`, `тем более`) is left to that entry, which context shows first.
- **Misparsed tables** (`error-unrecognized-form`, 29 Russian words): the pronoun table, plus a Braille chart that gave `азбука Брайля` every one-letter word (`в`, `и`, `а`) as a form. These rows are dropped for Russian only (`untrustedFormTags`); in Polish the tag sits on 13,468 real adjective tables.
- **Letters first.** `в`, `к`, `с` opened with "the Nth letter of the alphabet", and `и`, `а`, `о`, `я` with "the name of the Cyrillic letter …". Letter entries (`source_pos = character`), and one-letter nouns whose first sense names a letter, now rank after the word's other entries. This also changes 12 Polish and 36 German forms (`w`, `z`, `o`).

### Compounds

Written as one word, with the linking vowels `-о-` (1,129 etymologies), `-е-` (226) and `-и-` (100). 2,254 lemmas have a compound or affix etymology with two or more stems. Wiktionary lists the common compounds (`самолёт`, `водопровод`), but formal and technical text makes up new ones (`разновидовых`, `бактериородопсина`, `нефтегазовый`), so splitting goes **on** (user decision). Russian modifiers often lose their last vowel or soft sign before the linker (`земл-е-делие` from `земля`, `нефт-е-газ` from `нефть`), and Wiktionary has combining-form entries for many (`нефте-`, `водо-`, `энерго-`). Splitting needs both, measured with the segments benchmark.

### Discontinuous verbs

Not relevant: Russian verb prefixes are inseparable (`выйти`, never `идти … вы`).

### Phrases

- 4,059 multi-word lemmas (not form-of): 1,935 nouns, 473 adverbs, 447 names, 398 phrases, 285 verbs, 143 interjections, 140 proverbs.
- **Nominal phrases inflect every word** (`железная дорога` → `железной дороги`). 2,403 multi-word lemmas have declension tables with multi-word forms, so these match through their own rows.
- **Verb idioms have no tables.** 0 of 285 have conjugated multi-word forms. They only match through the verb-inflection rule (`сошёл с ума` for `сойти с ума`).
- **Word order is free.** The verb can follow the rest (`с ума сошёл`), and short words come between (`имею это в виду`).
- **Negation changes case.** A direct object goes to the genitive (`иметь значение` → `не имеет значения`), so the object no longer matches the phrase's own form. Polish does the same (`mieć znaczenie` → `nie ma znaczenia`). Done (iteration 3): when `не`/`nie` comes before the phrase's verb, the phrase's other words may match any form of themselves.
- **Commas in compound conjunctions.** Wiktionary writes 16 of them, sometimes with the comma (`благодаря тому, что`) and sometimes without (`после того как`). Text usually writes `после того, как`. Done (iteration 2): a comma may stand before the last word of a conjunction of three or more words.

### Reflexives and clitics

The reflexive is the suffix `-ся`, so no pronoun stands for it. 33 multi-word lemmas contain `себя`/`себе`/`собой` (`чувствовать себя как дома`, `покончить с собой`). In these the pronoun is fixed by the phrase's own construction, so no reflexive setting is needed. Only the verb inflects.

### Data

- 517 senses are `abbreviation of` / `initialism of` / `clipping of`, mostly with a period (`ул.`, `ж. д.`).
- 74 senses start with a case-government parent (`[with accusative]`, `[with prepositional]`; preposition entries). That's a usage note, not junk.
- 32 literal pointers (`Used other than figuratively or idiomatically: see …`), already dropped by `dropLiteralPointers` when the parts are shown.
- 5,070 form-of targets don't resolve to an entry. Of a sample of 4,140: 80% point to words whose only senses are archaic, which the importer drops on purpose (`брегах` → `брег`); 15% point to pages Wiktionary doesn't have (`одушевлённый` → `одушевить`); 5% point to an old spelling that is itself only a pointer (`прикащикъ` → `прикащик`). None is an importer bug.
- `у` opened with the noun "Wu (language)", ahead of the preposition. Fixed: prepositions are now grammar-file entries, which rank first.

## Phrase types

Sample: 300 multi-word or hyphenated entries (`/tmp` working set; not in the repo). 200 come from the 465 whose words all occur, as some form, in one corpus sentence; 100 are random from the other 4,478. Types are assigned by script from part of speech and shape, with the rules below. Fit no type: 0 of 300, and 2 of the 4,943 in the whole population.

| Type | Sample (300) | Population (4,943) | Quota |
|---|---|---|---|
| fixed | 98 | 593 | 70 |
| nominal | 83 | 2,505 | 60 |
| hyphenated | 62 | 920 | 50 |
| clause | 29 | 550 | 40 |
| verb-idiom | 20 | 324 | 70 (over-weighted: the rule most likely to fail, and 7% of the sample) |
| abbreviation | 8 | 49 | 10 |

### fixed

- **Membership:** a multi-word ADV, ADP, CCONJ, SCONJ or PART entry; a PRON or DET with no inflected multi-word form; or an X `phrase` starting with a preposition (`в лицо`, `от имени`). Examples: `так как`, `в том числе`, `по крайней мере`, `после того как`, `во время`, `вряд ли`, `всё равно`, `то есть`.
- **Variants:** `plain` (mid-sentence), `sentence-start` (first word capitalised), `comma` (only for conjunctions ending in `как`/`что`/`чтобы`/`если`/`когда`: written with the comma text uses, `после того, как`).
- **Hard negatives:** the same words in a row with a literal meaning (`так, как он хотел` "the way he wanted" against `так как` "because"; `всё равно нулю` "equal to zero"). The same words in one clause but not adjacent.

### nominal

- **Membership:** a multi-word NOUN, PROPN, NUM or ADJ entry, or a PRON or DET with inflected multi-word forms: adjective + noun, noun + genitive noun, a numeral, `тот же`. Examples: `железная дорога`, `точка зрения`, `уголовное дело`, `Нижний Новгород`, `Новый год`, `тот же`.
- **Variants:** `nominative`, `oblique` (another case, as the sentence requires: `в Нижнем Новгороде`, `с точки зрения`), `plural` where the phrase has a plural.
- **Hard negatives:** the phrase's words in one sentence, not forming the phrase (`с этой точки было плохо видно, но зрение у него хорошее`). An adjective of the phrase with another noun (`железная воля`).

### verb-idiom

- **Membership:** a multi-word VERB entry, or an X `phrase` entry whose first or last word is a verb lemma. Examples: `сойти с ума`, `иметь в виду`, `дать слово`, `выйти из строя`, `сыграть в ящик`, `проливать свет`.
- **Variants:** `inflected` (past or present tense, verb next to the rest), `gap` (one or two words between the verb and the rest: `имею это в виду`), `verb-after` (the rest first: `с ума сошёл`), `negated` (with `не`; the object in the genitive where Russian puts it there: `не имеет значения`).
- **Hard negatives:** the verb in its ordinary sense, with the rest absent (`он сошёл с поезда`). The rest in its literal sense with another verb, or in another clause (`он сказал слово, и ему дали чаю`).

### hyphenated

- **Membership:** a lemma with an inner hyphen between letters and no space; checked first (`что-то`, `кто-нибудь`, `по-русски`, `во-первых`, `юго-запад`, `штаб-квартира`, `научно-технический`, `всё-таки`, `вот-вот`).
- **Variants:** `first-half` (clicked word is the part before the hyphen), `second-half` (the part after), `inflected` (where it inflects: `кого-то`, `чего-нибудь`, `штаб-квартиры`).
- **Hard negatives:** the halves as separate words in one sentence (`Что он сказал, то и сделал`; `кто пришёл, тот и прав`).

### clause

- **Membership:** an INTJ entry, or any other X `phrase`/`proverb`: mostly complete utterances (`я не знаю`, `который час`, `большое спасибо`, `вот это да`, `надо же`, `как бы не так`, `да ну`, `с праздником`).
- **Variants:** `own-sentence` (the utterance alone, as dialogue), `in-dialogue` (followed by more speech after a comma or dash).
- **Hard negatives:** the same words inside a longer clause with their literal meaning (`вот как это работает`, against `вот как` "oh really"; `что это значит`).

### abbreviation

- **Membership:** a multi-word entry made of abbreviations with periods; checked second (`ж. д.`, `и т. п.`, `л. с.`).
- **Variants:** `spaced` (`и т. п.`), `unspaced` (`и т.п.`).
- **Hard negatives:** none meaningful; every case is a positive.

## Settings

| Setting | Value | Why |
|---|---|---|
| Stress marks | dropped in `lookupKey` for Cyrillic words | 86% of forms are stressed, and text isn't |
| `stressedLemmas` | on | the reader sees `соба́ка`; matching still ignores the marks |
| `optionalLetters` | `ё` → `е` | 80k forms with `ё`; most text writes `е` |
| `untrustedFormTags` | `error-unrecognized-form` | 29 misparsed tables; per language, because Polish depends on the tag |
| Clause bracket (`BRACKET`) | off | Russian has no verb-final bracket |
| Separable verbs (`SEPARABLE`) | off | prefixes are inseparable |
| Reflexive pronouns | none | `-ся` is part of the verb; `себя` in phrases is fixed |
| Maximum gap | 1 (current default), to measure | For multi-word verb entries only: how many words may stand between the verb and the rest (`имею это в виду` has one, `наводила на Передонова страх` has two). Free word order suggests 2; a larger gap matches more chance co-occurrences |
| Clause-ending conjunctions | not used | only for the German bracket |
| Compound linkers | `о`, `е`, `и`, and none, to build | see Compounds |
| Comma before conjunction inside a phrase | planned: a comma may come before `как`, `что`, `чтобы`, `если`, `когда`, `пока` inside a phrase | `после того, как`; see Phrases |
| Hyphenated words | planned: with context, a hyphen half is looked up as the whole word | see Tokens |
| Negation | `ru` and `pl` (iteration 3): with a negated verb, a verb phrase's other words may be in any form | see Phrases |

## Benchmark checks

A one-time check that the context benchmark measures what it should, as the add-language skill asks before trusting it. Nothing follows from it for Russian.

- With the German clause bracket switched off, `Er ist an der Uni` matches `an sein`, and `eval/context-bench.ts` reports the case broken, so the benchmark catches a known regression.
- First numbers on the 1,288 Wiktionary example cases, before any lookup rule changes: hyphenated 0% (303), verb-idiom 82.8% (99), clause 88.1% (177), nominal 95.9% (315), fixed 96.7% (391). These cases are human-written but positives only.

## Iteration log

| # | Change | Context bench (positives / false positives) | Notes |
|---|---|---|---|
| 0 | Import fixes above (baseline, run `base`) | 71.6% / 11.1% (2,076 pos, 252 neg) | By type, recall / FP: hyphenated 0% / 0%, abbreviation 57.1% / –, verb-idiom 71.3% / 8.2%, clause 89.5% / 44.4%, fixed 93.8% / 34.4%, nominal 95.5% / 1.7%. Worst variants: every hyphenated variant 0%, `abbreviation/unspaced` 0% (9), `fixed/comma` 33% (3), `verb-idiom/gap` 38.1%. Segments: 833 compounds, 100% no-split (compounds off). Judge (Haiku, 1,000 items, run `eval/out/ru/base`): understood 89.8% (frequent 91%, random 87%), junk senses 4.4%, marginal 3.1%, fits in first group 93%, as first sense 78%. Causes of misses: fixed_phrase 41, form_gloss 21, missing_word 17, missing_sense 11. |
| 1 | Hyphen-joined words (`HYPHEN_WORDS` in `context.ts`). With context, a clicked part of `что-нибудь` looks up the whole word: the longest hyphen-joined run around it that is a form, as written or with its parts as lemmas (`одним-единственным` → `один-единственный`). It falls back to the part's hyphen affix (`-то`, `-ка`, `экс-`), but only for affixes that start or end at least 3 hyphenated dictionary forms, and only beside dictionary words (not `-е` in `1990-е`). A phrase may not start or end inside a hyphenated word (`кто-то есть` isn't `то есть`), though inside one a hyphen may stand for a space (`треш-стримеров` for `треш стример`). The client doesn't send which occurrence was clicked, so when the word also stands alone in the sentence, nothing is added. | 91.4% / 11.1% (run `i1-hyphen`: 410 fixed, 0 broken). Hyphenated 0% → 97.7%, fixed 93.8% → 97.3%, nominal 95.5% → 96.4%, clause 89.5% → 90.6%. | Corpus diff: 190 popovers changed, rated by Haiku as 184 better, 5 same and 1 worse. The worse one is `Ай-ай`, where Wiktionary's only entry is the lemur, a data gap. Earlier drafts were worse on `восток` standing alone in a sentence that also has `северо-восток` (occurrence ambiguity), on `Та-ак` (suffix `-ак`) and on `1990-е` (`-е`), all fixed before acceptance. Lost on purpose: `мега-`, `алко-` and `франко-`, which no hyphenated form uses. The misses left are ambiguous sentences (`по контракту … по-немецки`, `Не-а … не буду`) and two data gaps (`всех-всех`, `всего-всего`). A click offset from the client would resolve the ambiguity. Code review (Haiku): memoized the form queries per lookup. Declined: the cap of 32 spellings (it only drops readings for very homonymous parts) and tie-breaking between overlapping runs. |
| 2 | Comma before the last word of a long conjunction, for all languages (`splitConjunction` in `context.ts`). Only a comma may stand there, the phrase must have at least 3 words and end in a word that can be a conjunction, and it must not be an interjection. Wiktionary writes `до тех пор пока` and `после того как`; texts write `до тех пор, пока`. Two-word phrases are left out because there the comma changes the meaning (`так, как` "the way that" vs `так как` "because"; `так, что`; Polish `tak, że`). | 91.5% / 11.1% (run `i2-comma`, 2,075 pos after removing the graded-out case: 3 fixed, 0 broken). Fixed 97.3% → 97.8%. Segments unchanged. | Corpus diff: ru has 7 changes (`до тех пор, пока`), all rated better by Haiku. de and pl have 0 changes: their dictionary forms already write the comma (`albo tak, albo siak`, `april, april`), so the rule is neutral there. Missed on purpose: `потому, что` and `прежде, чем`. Code review (Haiku): interjections are now excluded. Known risks: `conjunction` is read from the dictionary, not the sentence, so a 3-word entry ending in `что` would also match a relative `что` (none exists today); a verb phrase whose verb stands apart can't be split, because its rest must stay in one clause; hyphen-joined parts count as words in the length gate. |
| 3 | Negated verb phrases, ru and pl (`NEGATIONS` in `context.ts`: `не`, `nie`). When a phrase doesn't match as written, it is tried again with its other words in any form, and kept only if the verb that match uses is negated: right after the negation (`не имеет значения`), or after it and one helper verb (`не будет иметь значения`, `не могу дать слова`). A negation right before a verb that follows the rest doesn't count toward the gap (`слова никому не давал`). | 91.7% / 11.1% (run `i3-neg`: 3 fixed, 0 broken). `verb-idiom/negated` 73% → 76.2%. | Corpus diff: ru has 2 changes (negated `обращать внимание` with its object in the genitive), both rated better. pl has 0 (no negated idiom in its corpus). Code review (Haiku) found that the first draft decided negation per clause, so `не брал денег и брал примеры` would have matched `брать пример`. Now it's decided at the match's own verb, with a test. Helper-verb negation came from the same review. Benchmark noise found here: 5 `verb-idiom` cases name the other aspect of the verb in the sentence (`схожу` → case expects `сойти с ума`, the dictionary rightly gives `сходить с ума`; likewise `опускать руки`, `изобретать велосипед`, `давать слово`, `оставаться верным`). They count as misses. They are left in the set rather than edited to fit. |
| 4 | Two words between a verb and the rest of its phrase, Russian only (`MAX_GAPS` in `context.ts`; the default `MAX_GAP` stays 1). When the clause has the verb twice, the nearest one counts, except in German, where the verb must come first. | 93.0% / 11.5% (run `i4-gap2`: 28 fixed, 1 broken). `verb-idiom` 72% → 79.8%, `verb-idiom/gap` 37.1% → 71%, `negated` 76.2% → 81%. FP 8.2% → 9.2%. | The one broken case, `Учитель дал нам новое слово`, is literal but has the same shape as the positive `дашь мне честное слово`, so no rule could separate them. Corpus diff: ru has 4 changes (negated `обращать внимание` with two words between the verb and the object), all rated better. pl and de have 0. Tried for Polish too: gap 2 changed 7 Polish sentences, 4 better (`stanął na czele`, `trzymać taki oddział w ryzach`) and 3 worse (`jest to się w dupie`, `jesteśmy u Mikołaja w domu`, `znamy jakiś promil danej` read as `dać znać`), so Polish stays at 1. Code review (Haiku) found that the first verb in the clause was used instead of the nearest; that is fixed, with a test. Kept on purpose: `не` doesn't count toward the gap, so a negated verb can have three words before it (`слово ему тогда не дал`, which can be the idiom "give the floor"). |
| – | Judge after iterations 1–4 (same 1,000 items as the baseline; run `eval/out/ru/i4-gap2/judge`) | – | Understood 89.8% → 90.3% (frequent 91% → 91.7%, random 87% unchanged), junk 4.4% and marginal 3.1% unchanged, first sense fits 78% → 78.4%. 13 popovers changed: 5 understood better, 0 worse. fixed_phrase misses 41 → 38. |
| 5 | Compound splitting for Russian, as a stem strategy (`CompoundRules` in `compounds.ts`; `stemCompound` in `queries.ts`). It runs only for words without an entry. Modifiers: a combining-form entry joined plainly (`фото|печать`, `кибер|кабан`), a stem plus `о`/`е` (`лес|о|насаждение`, `нефт|е|газовый`; the stem is the lemma minus its ending, `stemEndings`), or a spelled-out number (`восьми|метровый` → `восемь`). Heads: a non-verb, non-name form of at least 4 letters (DET allowed: Wiktionary tags `подобный` DET), or a participle. Never split: capitalised words (mostly names); compounds of 3 or more parts; word-forming prefixes, i.e. prefix entries where at least 20% of the lemmas they begin are verbs (`при-`, `под-`, `пере-`; read from the data, so `фото-`, `контр-` and `анти-` stay); and words that end like a verb (3-letter endings that are at least 90% verb forms), unless a combining form joins a dictionary-form head (`аудио|запись`). The linker `и` was dropped: it occurs in 1 of 833 benchmark compounds and misread `дож|и|мать`. The segments benchmark now reports precision: right parts among words that split. A word that doesn't split isn't a miss, because every case has its own entry and lookups never split such words. | Context benchmark unchanged (93.0% / 11.5%). Segments: 833 compounds, 506 split, precision 89.1% (exact 46.6%, combining-form 6%, linker notation differs 1.9%); no splits before. German unchanged (78.7% exact, precision 86.4%). | Corpus diff: 133 popovers changed, all empty before. Rated 108 better, 24 worse and 1 same, by Haiku (150) and by me for the 27 that changed between rounds. The worse ones: 5 split correctly but the prefix entry's first sense misfits (`пол-` "half past", `авто-` "self-"); about 17 involve combining forms English Wiktionary lacks (`транс|плантация`, `пато-`, `корона|граф`, `космо-`); 2 are wrong analyses (`басовитый`, `миллионнике`). Code review (Haiku) found: inner splits skipped the head checks, and the verb guard blocked `аудиозапись`. It also found names leaking into heads, a hand-grown reflexive list (now derived as adjective ending + `ся`), first-lookup latency of about 1.5 s (the indexes are now built at startup in `Dictionaries.ts`), and a stem cache keyed without its rules. All are fixed. Prefix splitting was dropped at the user's request (`про|при|е|тарных`). |
| – | Judge after iteration 5 (same 1,000 items; run `eval/out/ru/i5-stems/judge`) | – | Understood 90.3% → 90.4%, junk 4.4% → 4.3%. 3 popovers changed (unknown compounds in the sample), all 3 understood better. |
| – | Benchmark fix, not a lookup change: `context-bench.ts` now clicks the word the client sends (`clickedWord`, the segment containing `word`, as the extension's `tokensAt` takes it). It also compares lemmas without spaces after periods (`п.п.` = `п. п.`). Intl.Segmenter keeps `т.д` as one word, so the old cases clicked `т`, which no reader can do. | 93.4% / 11.5% (run `bench-click`: 8 fixed, 0 broken). `abbreviation` 57.1% → 95.2%, `abbreviation/unspaced` 0% → 88.9%. | The server already handled these, so the benchmark had been testing a click that doesn't exist. A first draft matched `по` inside `под` (no lookahead) and broke 21 cases; it was fixed before the run. |
| 6 | Unspaced abbreviations, for all languages (`addUnspacedAbbreviations` in `writer.ts`). Every lemma form with `. ` that ends in `.` is also indexed without the spaces (`ж. д.` → `ж.д.`, `z. B.` → `z.B.`), ranked after real spellings, before the period-less fallback, so `ж.д` reaches it too. Needs a re-import; done for ru, de and pl. | 93.4% / 11.5% (run `i6-abbr`: 1 fixed, 0 broken). `abbreviation` 95.2% → 100%. | Added 21 ru, 50 de and 2 pl forms. Entry counts unchanged. Corpus diff: ru 0, pl 0, de 1 (`s. u.` written unspaced now shows "siehe unten", better). The corpora have few unspaced abbreviations that Wiktionary lacked. Code review (Haiku) found that the first draft also took inflection and form-of rows, which gave table cells bare abbreviation rows (and put `лошадиная сила` before `л. с.`); now lemma rows only. Not needed: non-breaking or doubled spaces after periods (none in the ru, de or pl data). Low and left as is: `Nr. 5.` would also get `Nr.5`. |
| 7 | Verb idioms filed as untyped phrases, for all languages (`phraseIndex` in `context.ts`). An entry tagged `X` with source_pos `phrase` that contains a verb's dictionary form counts as a verb phrase, so its verb may inflect and stand apart (`стелили соломку`, `знал как свои пять пальцев`, `идут на уступки`). Proverbs are excluded, because they're quoted as they stand. In German such phrases keep their own order and skip the bracket rule, which only verb entries follow (`verbEntry`). Affects 44 ru, 45 pl and 82 de entries. | 94.2% / 11.9% (run `i7-xverb`: 15 fixed, 1 broken). `verb-idiom` 79.8% → 83.9% (inflected 83.3% → 88.9%, negated 81% → 85.7%, verb-after 73.8% → 78.5%, gap 71% → 75.8%). FP 9.2% → 10.2%. | The broken case is the literal `стелил соломку на пол` (same words, straw on a floor), which no rule can separate. Corpus diff: ru has 1 change (`идти на уступки` in the past tense now shows "make concessions", better); de and pl have 0. Code review (Haiku) found that the first draft put German phrasebook lines under the bracket rule and lost `Wie heißen Sie eigentlich?`; that is fixed, with a test. Not a bug: negated idioms still match (`не стелили соломку` is the idiom, negated). Known edges: phrasebook entries now match related sentences (`Wie heißt sie?` → `wie heißen Sie`; `Я хочу ничего не знать` → `я хочу знать`). Verb-idiom misses left: about 30 are benchmark noise (the other aspect, inflected proverbs, a lemma word missing from the sentence), about 18 need free word order (`Свой талант он в землю зарыл`, `Пизды ему дали`), which was rejected because it's the shape of the hard negatives, and about 5 are data gaps (`долбятся`). |

Benchmark set (`eval/gold/ru/context.jsonl`, 2,327 cases): 1,066 Haiku-generated cases from 300 phrases, blind-verified by Haiku with 97.6% agreement (1,040 kept, no variant above 20% disagreement, one later removed in grading), plus 1,288 Wiktionary example sentences (positives only).

## Coverage gaps (patch by hand later)

Words that English Wiktionary lacks entirely, found while checking compounds. The user will patch these by hand. The hill-climb stays on general rules.

- `проприетарный` "proprietary": appears nowhere in the 2026-11-01 dump, not even as a translation.
- Combining forms missing as entries, which make compounds misread: `пато-`, `токсико-`, `ауто-`, `астро-`, `космо-`, `грави-`, `хемио-`, `гало-`.

