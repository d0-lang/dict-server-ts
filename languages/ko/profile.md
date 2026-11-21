# Korean (ko_en)

Tier: **Model only, unreviewed. Tier 1 does not pass.** No reader of Korean has checked this profile, the grammar file or any sample: every point rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-20 and stopped short of the gates on data, not lookups: English Wiktionary has no usable entry for about a fifth of the words a reader meets (see Gates). No tier-2 work.

Data: `data/raw/ko.jsonl`, filtered from the 2026-11-01 dump: 64,457 lines.
- 39,314 headwords in Hangul and 22,386 in hanja.
- 16,882 lines are form-of only: hanja forms, dialect forms, conjugated forms.
- Parts of speech: 41,336 nouns, 10,300 hanja characters, 3,997 verbs, 1,451 adjectives, 1,004 adverbs. Particles and endings are 136 `particle` and 569 `suffix` lines, written with hyphens (`-에서`, `-었-`).
- `data/ko_en.sqlite` has 40,499 entries (35,690 lemmas) and 414,786 forms. Verbs and adjectives have Wiktionary's conjugation tables (`먹다`: `먹어`, `먹었습니다`), so a written form often finds its verb.

Corpus: `../corpus/ko`, gathered 2026-11-20. Words are counted with Kiwi's units (see Eval).
- **Spoken:** 31,819 words in 15 YouTube videos, auto-captions repaired by Haiku. There are 9 genres: tech, economy, vlog, health, science, history, a talk (세바시), literature and food. The largest video is 15.5% of the spoken words. A 16th video (a lecture on Demian) was dropped: its captions were garbled past repair, and every browser/API difference came from it.
- **Written:** 39,177 words in 13 ko.wikipedia articles: 세종, 임진왜란, 광합성, 반도체, 판소리, 한글, 김치, 커피, 태권도, 한강의 기적, 당뇨병, 호랑이, 대한민국의 저출산. The largest is 12.3%. The register is all encyclopedic: there is no news, blog or guide.

## Words: an eojeol is a word with its particles and endings

Korean writes spaces, but between eojeols: `학교에서` is `학교` + `-에서`, `먹었습니다` is `먹` + `-었-` + `-습니다`. The browser's segmenter gives the whole eojeol, so the plain lookup found nothing for half the words (r0: 49.9% of corpus words had an entry). Verb stems fuse with their endings (`했` = `하` + `았`, `갈` = `가` + `ㄹ`), so no table finds every form. Decision: **the analyzer path** (`context.analyzer`, `features/analyzedWords/`), with Kiwi (`kiwi-nlp` 0.25.0, `dictionary = "kiwi"`). Every mechanism below is a setting in `language.toml`; the TypeScript names no language.

