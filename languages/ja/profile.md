# Japanese (ja_en)

Tier: **Model only, unreviewed.** No reader of Japanese has checked this profile, the grammar file or any sample. Every point rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-07, and the user steered the design: the word-finding and the eval's word units came from their decisions. Two gates pass. The content-word gate misses by 0.4 points, 4 items, inside the judge's noise. No tier-2 work.

Data: `data/raw/ja.jsonl`, filtered from the 2026-11-01 dump (200,030 lines). `data/ja_en.sqlite` has 106,689 entries. 45,031 of the dump's lines are soft redirects: kana pages that only name their kanji lemmas.

Corpus: `../corpus/ja`, gathered 2026-11-07. Words are counted with Sudachi's units (see Eval), not the browser's pieces.
- **Spoken:** 34,660 words in 12 YouTube videos, auto-captions repaired by Haiku, one per channel. There are 11 genres: food, history, culture interview, sport interview, news, economy, tech, lifestyle, health, culture podcast, gaming and travel. The largest video is 13% of the spoken words. Videos read by a synthetic voice (ゆっくり解説, 海外の反応) were left out.
- **Written:** 30,228 words in 10 texts. Eight are Wikipedia articles, each cut at the first section break after about 3,000 words: 明治維新, 寿司, 人工知能, 富士山, サッカー日本代表, 新幹線, 俳句 and 日本の経済. Two are Aozora Bunko stories, 蜘蛛の糸 and 手袋を買いに. There is no news. NHK ONE truncates its articles for visitors who aren't signed in, even in a browser. The register is mostly encyclopedic, which is a gap to fill with news or blog texts.

## Quirks

### Words: no spaces

The browser's word splitter, `Intl.Segmenter` in ICU (Chromium and Bun agree), cuts inflected words short:
- 食べました → 食 | べ | ま | した
- 行った → 行 | っ | た
- 勉強しています → 勉強 | し | てい | ます

A click on 食 sent 食 and showed "food". This decided most of tier 1:

