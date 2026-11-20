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

Korean writes spaces, but between eojeols: `학교에서` is `학교` + `-에서`, `먹었습니다` is `먹` + `-었-` + `-습니다`. The browser's segmenter gives the whole eojeol, so the plain lookup found nothing for half the words (r0: 49.9% of corpus words had an entry, now 95.3%). Verb stems fuse with their endings (`했` = `하` + `았`, `갈` = `가` + `ㄹ`), so no table finds every form. Decision: **the analyzer path** (`context.analyzer`, `features/analyzedWords/`), with Lindera's ko-dic (`lindera-wasm-ko-dic` 2.1.0, mecab-ko-dic). Every mechanism below is a setting in `language.toml`; the TypeScript names no language.

- **Parts of speech:** ko-dic's first detail field is the tag (`posFields = 1`); a tag joined with `+` is a fused morpheme (`VV+EP`) and has each part's tag.
- **Base forms:** ko-dic gives a verb's stem (`먹`), Wiktionary `먹다`; particles and endings bare, Wiktionary with hyphens (`baseSpellings`: `*다`, `-*`, `-*-` for pre-final endings, `-*다` for the copula). A fused morpheme takes its parts' base forms from the expression field (`fused`: `했` is `하다`, `-았-`), stems before particles (`걸` is `거`, then `-ㄹ`). ko-dic writes a final consonant ending as the syllable-final jamo (`ᆯ`), Wiktionary as the letter (`baseLetters`). The reading field is no base form (`아` read `아이`, `물론` read `몰론`): `baseFields = []`, the morpheme as written.
- **Words:** endings join the stem; an auxiliary verb joins the `-아/-어` before it; `하다`/`되다` join a noun; suffixes join a noun. Particles and the copula stay words of their own, as a grammar teaches them.
- **Noun + 하다:** `공부했어요` is looked up as `공부하다` first (`stemSuffixes`).
- **Stems that change:** `듣다` → `들어`, which ko-dic reads as `들다`'s stem. The stem with the infinitive ending is a table form of every verb it may be (`stemForms = ["*어", "*아"]`): `들었는데` shows `들다` and `듣다`. Which one is meant is the context's: ko-dic doesn't tell them apart.
- **Spaces** (`spacedWords`): the eojeol as written is a word. A headword spelled so that is an adverb, conjunction, determiner, numeral, pronoun or interjection comes first when the analyzer reads the eojeol as a verb with endings (`하지만` "but", cut `하` + `-지만`; `다른` "other"; `어떻게`), wherever it stands (`별로`, `앞으로`). Rows of the written form that fit neither the analyzer's reading nor the word are another word (`하지` "summer solstice" for `하` + `-지`). A phrase is a lemma with a space (the analyzer cut `우리다` in two, and the lookup took `우리는` for a phrase).
- **Ranking** (`ranksByPos`): a word's entries of ko-dic's part of speech first, in the order the `upos` map lists them: `우리` the pronoun before "cage", the particle `-는` before the ending, a counter `년` "year" before the noun spelled alike.
- **Adnominal endings** (`recheck`): an adnominal ending comes before a noun. A word that ends in one with no noun after it is analyzed alone (`우리는 어떤가요`).

### Lindera's ko-dic has no 이

mecab-ko-dic has 30 entries for `이`: the subject particle, the copula, the pronoun and determiner "this", the noun "tooth". Lindera's build has none of them: `책이` is `책` + unknown, `생각이` is `생` + `각이`, `학생이에요` is `학생` + `이에` + `요`. Every other surface of mecab-ko-dic's 804,570 is there, except hanja. The same is true of lindera-wasm-ko-dic 1.2.0. The WASM build can't load a user dictionary (it reads no files). Decision: the `restore` setting.
- **Inside a word,** after a noun that ends in a consonant, the word is analyzed again with `이` cut out (a space in its place). That reading is kept when the dictionary knows more of the word by it, when ko-dic had cut there already, or on a tie when ko-dic cut inside the noun (`그|것이`). `이` is the copula before an ending (`학생` + `이에요`), else the subject particle. `호랑이` "tiger", `같이`, `어린이` stay whole.
- **At a word's start** before particles, `이` is the pronoun: read with `그`, which behaves alike (`이를`, `이는`, `이에`).
- **Alone,** an unknown `이` is the determiner.
- On the corpus, about 900 of 1,750 eojeols ending in `이` were misread before `restore`.