- **Fused morphemes:** Kiwi gives each morpheme's base form, and the morphemes of a fused syllable at one place in the text (`했`: `하` and `었`). They are one piece, as written, with each one's base form and its tags joined with `+` (`VV+EP`), which match each part's tag. A morpheme with no letters of its own joins the next (the copula in `냄새야`).
- **Base forms:** Kiwi gives a verb's stem (`먹`), Wiktionary `먹다`; particles and endings bare, Wiktionary with hyphens (`baseSpellings`: `*다`, `-*`, `-*-` for pre-final endings, `-*다` for the copula). In a fused piece the stem comes first (`걸` is `거`, then `-ㄹ`). Kiwi writes a final consonant ending as the syllable-final jamo (`ᆯ`), Wiktionary as the letter (`baseLetters`).
- **Words:** endings join the stem; an auxiliary verb joins the `-아/-어` before it; `하다`/`되다` join a noun; suffixes join a noun; a counter joins a number; nouns written together join into a compound. Particles and the copula stay words of their own, as a grammar teaches them.
- **Compounds** (`compoundPos`): Kiwi cuts a compound it doesn't know into nouns it does (`양자` + `역학`), and Wiktionary often has it whole (`양자역학`, `김장`, `민족말살`). One without an entry is shown by the longest parts Wiktionary has (`발색|단`). A noun Kiwi reads as one unknown word is cut into the nouns Wiktionary has, when the last piece is one and no piece is a single letter (`간송|미술관`, `단중|모리`; not `김|연수`, a name, or `사이|클`).
- **Noun + 하다:** `공부했어요` is looked up as `공부하다` first (`stemSuffixes`).
- **Spaces** (`spacedWords`): the eojeol as written is a word. A headword spelled so that is an adverb, conjunction, determiner, numeral, pronoun or interjection comes first when the analyzer reads the eojeol as a verb with endings (`하지만` "but", cut `하` + `-지만`; `다른` "other"; `어떻게`), wherever it stands (`별로`, `앞으로`). Rows of the written form that fit neither the analyzer's reading nor the word are another word (`하지` "summer solstice" for `하` + `-지`). A phrase is a lemma with a space. A prefix joins only the word right after it, not one past a space. Kiwi's multi-word dictionary is off: its entries span spaces (`백일의 낭군님`, a drama's title, as one noun).
- **Ranking** (`ranksByPos`): a word's entries of Kiwi's part of speech first, in the order the `upos` map lists them: `우리` the pronoun before "cage", the particle `-는` before the ending, a counter `년` "year" before the noun spelled alike.

### Why Kiwi, not Lindera's ko-dic

r0–r4 ran on Lindera's ko-dic (`lindera-wasm-ko-dic` 2.1.0), the dictionary the Japanese analyzer's engine offers for Korean. Its build has none of mecab-ko-dic's 30 entries for `이` (the subject particle, the copula, the pronoun, the noun "tooth"; 1.2.0 alike), so `생각이` was `생` + `각이` and `학생이에요` `학생` + `이에` + `요`, and the WASM build can't load a user dictionary. With no language model it also read `들었는데` as `들다`, `한 번` as `하다` + `벌다`, `여러 가지` as `가지다`, `전 세계` as `저` + `-ㄴ`. Working around it took four settings (`restore`, `recheck`, `stemForms`, `fused`) and about 220 lines.

Kiwi is a Korean analyzer with its own engine and a language model; it reads all of those right. On the corpus, ko-dic's head words agreed with Kiwi's on 89.2% of words, 91.0% with the workarounds. With Kiwi (r5 on) the workarounds are gone.
- **Cost:** Kiwi's model isn't on npm: `bun run kiwi:model` fetches the release matching the package (88 MB download, 105 MB of files, checksummed) into `models/kiwi` (`KIWI_MODEL_DIR`); the Dockerfile and CI run it. Its WebAssembly build always loads the model unquantized: about 0.75 GB alone, against ko-dic's 0.35 GB (see Memory). It loads in about 1.6 s, and analyzes a line in about 2.4 ms, against ko-dic's 0.1 ms; recent analyses are cached.
- **Tried and dropped:** giving Kiwi Wiktionary's 25,776 nouns as its own words (`userWords`). At its default score they override Kiwi's readings (`이제`, `다시`, `모두` became nouns; `들이` "capacity" in `선수들이`): 71 better, 64 worse. Only the 5,162 Kiwi doesn't know, at a score of -3, worked, but finding them needs a second build of Kiwi at startup, which peaks at 1.3 GB. The compound join above gets most of the gain without it.

## Headword and spelling

- **Spelling:** Hangul is matched as written; `lookupKey` needs no change.
- **Headword:** the lemma as Wiktionary writes it (`먹다`, `-에서`). Korean nouns have no gender, so `[headword]` shows no labels and there is no `labels.toml`.
- **Romanization:** 59,008 of the 64,457 lines have a Revised Romanization, and 40,635 have IPA. The romanization is the headword's `pron.reading` (`import.readingTags = ["romanization"]`: `먹다` meokda), as the protocol defines it, a script the user can sound out: 39,443 of 40,499 entries have one. Grammar-file lines have none.
- **Pointer glosses** (`import.pointerWords`): "Yang-vowel form of -어서", "Post-vowel and post-liquid allomorphic form of -으면", "topic-marked form of 나" carry no `form-of` link in the dump. They become links to the word, so the reader gets its meaning. About 120 senses.

## Grammar file

`grammar.tsv`, 59 lines:
- **Particles** Wiktionary lacks or explains only by naming a form: `-이나` "or", `-이라고` and `-이라는` (quoting, "called"), `-이란` (a topic to define: `행복이란`), `-이라면`, `-으로써`, `-으로부터`, `-이라든가`.
- **Endings:** `-는데` (setting the scene, contrast), polite `-요` forms Wiktionary lists only without `요` (`-거든요`, `-는데요`, `-더라고요`, `-잖아요`, `-나요`, `-을까요`), `-아야` "must" with 하다/되다, `-으려면`, `-고자`, `-다면`, `-다는`, `-네요`, `-다시피`.
- **Suffixes:** `-적` (`화학적`), `-님`.
- **Bound nouns and adverbs** whose common use Wiktionary lacks: `데` "in doing", `같이` "like", `또 다른`, `한번` "give it a try", `별로` with a negative, `덜`, `총`.
- **Spoken words:** `뭐` and `어` as fillers, `막`, `좀`, `되게`, `그러니까`, `그러면`, `그래도`, `요거`/`요런`/`요렇게`.
- **Hand patches**, common words English Wiktionary lacks: `이산화`, `인슐린`, `이온`, `회로`, `농도`, `효율`, `생성`, `억제`, `불순물`, `줄기세포`.

Not in the file, left to tier 2: constructions that span eojeols (`-ㄹ 수 있다/없다`, `-고 있다`, `-아야 하다`, `예를 들어`, `에 따라`, `뿐만 아니라`). The phrase matcher needs words that touch, and Korean phrases are written with spaces.

## Eval: Kiwi's units

The clicked unit is the eojeol, as the segmenter gives it. Common words are ranked by lemma, so `학교에서` and `학교가` both count for `학교`. `../corpus/eval/units_ko.py` makes the units with Kiwi (`kiwipiepy` 0.25). Since r5 the server analyzes with Kiwi too (the same model through its WebAssembly build), so a word the two misread alike is ranked under the wrong lemma and looked up as that lemma; the judge, which reads the sentence, still marks the popover wrong.
- **Unit:** a run of Hangul, or of Latin letters (`AI` of `AI가`, which the segmenter cuts off).
- **Lemma:** the head morpheme, with `다` for a stem, and with the suffix for noun + 하다 (`공부하다`).
- **Classes:** content is a head that is a noun, verb, adjective or root. Pronouns, bound nouns, numerals, adverbs, determiners and particles are grammar.

Kiwi misreads some rare words and gives their first syllable as the lemma (`거병하여` under `거`, `내당력` under `나`), which puts rare words into common lemmas' samples. That costs the grammar gate a few items (12 of its 36 failures are missing words).

## Runs

Sample from r0 (`../corpus/eval/out/ko/r0/gate`), 2,200 items. API and extension agree on 2,199 (one prefix word, `불가능해요`, groups its parts differently).

| Run | What changed | Grammar | Content | Random | Understood |
|---|---|---|---|---|---|
| r0 | plain import, no analyzer | 80.0 (83.5) of 285 | 88.8 (90.2) of 385 | 37.5 (91.7) | 42.9 |
| r1 | ko-dic analyzer, base spellings | 85.3 (89.7) | 84.6 (87.6) | 67.7 (87.6) | |
| r2 | restore 이, pointer glosses, grammar file | 85.5 (88.8) | 87.5 (89.9) | 69.3 (89.7) | 76.9 |
| r3 | recheck, spaced phrases, bound-noun lines | 90.6 (93.6) | 87.8 (90.3) | 69.6 (90.1) | |
| r4 | fixes from the classified diff | 90.3 (93.3) of 371 | 87.7 (90.1) of 806 | 69.6 (89.8) of 962 | 78.0 |
| r5 | Kiwi, ko-dic's workarounds removed | 89.5 (93.4) of 382 | 88.4 (89.8) of 808 | 71.0 (89.9) of 971 | 79.5 |
| r6 | r5 + Wiktionary's nouns as Kiwi's words (dropped) | 90.1 (93.2) | 87.6 (89.5) | 71.5 (89.3) | 79.4 |
| r7 | r5 + compounds, unknown nouns by their parts, no multi-word dictionary, copula of no letters | 89.8 (93.7) | 88.2 (89.7) | 72.6 (88.7) | 80.0 |
| r8 | unknown nouns only cut into a known head | 89.8 (93.7) | 88.4 (89.8) | 71.5 (89.5) | 79.7 |
| r9 | grammar lines `-잖아요`, `-이란` | **89.8 (93.7) of 381** | **88.7 (90.2) of 808** | **71.6 (89.7) of 971** | 79.9 |

Figures in brackets are without the judge's `missing_word` misses. r0's common gates count fewer items: 527 common items had no entry then and count toward no gate. Judging cost about $0.50 for r0 and less for each later run (only changed popovers).

**Classified diff r1 → r3** (gate sample, 685 changes, Haiku): 255 better, 98 worse, 345 same. Every "worse" was read. Fixed in r4:
- a noun + `이` that ko-dic cut off as unknown, turned into the determiner (`세균이`, `대한민국이`);
- the ending `-어` opening on the interjection line `어`;
- `년` "year" behind the noun spelled alike;
- `감사합니다` losing "thank you";
- `좋아하는` read as `좋다` + `하다`;
- `이고` read as `이다` "to carry on the head";
- `그것이` read as `그` + `것이`.

**Classified diff r4 → r9** (ko-dic against Kiwi, gate sample, 400 changes): 172 better, 77 worse, 157 same. Of the worse, about a third are the classifier contradicting its own reason (`날` "day" now first in `다음 날`, `수면` "sleep" now found). The rest:
- Kiwi's own misreadings: `아니하고` as `아니` + `하고`, `식이` as `식` + `이` the determiner, `분기` "quarter" as `분` + `기`, names split (`주원장`, `한명회` kept whole, `박종훈` cut);
- a noun's entries before the particle's spelled alike, by Kiwi's part of speech (`뿐` the bound noun before `-뿐`);
- unknown words that used to show a part by chance and now show none (`카페올`, `후성`, `네빌`).

Left from ko-dic (r4), all misreadings with no general fix, which Kiwi reads right:
- `전` "whole" as `저` + `-ㄴ`;
- `나서` (in `-고 나서`) as `나` "I";
- `박은` as `박` "gourd";
- `로빈이` as `로` + `빈이`;
- `오른` "rose" ranking the determiner "right" first, by the spelled-as-written rule.

**Other languages:** a dump of every Japanese corpus lookup on the v0.1.3-rc.1 dictionaries, main against this branch (with Kiwi, r9): 31 of 72,686 responses change, no first entry. Words headed by the copula (`に`, `で`, `な`) lose junk verbs (煮る, 似る, 出る), because stem probes now only follow a verb or adjective. No other language has an analyzer.

## Gates

| Gate | Needs | r9 | Without missing words |
|---|---|---|---|
| Common grammar words | 97.5% | 89.8% of 381 | 93.7% |
| Common content words | 92.5% | 88.7% of 808 | 90.2% |
| Random words | 87.5% | 71.6% of 971 | 89.7% |

All three fail. The misses are data:
- **Random:** 196 of 971 items are words English Wiktionary has no entry for. Without them the gate passes (89.7%).
- **Content:** most misses are missing words or senses (`대사` "metabolism", `조류` "tidal current", `주요` "main"). Fixing every other miss would leave it about 92%: still short.
- **Grammar:** of 39 misses, 16 are missing words and about 5 are constructions that span eojeols (tier 2).

Kiwi didn't change this: it reads more words right (r4 → r9: 172 popovers better, 77 worse; 78.0% → 79.9% understood), but a word with no entry stays unexplained however it is read. To pass, Korean needs hand patches on the scale of the dictionary, not rules: in the random sample alone, about one word in five has no entry (`엔지니어`, `픽셀`, `결제하다`, `역대`, `일부분`, `실온`, `냉동실`, `수용체`, `함선`, `폐결핵`, `중복`, `진짜로`, `쓰임`). The user rejected a general hand-patch list for Japanese, so this is stopped here and reported.

Words with no entry, most frequent in the corpus: names (캘빈, 샤오미, 통계청, 명나라, 고종, 퇴계), science terms (틸라코이드, 축삭, 광계, 양공), and general words Wiktionary lacks (유소년, 편찬, 공복, 과도하다, 연평균, 품새, 후면, 하여금).

## Memory

Measured 2026-11-21 on the v0.1.3-rc.1 dictionaries, a full server, the corpora then replayed with 16 lookups at a time (RSS every 0.5 s):

| Server | Peak starting | Idle | After the Korean corpus (peak) | Then the Japanese corpus (peak) |
|---|---|---|---|---|
| main, 8 pairs | 1.18 GB | 0.95 GB | – | 1.45 GB (1.75 GB), Japanese alone |
| + ko, ko-dic (r4, 2026-11-20) | 1.49 GB | 1.27 GB | 1.73 GB (1.98 GB) | 2.04 GB (2.21 GB) |
| + ko, Kiwi (r9) | 1.82 GB | 1.58 GB | 1.91 GB (2.05 GB) | 2.29 GB (2.63 GB) |

Kiwi adds about 0.63 GB at rest (ko-dic 0.30 GB): its WebAssembly build loads the model unquantized. Repeated ko-dic replays showed RSS levels off rather than growing. Startup takes about 8 s either way. The prod box has 7.9 GB and no swap: Korean fits.

## What's left

- **Data:** the hand-patch question above; Wiktionary sense gaps.
- **Tier 2:** constructions over eojeols (needs the phrase matcher to allow spaces); numbers with counters and units in one click (`2024년에`, where the click covers `년에`; `160대`, `10여종`).
- **Analyzer:** Kiwi's misreadings (`아니하고`, `식이`, names it cuts: `박종훈`); a compound after a prefix is not looked up whole (`저|출산` in `저출산기본법`). Kiwi's smaller model, once the WebAssembly build can load it quantized, would take less memory.
- **Corpus:** no news, blogs or guides.