- **Protocol** (`../Protocol.md`, user's decision): the server returns the whole word as a one-string `match` on its first entry, and `segments` may split that match into logical pieces (`勉強|し|て|い|ます`). The extension accepts such a split (done in its own thread; the build is from 2026-11-07).
- **Server: a morphological analyzer** (`context.analyzer`, `features/analyzedWords.ts`). This is Lindera with UniDic (npm `lindera-wasm-unidic`). It's a general mechanism: the dictionary and the joining rules are in `language.toml`, and Chinese, Korean or Thai can name their own.
  - **Words:** UniDic's short units are joined into words by the `join` rules: auxiliaries, the て form and the verb after it, conditional ば, たり, the する of a する-noun, numbers and their counters, and suffixes.
  - **Underline and parts:** the word around the clicked piece is the `match`, and its morphemes are the parts, each looked up by its base form. `match` is only sent with a sentence, only on entries the sentence adds, and always holds the clicked piece and more: a piece that is the whole word underlines nothing, and neither do the clicked word's own entries after a phrase (issue #4).
  - **Phrases:** a phrase of several words that the dictionary lists (手に入る, かも知れない, によると) comes first. It may be written in kana (respelled by the lemma: しれ → 知れ).
  - **Pieces over several words:** a piece that is several words (年前, 明治天皇, よ|ね), or is cut across them (たん of なかった|ん, すか of あります|か), is split into the words it touches, the one that holds most of it first. When the piece is cut across them, the `match` is the run of those words (ありますか). The piece's own entries are shown instead when the dictionary lists it as a phrase (そうですね), or has nothing for the word that holds most of it (でも in 横ばえで|も).
  - **Ranking:** a kana word whose own entries lack the analyzer's part of speech gets the analyzer's kanji lemma first (もの the noun is 物). The map is `upos` in `language.toml`.
- **Measured against a hand-made longest match.** The first version read the run of text into the longest dictionary forms. It took five rounds of rules (particles, kana fragments, light verbs) and still guessed wrong where kana words start (に as 煮る, がも "duck" in が|もたらされた). It was judged as run u2 and lost to the analyzer on every gate (see Runs), then deleted.
- **Memory:** UniDic loads in about a second and takes **about 600 MB** of RAM (wasm heap 604 MB), only when `ja_en` is served. IPADIC would be about 120 MB, with a 2007 dictionary. This deployment cost is still open.

### Spelling and headword

- **Reading:** `pron.reading` is filled from the canonical form's ruby (`rubyReading`, importer): 75,556 entries, する-verbs included (勉強 べんきょう). The popover shows it under the headword.
- **Kana spellings:** 30,218 to 34,035 kana forms come from soft redirects (`FormSource.Redirect`, `passes/redirects.ts`).
  - **Which words:** つまり → 詰まり, あまり → 余り, ところ → 所, ただし → 但し. These are words with no entry of their own, and only kanji entries read that way, without names. A katakana spelling of a hiragana word always counts (ワクワク → わくわく), and so does a kanji variant (国々 → 国国).
  - **Ranking:** a redirect ranks with lemmas, because it is the word itself.
  - **Pieces:** a piece that the dictionary only reaches through a redirect isn't taken as a word over the analyzer's reading (よね → 米 "rice", for よ + ね).
- **Syllable entries** (`source_pos = syllable`, "The hiragana syllable は") rank last, like letters. No other language has them.
- **Headword:** the lemma as Wiktionary writes it. する-verbs show as the noun (勉強 VERB); their canonical form is 勉強する. Left as it is: not decided.

### Grammar file

`grammar.tsv`, 70 lines in four groups:
- **Endings, by their UniDic base form:** ます, た (with たら and たり), だ (with だろう), です (with でしょう), て, いる, てる, ない (with ないで), たい, ちゃう/じゃう, ちゃ, (ら)れる, (さ)せる and よう.
- **Particles** that Wiktionary describes poorly: と (quoting), って, だって, じゃん, けれど, なんか, なんて, ぐらい/くらい.
- **Set phrases:** によると, によって, に関して, に対して, にすぎない, に違いない, だけでなく, ではない/じゃない, んです/のです/なんです, ように, そのため, それに.
- **Adverbs and fillers:** ほぼ, やはり, だんだん, 本当に, 非常に, ちょっと, ま, まあ, え, あ, どの, こちら.

## Eval: words, not pieces

With the ICU piece as the unit, 572 of the 2,200 sample items were pieces of a longer word. The common-word list held っ, き, め and る, and the judge never saw what was underlined. So the eval counts reference words instead, from **Sudachi** (`../corpus/eval/units.py`, SudachiDict-core 2026-10-15, mode C), a different analyzer from the server's:
- **Joining:** a verb or adjective with its auxiliaries, the て form and the verb after it, and so on.
- **Ranking and classes:** words are ranked by lemma, and grammar vs content and names come from the head's part of speech.
- **The click:** the reader clicks a seeded random letter of the word, and the extension sends the ICU piece there.
- **What the judge sees:** the word, the clicked piece and what's underlined. The prompt section for these items is in `judge-prompt-units.md`, added only for such samples, so other languages' cached verdicts keep their keys.

In the 2,200-item sample, 607 clicks land on a piece of a longer word and 108 on a piece wider than the word.

## Runs

All runs judge the same items, from u0's gate sample. Figures are understood % / % without words the judge called missing.

| Run | Grammar | Content | Random | What changed |
|---|---|---|---|---|
| u0 | 80.0 / 84.1 | 78.5 / 89.2 | 72.6 / 91.0 | plain import (minimal language.toml, no grammar file) |
| u2 | 76.8 / 81.8 | 86.3 / 89.5 | 79.9 / 92.7 | longest-match rules |
| u3 | 81.7 / 85.5 | 89.5 / 91.4 | 84.8 / 94.1 | analyzer (UniDic) instead |
| u4 | 95.8 / 97.3 | 91.1 / 92.7 | 86.1 / 94.7 | grammar file, soft redirects |
| u7 | 96.6 / 98.1 | 91.7 / 93.0 | 87.2 / 95.2 | phrase before the piece, numbers, kana lemmas |
| u11 | 97.7 / 98.4 | 91.7 / 93.1 | 86.9 / 94.9 | particle start, majority overlap, 2 false positives |
| **u13** | **97.7 / 98.4** | **92.1 / 93.3** | **88.0 / 95.0** | compounds, kana-script redirects, base forms for missed words |

Gates need 97.5 / 92.5 / 87.5. From u0 to u13, 834 popovers changed on the same items: 437 understood better and 26 worse. Clicks on a piece of a longer word are understood 85.5% of the time, against 69.4% in u0.

Coverage, the share of corpus words with an entry, went from 92.9% (u0) to 98.1% (u13).

## What's left

- **Content words (73 failing):** mostly senses Wiktionary lacks (36 `missing_sense`): 強化 as a team's recruiting, 流れ "trend", 全体 as a filler. Also phrases it lacks or the matcher misses (15): ある時, 私の中では, 関係なく, を通じて, をもって. And endings shown only as their base (10 `form_gloss`): 大きく as an adverb, potentials like 掴める.
- **The judge's "missing words" (97 in u11):** checked one by one against the dictionary and the dump.
  - **7 imported badly:** they were soft redirects to kana spellings (ワクワク) or kanji variants (国々). This is fixed.
  - **25 lookup or judge problems:** compounds that showed only their first part (年前, 明治天皇), a part whose entry is under kana (欲しい), and forms not in the tables (暗く). These are fixed in u13.
  - **65 not in English Wiktionary.** Most aren't common words: compounds of words it has (少子高齢化, 国土交通大臣, 上場企業, データセンター), units and abbreviations (km/h, kcal, RCT), transcript fragments, and rare terms.

  The user's rule is that only common words Wiktionary lacks get hand patches. Few of these qualify (分かれ道, 乗り心地, うーん), so there is **no hand-patch list** for now.
- **False positives (2), in `../corpus/eval/out/ja/false-positives.jsonl`:**
  - a cut-off filler (そ) at the start of a spoken sentence;
  - 短いよで, a transcript slip for 短いようで.

## Other languages

Every change is either Japanese-only or neutral for the others:
- **Japanese-only data:** soft redirects, syllable entries and ruby exist only in the Japanese dump.
- **Settings Japanese alone sets:** the analyzer, its join rules and `upos`.
- **The `FormSource.Redirect` ranking** orders the same as before when there are no redirect rows.

So de, pl, ru and uk need no re-import, and their lookups are unchanged.
