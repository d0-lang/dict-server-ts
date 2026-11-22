# Chinese (zh_en)

Tier: **Model only, unreviewed. Tier 1: all three gates pass (r5).** No reader of Chinese has checked this profile, the grammar file or any sample: every point rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-22. No tier-2 work.

Data: `data/raw/zh.jsonl`, filtered from the 2026-11-01 dump: 328,919 lines.
- 125,147 are `soft-redirect` lines: simplified spellings with no gloss, pointing at their traditional page (学习 → 學習).
- Parts of speech: 91,611 nouns, 34,677 verbs, 30,085 `character` lines (a character's whole page), 19,500 names, 11,422 adjectives, 9,944 phrases (chengyu, set phrases).
- 200,380 lines give a Mandarin pronunciation.
- `data/zh_en.sqlite` (38 MB) has about 155,600 entries; 151,201 have a pinyin reading. 89,864 lemma rows spell an entry in simplified characters.

Corpus: `../corpus/zh`, gathered 2026-11-22 (corpus branch `chinese`). Words are counted with jieba's units (see Eval): 93,607.
- **Spoken:** 72,514 characters in 16 YouTube videos, 10 genres: food, economy, talks (一席, TEDx), tech reviews, travel vlogs, DW news, a book review. 9 have simplified subtitles, 7 traditional (Taiwan, DW). The largest is 11.4% of the spoken text. Chinese videos rarely have auto-captions, so these are the uploaders' own subtitles, punctuated by Haiku and otherwise unchanged (`repair.ts` `subs`, `punctuate-prompt.md`).
- **Written:** 83,597 characters in 20 texts, 16 genres: 9 zh.wikipedia articles (5 fetched as simplified, 4 as traditional), BBC中文 (simplified), DW中文 and 中央社 news (traditional), and sspai.com guides and reviews (simplified). The largest is 14.1%.

## Scripts: one language, both spellings

Wiktionary keeps a word's content on its traditional page and names its simplified spelling there (116,906 forms tagged `Simplified-Chinese`); the simplified page is a soft redirect. Decision (the user's): **one pair `zh_en`, the headword in both scripts, the one the text uses first**: `学习 (學習)` in simplified text, `學習 (学习)` in traditional. Settings:
- `import.otherScriptTags = ["Simplified-Chinese"]`: the simplified spelling is a lemma of the entry, found and ranked as the lemma is. The plain import found 学习 only through the soft redirect, and 说 not at all (its `character` line carries the redirect, not a `soft-redirect` one).
- Soft redirects are the other script only where each letter is the target's or a spelling words use (below); the rest are variants (`旳` → `的`, the Zhuyin `ㄉ` → `的`, the Japanese `説` → `說`), kept as plain redirects. Without this the brackets read `的 (ㄉ, 勺, 旳, 𤾠)`.
- **Letters with no redirect.** Very common simplified letters have pages of their own with older meanings and no redirect: `机` "alder" (in 758 words as the simplified `機`), `气`, `线`, `台`, `还`, `几`, `种`, `干` (for `乾` and `幹`), `里` (for `裡`). Letter pairs are read off the words spelled in both scripts (2,828 pairs), kept when at least 3 words and 10% of the words with the letter spell it so (`波` as `云` in three misaligned forms is noise); each kept letter is a lemma of its letter's entries: 2,263 rows.
- **Ranking by the text's script.** A text is simplified when it has more letters only simplified writes (`说`, `们`) than letters only traditional writes. In simplified text a letter that mostly stands for another (`后` for `後` "after", by the words: more words write `後` as `后` than keep `后`) opens on that entry; one that is mostly itself keeps its own first (`面` "face" before `麵` "noodles", `只` is the exception the counts get wrong: `隻` the classifier comes first). 1,724 letters prefer another. In traditional text the entry spelled as written comes first (`后` "empress").
- `import.markedAlternatives`: headword lines list variant characters as alternatives (44,498 forms), often other words: `悅` "joy" lists `說` "to say", `搿` lists `个`. They only reach the word when they reach nothing else; before, `说` showed `悅` and `脫` and `个` showed `搿`, `格`, `ㄟ`.

## Varieties