Open: tell Lindera (only a model found it). Kiwi, used here for the eval's units through its Python package, reads `이` and `듣다`'s stem right. It is a separate analyzer, not a Lindera dictionary: its own engine and language model, with an official WebAssembly build on npm (`kiwi-nlp` 0.25.0) whose model files load separately. Using it would mean a second analyzer backend next to Lindera; it is not measured here.

## Headword and spelling

- **Spelling:** Hangul is matched as written; `lookupKey` needs no change.
- **Headword:** the lemma as Wiktionary writes it (`먹다`, `-에서`). Korean nouns have no gender, so `[headword]` shows no labels and there is no `labels.toml`.
- **Romanization:** 59,008 of the 64,457 lines have a Revised Romanization, and 40,635 have IPA. The romanization is the headword's `pron.reading` (`import.readingTags = ["romanization"]`: `먹다` meokda), as the protocol defines it, a script the user can sound out: 39,443 of 40,499 entries have one. Grammar-file lines have none.
- **Pointer glosses** (`import.pointerWords`): "Yang-vowel form of -어서", "Post-vowel and post-liquid allomorphic form of -으면", "topic-marked form of 나" carry no `form-of` link in the dump. They become links to the word, so the reader gets its meaning. About 120 senses.

## Grammar file

`grammar.tsv`, 57 lines:
- **Particles** Wiktionary lacks or explains only by naming a form: `-이나` "or", `-이라고` and `-이라는` (quoting, "called"), `-이라면`, `-으로써`, `-으로부터`, `-이라든가`.
- **Endings:** `-는데` (setting the scene, contrast), polite `-요` forms Wiktionary lists only without `요` (`-거든요`, `-는데요`, `-더라고요`, `-나요`, `-을까요`), `-아야` "must" with 하다/되다, `-으려면`, `-고자`, `-다면`, `-다는`, `-네요`, `-다시피`.
- **Suffixes:** `-적` (`화학적`), `-님`.
- **Bound nouns and adverbs** whose common use Wiktionary lacks: `데` "in doing", `같이` "like", `또 다른`, `한번` "give it a try", `별로` with a negative, `덜`, `총`.
- **Spoken words:** `뭐` and `어` as fillers, `막`, `좀`, `되게`, `그러니까`, `그러면`, `그래도`, `요거`/`요런`/`요렇게`.
- **Hand patches**, common words English Wiktionary lacks: `이산화`, `인슐린`, `이온`, `회로`, `농도`, `효율`, `생성`, `억제`, `불순물`, `줄기세포`.

Not in the file, left to tier 2: constructions that span eojeols (`-ㄹ 수 있다/없다`, `-고 있다`, `-아야 하다`, `예를 들어`, `에 따라`, `뿐만 아니라`). The phrase matcher needs words that touch, and Korean phrases are written with spaces.

## Eval: Kiwi's units

The clicked unit is the eojeol, as the segmenter gives it. Common words are ranked by lemma, so `학교에서` and `학교가` both count for `학교`. `../corpus/eval/units_ko.py` makes the units with Kiwi (`kiwipiepy` 0.25), a different analyzer from the server's:
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
| r4 | fixes from the classified diff | **90.3 (93.3) of 371** | **87.7 (90.1) of 806** | **69.6 (89.8) of 962** | 78.0 |

Figures in brackets are without the judge's `missing_word` misses. r0's common gates count fewer items: 527 common items had no entry then and count toward no gate. Judging cost about $0.50 for r0 and less for each later run (only changed popovers).

