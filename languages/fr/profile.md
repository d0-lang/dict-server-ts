# French (fr_en)

Tier: **Model only, unreviewed.** No reader of French has checked this profile, the grammar file or any sample. Every point below rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-15 and all three gates pass (see Gates), with thin margins. No tier-2 work, no context benchmark (`gold/`).

Data: `data/raw/fr.jsonl`, filtered from the 2026-11-01 dump (404,127 lines). `data/fr_en.sqlite` has 101,521 entries, about as many as Polish and German.

Corpus: `../corpus/fr`, 30 texts, 83,941 words, gathered 2026-11-15.
- **Spoken:** 46,166 words in 15 YouTube videos (auto-captions repaired by Haiku), 7 genres (food, tech, gaming, politics interviews, lifestyle, science, travel), at most two per channel. The largest text is 12% of the spoken words. No history video: both candidates sounded like synthetic voices.
- **Written:** 37,775 words in 15 texts, 13 genres: 12 fr.wikipedia articles, cut at a section boundary near 3,300 words, and 3 service-public.fr guides. The largest is 9%. No news articles.

## Quirks

### Spelling and headword

- **Apostrophes.** Texts write `'` and `’`. `lookupKey` already reads `’` as `'` (schema v5, from Ukrainian), so nothing to do.
- **Accents, œ.** The corpus writes accented capitals (`État`) and `œ` (`cœur`, 51 tokens, against 13 `oe`, all real `oe` words: `coenzyme`). No folding needed.
- **Headword: gender labels, not articles.** 51,154 of 54,020 nouns carry a gender (`m`, `f`, `m/f`, plus `pl` for plural-only). An article in the lemma would hide the gender exactly where a learner needs it: `le` and `la` both become `l'` before a vowel (`l'arbre`, `l'eau`). So the default labels stay, and `labels.toml` explains `m`, `f`, `m/f` and `pl` for French.

### Tokens

- **Elision.** Articles, pronouns and conjunctions lose their vowel before a vowel and are written onto the next word (`l'homme`, `d'une`, `qu'il`, `n'est`, `s'est`, `jusqu'au`). Chromium's and Bun's segmenters keep both as one word, so the clicked word is `l'homme`. These are 6.0% of the corpus's words (4,935 tokens), and in the plain import 54% of them had no entry. **Fixed:** the new `elision` setting splits a word without an entry of its own after its first apostrophe, when both parts have entries. The popover shows the host word first (`homme`), then the elided word (`l'` "the, le or la before a vowel"), with a segment each (`features/elision.ts`). Words with an entry of their own stay whole (`aujourd'hui`, `d'abord`, `c'est`, `j'ai`). Two kinds of entry don't count as the word's own:
  - entries it reaches only as a form of something else (`qu'il` is a form of `que`, which leaves out `il`);
  - Wiktionary's contraction entries that only name their parts (`qu'on` "que + on", `s'est` "se + est", `d'avoir` "de + avoir").
  A noun made from a clause is split too when its host reads as a verb, and its own entry comes after the split: `j'aime` "a like" opened on the noun, but in running text it is "I like". It is the only such noun in the dump. Nouns whose host isn't a verb stay whole (`presqu'île`, `m'sieur`).
- **Which part opens.** The extension opened the first segment with entries, so `l'homme` opened on "the". The protocol says the client opens on the server's first entry (its `ninakupenda` example). **Fixed in `../extension`** (`firstTab` in `popover/reply.ts`, with a test). The eval's popover text for the judge now lists the opening part first too (`../corpus/eval/popover.ts`).
- **Hyphens.** Hyphen-joined words (`peut-être`, `c'est-à-dire`, `lui-même`, `celui-ci`, `ces jours-là`) are split by the segmenter: `context.hyphenWords`.
- **Sentences over 500 characters.** Wikipedia sentences often run longer, and the extension then sends no sentence, so no phrase can be found (`peu à peu`, `d'une part`, `par rapport à` in three common-word failures, which the API answers right).

### Coverage

94.2% of corpus words had an entry in the plain import (`r0`), 97.5% at the end of tier 1 (`r5`): spoken 98.3%, written 96.5%. What's left without one is mostly names (`Linux`, `Samsung`, `Cosette`, `Desgrange`), chemistry and maths (`CO2`, `H2O`, `NADPH`, `2n`), Roman centuries (`XIXe`, `XXe`, `II`) and anglicisms (`gameplay`, `hack`).