The Chinese header holds every variety. Senses tagged Cantonese (12,187), Hokkien (9,902), Min, Hakka, Wu and smaller ones are another language's words to a Mandarin reader: a sample of the Cantonese-only senses is 住 "for now", 扯 "to leave", 梗 "of course", 咩 the question particle. Decision (the user's): drop them unless also tagged Mandarin (欠缺, 指甲鉗, about 100) or literary ("(literary or Hakka) my" for 吾: literary Chinese is read in Mandarin texts). `import.varieties`: 43,265 senses dropped; a word left with none has no entry (咩). Sichuanese and Dungan are Mandarin dialects but not the standard: dropped too.

There is no separate Classical Chinese in the dump: `Classical` (535) and `literary` (14,548) are sense tags. Decision (the user's): keep and label them (`import.glossLabels`: `(literary) to go` for 之), with Taiwan, Mainland China, Hong Kong, Singapore and Malaysia usage.

## Reading and pronunciation

- **Reading:** Hanyu Pinyin, `pron.reading` (`import.readingSounds`: a sound tagged exactly Mandarin + Pinyin, with or without Standard): 學習 xuéxí. A page's later etymologies repeat its earlier sounds (`的` the particle lists `dì`, `dí` of "bright" before its `de`), so a line reads only the sounds its page hasn't given yet.
- **IPA:** standard Mandarin's only (`import.standardPronTags`): a line gives up to 70 IPA strings, one per variety and city (我: Chengdu, Xi'an, Cantonese, Hokkien, Wu...).
- Grammar-file lines have no reading yet.
- Pinyin input (a reader clicking `xuéxí`) is not looked up: 73,647 Mandarin romanization pages would allow it later.

## Words: the dictionary's own

Chinese writes no spaces. The browser's segmenter (ICU) gives pieces the dictionary lacks (`都很`, `觉得很`, `我的`): on the plain import 12.9% of the corpus's words found nothing. Words don't inflect, so no morphological analyzer is needed. Measured against the corpus's reference words (jieba, 91,809 units with Han letters), the share where the word at the click is the reference word:
- ICU's piece: 80.6%; the fewest dictionary words, reverse maximum matching on a tie: 80.7% (forward or backward matching alone: the same).
- the piece where the dictionary has it, else the fewest words' word around it: **84.1%**.
- Lindera's CC-CEDICT (in the code's list already) reads `研究生|命` for `研究生命`, has no parts of speech, gives readings at random (`的` di4, `了` liao4) and takes 125 MB: not used.

Decision: `context.analyzer.dictionary = "words"`, the analyzer path with the dictionary's own words: each run of Han letters is cut into the fewest words with an entry (`MAX_WORD` 8 letters), each letter a morpheme (`B`, `I`), joined back by a `join` rule. On a tie, the cut leaving alone fewest letters that have no grammar-file line wins, then the longer last word: `城市|里`, not `城|市里` (82.8% of the reference words, against 82.0% for the longer last word alone; the same measure as above, now on the import with the grammar file). So:
- a word shows its letters as parts (`手机 (手機)`, then `手 | 机`), a letter's own entries before its grammar line (`过` of `过程` "process" is not the particle);
- a piece over several words is shown by them (`都很`: `都 | 很`);
- a piece inside a longer word that is a word itself comes first, then the longer word (`都` of `都会`, which the fewest words read as "metropolis" in `他都会来`);
- a phrase starts and ends where words do (`的|话题` is no `的话` "if"), and words written with their letters don't inflect (`好事` keeps its noun);
- digits and Latin letters stop at a Han letter (`10|天`).

The fewest words still misread some runs: `过|年前` for `过年|前`, `更|好的` for `更好|的`, `都会` above, `为我|的`. A word-frequency model would tell them apart (tier 2).

## Grammar file

`grammar.tsv`, 116 lines: the particles (的, 了, 着, 过, 地, 得, 吗, 呢, 吧, 啊, 呀, 嘛, 们), adverbs (还, 就, 才, 都, 也, 又, 再, 已经, 正在, 不, 没, 别, 一直, 只, 越), locatives (里, 中, 上, 下, 内, 外), prepositions and conjunctions (在, 把, 被, 给, 对, 跟, 从, 向, 以, 于, 将, 比, 并, 而, 因为, 如果, 虽然, 或者, 还是, 的话), auxiliaries (会, 能, 可以, 要, 想, 应该, 得 děi), question words and classifiers (个, 些, 种, 次, 家, 第). A character's page lists these uses late or not at all: 的 opens on "bright; clear", 还 has no "also". Each line is written traditional first, then its simplified spelling after a `/`, both lemmas. A line comes before Wiktionary's entries, which stay.
- **Senses Wiktionary's entries lack**, found by the judge: 非常 "very", 特别 "especially", 当然 "of course", 不过 "but", 反正 "anyway", 左右 "about", 接着 "then", 以外 "besides", 分别 "respectively", 大概 "probably", 真的 "really", 有人 "someone", 等 "etc.", 台 "Taiwan", 嗯 and 欸 as fillers.
- A phrase line is a dictionary word, so it changes how sentences are cut: `是因為` made `就是因为` read `就|是因为`, and was dropped. A letter's line also marks it as a word by itself for the tie between cuts, and names its common use: `里` mostly stands for `裡` "in" (the line `裡/里`), though more of Wiktionary's words keep `里` "li".
- The lines have no reading yet, and their examples are in traditional characters only.