**Classified diff r1 → r3** (gate sample, 685 changes, Haiku): 255 better, 98 worse, 345 same. Every "worse" was read. Fixed in r4:
- a noun + `이` that ko-dic cut off as unknown, turned into the determiner (`세균이`, `대한민국이`);
- the ending `-어` opening on the interjection line `어`;
- `년` "year" behind the noun spelled alike;
- `감사합니다` losing "thank you";
- `좋아하는` read as `좋다` + `하다`;
- `이고` read as `이다` "to carry on the head";
- `그것이` read as `그` + `것이`.

Left, all ko-dic misreadings with no general fix:
- `전` "whole" as `저` + `-ㄴ`;
- `나서` (in `-고 나서`) as `나` "I";
- `박은` as `박` "gourd";
- `로빈이` as `로` + `빈이`;
- `오른` "rose" ranking the determiner "right" first, by the spelled-as-written rule.

**Other languages:** a dump of every Japanese corpus lookup on the v0.1.3-rc.1 dictionaries, main against this branch: 31 of 72,686 responses change, no first entry. Words headed by the copula (`に`, `で`, `な`) lose junk verbs (煮る, 似る, 出る), because stem probes now only follow a verb or adjective. No other language has an analyzer.

## Gates

| Gate | Needs | r4 | Without missing words |
|---|---|---|---|
| Common grammar words | 97.5% | 90.3% of 371 | 93.3% |
| Common content words | 92.5% | 87.7% of 806 | 90.1% |
| Random words | 87.5% | 69.6% of 962 | 89.8% |

All three fail. The misses are data:
- **Random:** 216 of 962 items are words English Wiktionary has no entry for. Without them the gate passes (89.8%).
- **Content:** 64 of the 99 misses are missing words or senses (`대사` "metabolism", `조류` "tidal current", `주요` "main"). Fixing every other miss, the 15 constructions over eojeols included, would leave about 92%: still short.
- **Grammar:** of 36 misses, 12 are missing words and 5 are constructions that span eojeols (tier 2).

To pass, Korean needs hand patches on the scale of the dictionary, not rules: in the random sample alone, about one word in five has no entry (`엔지니어`, `픽셀`, `결제하다`, `역대`, `일부분`, `실온`, `냉동실`, `수용체`, `함선`, `폐결핵`, `중복`, `진짜로`, `쓰임`). The user rejected a general hand-patch list for Japanese, so this is stopped here and reported.

Words with no entry, most frequent in the corpus: names (캘빈, 샤오미, 통계청, 명나라, 고종, 퇴계), science terms (틸라코이드, 축삭, 광계, 양공), and general words Wiktionary lacks (유소년, 편찬, 공복, 과도하다, 연평균, 품새, 후면, 하여금).

## Memory

Measured 2026-11-20 on the v0.1.3-rc.1 dictionaries, all 8 pairs, with and without `ko_en`:
- **Idle after start:** 0.97 GB → 1.27 GB (+0.30 GB). Peak while loading: 1.19 → 1.49 GB.
- **Under load,** the corpora replayed with 16 lookups at a time: after all 72k Korean lookups, 1.73 GB, peaking at 1.98 GB. Further Korean replays stay at 1.75–1.81 GB, so it doesn't grow. After the Japanese corpus as well, 2.04 GB, peaking at 2.21 GB. For comparison, main without Korean reaches 1.64 GB (peak 1.98 GB) after the Japanese replay alone.

The prod box has 7.9 GB and no swap: Korean fits.

## What's left

- **Data:** the hand-patch question above; Wiktionary sense gaps.
- **Tier 2:** constructions over eojeols (needs the phrase matcher to allow spaces); numbers with counters and units (`3km나`, `160대`, `10여종`; ko-dic gives digits as unknown); `들이` (ko-dic: `네` + `들` + `이`).
- **Analyzer:** ko-dic's misreadings (`가지` "kind" as `가지다`, `번` "time" as `벌다`, `살` as `사다`). Kiwi (`kiwi-nlp`) as a second analyzer backend is to be measured: quality on the corpus, memory, load time.
- **Corpus:** no news, blogs or guides.