Two importer gaps were found here, both fixed:
- **Plurals.** French nouns and adjectives have no inflection tables. Their plurals are on the headword line, which the importer ignored for words without a table, and English Wiktionary often has no page for a regular plural, or one with only a verb form (`structures`, `réformes`). 300 corpus tokens reached the verb and missed the noun (`protons`, `combats`, `programmes`). **Fixed:** `import.headwordInflections`.
- **Auxiliary rows.** Conjugation tables write a compound tense's row as its auxiliary alone (`avoir`, `ayant`, tagged `multiword-construction`) where a verb takes either auxiliary, so `avoir` and `ayant` reached `passer`, `partir`, `tomber` and 250 other verbs. **Fixed** in the importer for every language: German has only dashes in such rows, so nothing changes there.

### Grammar words

`grammar.tsv`, 269 lines (155 before issue #54), written without a reader. The plain import's popovers for the commonest words were mostly fine (Wiktionary's French is good), but these needed lines:
- **articles and contractions:** `la` and `les` opened on the pronoun, `une` on "front page", `des`, `du`, `au` and `aux` on the bare `de` or `à` ("to"), not "of the" or "some". `au` and `aux` also mean "with" (`riz aux légumes`).
- **elided forms:** `l'`, `d'`, `qu'`, `j'`, `n'`, `s'`, `c'`, `m'`, `t'`, `jusqu'`, `lorsqu'`, `puisqu'`.
- **possessives and personal pronouns,** with the impersonal `il` (`il y a`, `il faut`).
- **être and avoir:** `est` opened on "east", `a` on the letter, `été` on "summer", `ayant` on "haver", `fut` on `fût`. Their common forms are `AUX` lines ("is", "has", "been"), which come first and leave Wiktionary's other entries after them.
- **broken or misleading glosses:** `dès` ("Audio (France (Vosges)): (file)"), `pas` "step" first, `son` "sound" first, `quelques` "some (singular)", `parce` "only used in parce que", `bah` "No.", `voire` "truly", `donc`, `ainsi` (`ainsi que`), `encore` "also", `-là` "always used with ce".
- **irregular verb forms** (2026-11-23, issue #54): `va` showed only `aller` (and `vader`, a Louisiana verb), with nothing to say which form it is. The commonest forms of aller, faire, pouvoir, vouloir, devoir, savoir, falloir, valoir, venir, tenir, voir, vivre, dire, prendre and mettre, and the rest of être's and avoir's, are lines of their own ("goes, is going", "can", "would like") that point at their verb (`→ aller`). The verb still shows after the line; a `VERB` line replaces Wiktionary's other verbs for the word (`vader`, `dit` "surname", `ailler` for `aille`). `vienne` was left out: it took first place from `Vienne`, the city. A participle line (`pris`, `mis`, `dû`) no longer ends a declined form's chain: `prise` still reaches `prendre` (`prise en compte`).
- **units after numbers** (`g`, `kg`, `km`, `cm`, `mm`, `ml`, `cl`): `g` gave "abbreviation of j'ai".
- **set phrases English Wiktionary lacks:** `plus tôt`, `en un coup`, `l'ensemble de`, `au sens large` (Wiktionary's "in every sense of the word" is wrong), `aller à l'encontre de`, `masse salariale`, `faux bourdon`.

Order matters: `en ADP` comes before `en PRON`, and `point ADV` "not" and `or CCONJ` were left out, so that `point` the noun and `or` "gold" stay first.

A listed word keeps none of Wiktionary's form-of links to another listed word: `des` was a form of `de` and `un`, `l'` of `la` and `le`, and showed those words' lines after its own. **Fixed** in the importer for every language (`replaceGrammarWords`), except a link that spells the other word without its optional letters (Russian `все` for `всё`). This was an open question from Japanese (`unsere` → `unser`).

### Structure

- **Contractions in phrases.** `de` and `à` merge with the article after them (`du`, `des`, `au`, `aux`), and `que` and `de` are elided before a vowel. A phrase ending in one of them didn't match: `à partir du`, `parce qu'il`, `afin d'éviter`, `en train d'essayer`, `grâce au`. **Fixed:** the new `context.contractions` setting, read for a phrase's last word only, so `du nouveau` isn't `de nouveau`. Spanish (`del`, `al`), Italian (`della`) and Portuguese (`do`, `da`) work the same way.
- **Elided words in verb phrases.** A verb phrase whose verb stands apart needs a content word in the rest. With elision, `l'encontre` and `l'air` have no entry of their own, so `va ainsi à l'encontre de` and `a toujours l'air` found nothing. **Fixed:** an elided word counts as content when its host word does.
- **Participles agree.** Past participles agree like adjectives, but verb tables list only the masculine singular. **Fixed** with `import.participleDeclension` (`e`, `s`, `es`). Wiktionary lists many participles as adjectives or nouns with other senses (`adopté` "male adoptee", `donné` "cheap"), whose forms then missed the verb (`adoptés` "adopted"). So the new `sharedWithParticiple` lets the participle's own entries share a form, while another word's still blocks it. Without it, `plu` (of `plaire`) + `s` took 464 popovers of `plus`.
- **Reflexive verbs.** Wiktionary has pages for common pronominal verbs (`se souvenir`) and files the rest as `reflexive` senses (`appeler`: "to be called"). `import.reflexive` needs "reflexive with se" glosses, which French lacks, so it stays off. Tier 2.
- **Not relevant:** compounds are written apart or hyphenated (no splitting). Negation (`ne ... pas`) doesn't change the object's case beyond `de` (`pas de pain`), which the grammar file explains. No verb bracket, no separable particles.

### What the general rules do here

- **Comparatives:** French forms them with `plus`, so they need no entries. The irregular ones (`meilleur`, `mieux`, `pire`) have entries of their own.
- **Hyphen affixes:** `-là` and `-ci` (`ces articles-là`) are particles in the grammar file. The hyphen feature skipped grammar-file lines for an affix, keeping them for endings after numbers (`3-го`), so now it skips only `X` lines. No other language has a grammar-file affix line other than `X`.
- **Abbreviations:** `etc.` has an entry. `M.` (Monsieur) is split at its period like everywhere.

## Coverage gaps (hand-patch list)

Words and senses English Wiktionary lacks that the judge found, for a person to check:
- **words:** `rejouabilité`, `metroidvania`, `biosynthétiser`, `photoinduit`, `mésophylle`, `holoarctique`, `agrimonétaire`, `QTE`, `MW`, `SF`, `cf`.
- **senses:** `point` "item, issue" (as a separate sense), `largement` "by far" (now a grammar line), `ensemble` "the whole", `temps` in `un temps` "for a while", `compte` in `unité de compte`, `droit` "law" (the body of law), `service` "department", `évident` in `c'est pas évident` "not easy", `fresque` "epic", `littéralement` as an intensifier, `cool` (fixed by a grammar line), `garniture` "garnish", `gruau` "fine wheat flour", `cordon littoral`, `hôtel de ville` (as the phrase), `assurance maladie`, `droits d'auteur`, `flagrant délit`, `de part et d'autre` "on each side".

## Log

All runs are in `../corpus/eval/out/fr/` on the same 2,200 items (sample from `r0`). Judge: Haiku, `--effort medium`, `--concurrency 10`.

| Run | Change | Common grammar | Common content | Random |
|---|---|---|---|---|
| r0 | plain import | 88.7% | 89.2% | 80.7% |
| r1 | elision split, `hyphenWords`, grammar file (123 lines), listed words drop links to other listed words | 92.7% | 90.1% | 86.4% |
| r2 | contractions in phrases, contraction entries that name their parts split, auxiliary rows dropped, 14 grammar lines | 95.3% | 92.7% | 86.7% |
| r3 | `headwordInflections`, `-là` kept, `encore`, `où`, `cool`, `plus tôt` | 96.1% | 92.9% | 87.4% |
| r4 | elided content words in verb phrases, 7 phrase lines, `là`, `largement`, 3 false positives | 97.7% | 92.9% | 87.4% |
| r5 | `participleDeclension` with `sharedWithParticiple` | 97.7% | 93.1% | 87.7% |
| r6 | neighbour hints (`verbAfter`, `verbBeforeJoined`, `noVerbAfter`, `participleEndings`), participles reach their verb (`partie`, `arrivée`), phrases from an elided word's host, pointer-only verb entries and acronyms under lowercase words dropped, `il y a`, `le temps de` | **97.6%** | **93.6%** | **88.0%** |

r6 is measured against main re-collected the same day (97.7% / 92.9% / 87.9%, which has the elision fixes made after r5). Senses flagged as junk fell from 4.2% to 3.3%.

Judging r0 cost $0.70 (88 batches, about 30 minutes, with 8 retries). Later runs only judged changed popovers (14, 3, 3, 1 and 2 batches).

Classified diffs of the gate sample (Haiku, words per verdict): r0→r1 233 better, 27 worse; r1→r2 32 better, 2 worse; r2→r3 19 better, 11 worse; r3→r4 9 better, 0 worse; r4→r5 19 better, 4 worse; main→r6 38 better, 33 worse. The worse ones were read. Most rate the old segment order (fixed after r1) or contradict their own reasoning ("judged worse … so this is better"). What stays:
- **the verb before the participle's own noun or adjective:** `pavés` (a salmon `pavé`) and `déglinguées` now open on the verb (r5).
- **ties between an adjective and a noun:** `vidéos` opens on the adjective "video", `marines` on the noun "navy" (r3, from the headword plurals).
- **a rare second reading:** `gens` gains `gent` "folk", `étés` "summers" gains `être` (r3, r5).
- **r6's 33 worse:** 14 rate the verb now first where the sentence has the verb (`on réserve`, `il court`, `je reste`, `sont prises`), 8 an order change below the first entry, 4 an acronym or the letter `à` gone, and 3 a phrase that fits (`tels qu'un` finds `tel que`). The 4 that stay are false phrase matches, now also from an elided word's host or a merged word: `c'est à la fin` finds `être à`, `que d'autres` `que de`, `jusqu'au départ` `au départ`, `vous n'y avez pas joué` `y avoir` (and in the full diff `l'histoire de la baguette` finds `histoire de`). The same phrases already matched the text written apart.
- **an adjective keeps its place before the participle's verb:** `j'ai passé` still opens on `passé` "past", `j'ai pris` on `pris` "taken", with the verb second. After `avoir` it could go first; the hint doesn't tell `avoir` from `être`.

Other languages: every corpus was collected through the API on imports from before and after the general importer changes (`data/fr-grammar-before/` against `data/`), and the diffs were read:
- **German:** 59 words. `unsere`, `unserer`, `unserem`, `unseren`, `unseres` and `keinem` show only their own line, without `unser` or `keines` after it. `einigen` drops `einige` and keeps its verb.
- **Polish:** 482 words. `tej`, `tą`, `tę`, `tymi` drop the lines for `ta` (`tym`'s change is further down the popover).
- **Ukrainian:** 57 words. `такі` drops `такий`.
- **Japanese:** 27 words. `て` inside `てきて` and `てもらった` no longer opens on `ている`, which didn't fit (`grammarIds` already meant `て` not to be `ている`). Its part shows no entries of its own, but they lead the popover.
- **Russian:** 0 words. The first run lost `всё` for `все` and `всём` for `всем`, the same words with the ё written as е. A link that spells the other word with its `optionalLetters` written plainly now stays.

The auxiliary-row rule changes nothing in German (its one-word rows of that kind are dashes). The `-` affix rule and the French settings change no other language.

## Gates

| Gate | Needs | r0 | r5 |
|---|---|---|---|
| Common grammar words | 97.5% | 88.7% (89.6%) | **97.7%** of 613, 14 failing |
| Common content words | 92.5% | 89.2% (89.3%) | **93.1%** of 578, 40 failing |
| Random words | 87.5% | 80.7% (89.4%) | **87.7%** of 978 (90.1% without 26 missing words) |
| Common words without an entry (no gate) | | 45 | 1 |
| Judge: overall understood | | 82.2% | 90.7% |

In brackets: without the judge's `missing_word` misses. The margins are a fraction of the judge's noise (about a point), and the grammar gate leans on 3 false positives: without them it would be 97.2%.

What still fails among the common grammar words: long sentences the extension sends without context (`peu à peu`, `d'une part`, `par rapport à`), phrases the matcher can't place (`faire pour`, `pour parler franchement`, `un temps`), senses Wiktionary lacks (`compte`, `droit`, `service`, `beau` in `faire le beau`), and `donné` "given" behind the adjective "cheap".

### False positives

In `../corpus/eval/out/fr/false-positives.jsonl`:
- `point` in `négocier ce point`: English "point" also means an item under discussion, and the popover gives "point".
- `littéralement` as an intensifier: English "literally" is used the same way.
- `l'Assemblée`: "the Assembly" names the National Assembly in context.

### Not counted, with a doubtful label

- `qu'en` (common grammar) and `Réveillon` (random) are labelled names. Counted as failures, the gates would be 97.6% and 87.6%: both still pass.
- `monte` is labelled foreign.

## Tier 2

Not started. Candidates:
- phrases whose last word is elided onto a word other than `de` or `que`;
- pronominal verbs (`s'inscrire dans`, `s'effacer`);
- ranking a verb form before a rare lemma noun where no neighbour decides (r6 covers the word after a subject pronoun, a determiner or an auxiliary), and telling `avoir` from `être` before a participle;
- phrase entries that match ordinary text (`être à`, `histoire de`, `que de`, `à la`);
- the 500-character sentence limit in the extension.