## Eval: jieba's units

`../corpus/eval/units_zh.py` makes the units with jieba (`jieba.posseg`), on the text converted to simplified characters letter for letter (OpenCC), so a word in either script ranks as one (lemma in simplified). Content: nouns, verbs, adjectives, time words, idioms; names: persons, places, organisations, except common words jieba's dictionary tags as names (东西 "thing", 谢谢). The reader clicks a letter of the unit, and the item sends the ICU piece there, as the extension does.

## Memory

The `words` analyzer loads nothing: a lookup reads the dictionary file. A server with only `zh_en` takes 127 MB after its first lookup (one with only `uk_en`: 139 MB), and 168–203 MB after the corpus's 93,606 lookups, its caches full (other spellings by lemma, 1,724 preferred letters, recent analyses). A lookup takes 2–5 ms once warm; the first builds the spellings map (0.36 s).

## Other languages

Every other language imports identically with this branch (`dictDiff` against main, all nine). A line with `redirects` but no sense is a soft redirect only with `otherScriptTags`: Japanese has such lines too (`いみ` → `意味`, but also `39` → `未来`), unchecked. Lookups: Japanese 0 of 72,686 and Korean 0 of 102,553 responses change (`dump:lookups` against main).

## Runs

Sample from r0 (`../corpus/eval/out/zh/r0/gate`), 2,200 items. API and extension agree on every popover: on each run 72 items differ only in the sentence, where the extension joins a Wikipedia heading or formula line with no full stop to the next sentence (`=== 巫术仪式说 === 该说法认为…`), and one in which tab shows the whole word (`海星`). (Run `collect-browser.ts` once per sample: it rewrites the sample with what the extension showed, so a second run compares the extension with itself.)

| Run | What changed | Grammar | Content | Random | Understood |
|---|---|---|---|---|---|
| r0 | plain import, no analyzer | 89.6 (91.6) of 452 | 93.9 (95.1) of 626 | 73.3 (90.4) of 951 | 77.2 |
| r1 | both scripts, letter pairs, varieties, pinyin, the `words` analyzer | 92.6 (92.8) of 512 | 92.7 (93.0) of 675 | 88.4 (92.6) of 974 | 89.3 |
| r3 | grammar file, readings per etymology, a part's grammar line beside its entries, phrases over whole words, standard IPA | 92.8 (92.8) of 515 | 93.6 (93.8) of 677 | 88.5 (92.6) of 976 | 89.9 |
| r4 | a letter's own entries before its line, the piece inside a word first, words don't inflect, digits stop at Han, no `是因為` | 95.9 (96.1) of 515 | 96.5 (96.9) of 677 | 91.0 (94.9) of 975 | 92.5 |
| r5 | ties by letters alone, locatives, senses Wiktionary lacks, `里` prefers `裡` | **97.7** (97.9) of 515 | **96.6** (97.0) of 677 | **91.1** (95.2) of 975 | 93.0 |

r2 (the grammar file alone) was collected and classified (342 better, 19 worse), not judged; r3 replaces it. The classified diffs' "worse" items led to r4's fixes (a letter's grammar line ahead of its own meaning in a compound: 过程, 回家, 演唱会; 好事 losing its noun; 是因為).

**r5's 12 failing grammar words:** segmentation (`为我|的`, `是以` "therefore" for `是|以`, `更|好的`, `一|年中`, `三大公` for `三大|公投`, `出生|年月日`), `还可以` "OK" for `还|可以`, phrases Wiktionary lacks (`以…为代表`, Taiwanese `远别`), `C` for °C, `他` (the judge's own doubt) and `天` "dawn" in a play's title.
