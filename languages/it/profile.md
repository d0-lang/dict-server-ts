# Italian (it_en)

Tier: **Model only, unreviewed.** No reader of Italian has checked this profile, the grammar file or any sample. Every point below rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-17 and all three gates pass (see Log). No tier-2 work, no context benchmark (`gold/`).

Data: `data/raw/it.jsonl`, filtered from the 2026-11-01 dump (624,122 lines, two thirds of them pages for single verb forms). `data/it_en.sqlite` has 164,562 entries: 66,593 nouns, 46,849 verbs, 25,743 adjectives, 17,137 names, 4,951 adverbs, 2,065 `X` (contractions and letters), and 143 lines from the grammar file.

Corpus: `../corpus/it`, 31 texts, 154,650 words, gathered 2026-11-17.
- **Spoken:** 46,480 words in 16 YouTube videos (auto-captions repaired by Haiku, 21 parts, all passing the check), 9 genres (tech reviews, economy, history, cooking, vlogs, travel, politics, a sport interview, a political interview), at most two per channel. The largest text is 14% of the spoken words. Two are from learner channels (slower speech).
- **Written:** 108,170 words in 15 texts, 11 genres: 12 it.wikipedia articles, whole up to their notes, and 3 INPS guides (Assegno unico, NASpI). The largest is 17%. No news articles: the other government and news sites refused automated fetches.

## Spelling and headword

- **Stress marks on forms.** Verb tables and headword lines write a stress mark on most forms (`diàmo`, `abbandonerèbbe`, `casétta`), which texts don't: 428,853 of 1,074,976 form rows in the plain import. Most cells also have an unmarked spelling, but 102,122 marked rows over 5,966 lemmas had none. Most are archaic or variant stems (`arài` under `avere`), but some are every form of a verb whose table failed to render (`bisógna` of `bisognare`, "one must": the common `bisogna` reached only the archaic noun). **Fixed:** `import.unmarkedStressForms` indexes a form without the marks before its last letter, only in a cell (tag set) that has no unmarked spelling, so a variant beside one (`vòi` next to `vuoi`) doesn't become `voi`. `lookupKey` stays as it is: final accents are spelling and tell words apart (`è`/`e`, `dà`/`da`, `papà`/`papa`).
- **Apostrophes.** The dump writes `'` (1,111 words); `lookupKey` maps `’` and `ʼ` to it. Nothing to do.
- **Headword: gender labels.** 64,162 of 66,593 nouns carry a gender (`Masc` 33,752, `Fem` 26,972, both 3,119, plural-only 316). An article in the lemma would need `il`, `lo` or `l'` by the next sound, so the default labels stay, and `labels.toml` explains `m`, `f`, `m/f` and `pl` for Italian.
- **Senses tagged archaic that aren't.** The importer drops archaic senses (3,202). Some Italian entries carry the tag on every sense though the word is current: `gente` "people" (all senses "archaic, poetic"), `carcere` "prison", and `altri` "masculine plural of altro". **Fixed** for `gente` in the grammar file and for `altri` by `headwordGenders`; `carcere` is on the hand-patch list.

## Tokens

- **Elision** (`elision = true`): `l'anno`, `dell'anno`, `un'altra`, `quest'anno`. The elided forms reach their words (`l'` → `la`, `lo`; `un'` → `uno`; `c'` → `ci`) or have grammar lines. Words with an entry of their own stay whole (`c'è`, `po'`, `quest'anno`).
- **Names blocked the split.** 121 one-word names contain an apostrophe (`D'Angelo`, `Dell'Acqua`, `Dell'Anno`, `Dall'Olio`), and a word with an entry of its own stays whole, so lowercase `dell'acqua` and `dell'anno` opened only on the surnames. **Fixed** in the elision feature, for every language: a name keeps the word whole only when the text writes it with the name's capitals; otherwise it follows the split. In French it adds `ascension` to `l'ascension` (the place name `L'Ascension` still comes first there in context).
- **Articulated prepositions.** di, a, da, in, su and con merge with the article (38 forms: `del`, `della`, `dell'`, `al`, `nel`, `sul`, `col`…). The dump has 14 phrases ending in one of the prepositions (`a causa di`, `grazie a`, `rispetto a`, `a partire da`, `nei confronti di`, `sulla base di`). **Fixed:** `context.contractions`, so `a causa della` opens on `a causa di`.
- **Misparsed table rows.** 81 rows tagged `error-unrecognized-form`, all wrong (53 under an idiom, 20 regional truncations under `essere`, 8 under `bello`). **Fixed:** `import.untrustedFormTags`. The 170 `error-unknown-tag` rows are real forms and stay.
- **Browser and API.** 4 to 6 of the 2,200 sampled words differ: an elided word whose phrase entry sits on the elided part (`tra l'altro`, `all'ordine del giorno`, `dall'Unione Europea`), where `collect.ts` renders the elided part's entries first and the extension the host's. The judge reads the extension's version. Left for the eval.

## Coverage

96.9% of corpus words had an entry in the plain import (spoken 97.9%, written 96.5%); 97.1% after r3 (spoken 98.3%, written 96.6%). The commonest words without one are names and brands (`Motorola`, `Ariston`, `Abarth`, `Mahmood`), English (`signature`, `league`, `song`, `input`, `display`), Roman numerals (`XX`, `III`, `XVI`), chemistry (`CO2`, `CH4`), acronyms (`ISEE`, `CAF`, `FCA`), fillers (`mh`), `carcere` (see above), and a caption slip (`dell` without its apostrophe).

- **Plurals and feminines** of nouns are on the headword line. **Fixed** before r0 with `import.headwordInflections`.
- **Adjective and determiner genders** are on the headword line too, but rows tagged `masculine` or `feminine` counted as related words (right for nouns: `attore`, `attrice`). 8,498 of 54,231 such forms reached no entry of their word: `altri`, `piccole` (only "plural of piccola", a small beer), `nostra` (only the pronoun), `bancaria`. **Fixed:** `import.headwordGenders`. Tried on French and Spanish: 4,645 and 6,682 forms more, but there most have pages of their own, and 63 corpus words opened on a rare adjective first (`journaux` "daily", `facetas` "witty"), so it stays off there.
- **Participles agree** (`stato`, `stata`, `stati`, `state`), but the tables list the masculine singular only, so `data` never reached `dare`, `messa` never `mettere`, `stata` never `essere`. **Fixed:** `import.participleDeclension` (`-o` to `-a`, `-i`, `-e`), for every form. With only forms no other word has (r2), `proposte`, `posta`, `detta` and `messa` lost their verbs, since many feminine participles are nouns too.

## Grammar words

`grammar.tsv`, 143 entries, written without a reader. The plain import's problems among the common words:
- **forms of essere and avere** glossed only as forms (`ha` "third-person singular present indicative of avere", `fu`, `sarà`, `fosse`, `erano`), `fu` opening on "deceased", `era` on "age". Their common forms are `AUX` lines ("has", "was", "will be"), with what the tense adds. `stato`, `stata`, `stati`, `state` have a "been" line; `stato` and `stati` keep a noun line first (`lo Stato`), and after essere or avere the participle hint puts the verb first.
- **articulated prepositions** with misleading first senses: `al` "with (an ingredient)", `alla` "-style, à la", `sulla` "plant of the genus Sulla", `dai` "come on!". Each has a line ("to the (a + il)") that keeps the other sense second.
- **clitics** opening on a letter or note: `ti` "letter T", `ci` "letter C", `mi` "the note mi". Lines for `mi ti si ci vi ne ce me te se`, with passive and impersonal `si`.
- **lines that replaced a sense Wiktionary had:** `sia` "both … and" (listing `sia AUX` dropped Wiktionary's conjunction), passive `si`. Restored in r2.
- **set phrases English Wiktionary lacks or glosses wrongly:** `a seguito di` ("synonym of in seguito a"), `sempre più`, `sempre meno`, `a quanto pare`, `quello che`, `da qui`, `e via`, `fare sì che`, `su tutto`, `si tratta di`.
- **Wiktionary gaps:** `gente`, `quest'` and `quell'` ("apocopic form of questo"), `tale` "a certain", relative `quale`, `ok` "granted", `eh`.
- **units after numbers** (`m`, `km`, `cm`, `mm`, `kg`, `g`, `mAh`, `Ah`): `m` gave the letter, `mAh` the interjection.

## Structure

- **Neighbour hints** (French's settings): Wiktionary ranks a noun whose lemma is a word before the verb whose form it is (`parte` before `partire`, `volta` before `voltare`).
  - `verbAfter`: the clitics `mi ti si ci vi ne li`, and `io`, `tu` (`si parte`, `ci vediamo`). Left out: `lo la le gli l'` (also articles), `non` (`non solo`), `lui lei noi voi loro` (also after a preposition).
  - `noVerbAfter`: articles, articulated prepositions and possessives that are never pronouns (`il potere` opens on "power").
  - `participleEndings`: of 27,287 one-word table participles, without their marks, 21,074 end in `-to` and 858 in `-so`; the rest have a clitic attached (5,260, `lavàtosi`) or are dashes. Listed by the letters before `-to`, declined, and `-nto` only as `-nto`, `-nta`: `-nti` and `-nte` also end present participles (`sono presenti` opened on `presentare`).
- **`si tratta di`.** `tratta` is also the feminine participle of `trarre`, which came first among the verbs after `si`. A phrase line fixes it.
- **Not relevant:** compounds are written apart or have entries; no verb bracket or separable particles; negation doesn't change case; reflexive verbs have pages of their own (`trovarsi`), so `import.reflexive` stays off. Hyphens are rare (`hyphenWords` off).

## What the general rules do here

- **Comparatives** are formed with `più`, which the reader clicks; its line gives "more (più grande, bigger)". `migliore`, `peggiore`, `maggiore` have entries.
- **Endings after numbers:** `l'11` (an elided article before a number) gave the letter L: one content failure, left.

## Coverage gaps (hand-patch list)

For a person to check:
- **words:** `carcere` "prison" (only senses tagged archaic), `gente` (the same; patched in the grammar file), `posizionatasi` and other participles with a clitic, `gestirsela`, `nasconderselo`.
- **senses:** `campo` "camp" (`campi profughi`), `destra` "the right (politics)", `ragazzi` "kids, young people", `teatro` "setting, scene", `senti` "listen, hey", `metterci` "to take (time)", `chiamarsi` "to be called" (only "what's your name?"), `super` "great", `popolare` in `casa popolare`, `lì` after a noun.
- **phrases:** `in termini di`, `a metà strada`, `mettere in crisi`, `entrare a far parte`, `prendere il nome di`, `fare uso di`, `passare di mano`, `cantar vittoria`, `fatte salve`, `dietro suggerimento di`, `in forma ridotta`.

## Log

All runs are in `../corpus/eval/out/it/` on the same 2,200 items (sample from `r0`). Judge: Haiku, `--effort medium`, `--concurrency 10`. Cells are understood %, then without the judge's `missing_word` misses.

| Run | Change | Common grammar | Common content | Random | All |
|---|---|---|---|---|---|
| r0 | plain import (`elision`, `contractions`, `headwordInflections`, `untrustedFormTags`) | 92.3% | 91.8% / 92.8% | 89.4% / 91.8% | 89.3% |
| r1 | grammar file, labels, neighbour hints, elision names, `headwordGenders`, `unmarkedStressForms`, participle declension | 95.7% | 94.4% / 94.5% | 91.4% / 93.1% | 92.1% |
| r2 | grammar senses and phrases; stress marks per cell; declension `onlyNew`; narrower participle endings | 98.8% | 94.4% / 94.8% | 91.1% / 93.0% | 92.8% |
| r3 | declension of every participle again, `-nto`, `si tratta di` | **99.0%** | **94.7%** / 94.8% | **91.3%** / 93.1% | 93.0% |

- Judging r0: 88 batches, $0.75; r1 18 batches, $0.18; r2 and r3 2 batches each. Caption repair: 22 Haiku workers, about 1.3M tokens.
- Classified diffs (gate sample only): r0 → r1, 424 changes, 219 words better, 182 same, 46 worse; r1 → r2, 59 changes, 27 / 25 / 10; r2 → r3, 27 changes, 12 / 12 / 5. Every "worse" was read:
  - r1: archaic stems with stress marks stripped (`voi` reached `volere`), fixed by the per-cell rule; `presenti` opening on `presentare` after `sono`, fixed by narrower endings; `tratta` on `trarre`, fixed by `si tratta di`; `sia` and `si` losing senses, restored; adjectives first in `caratteristiche`, `dipendenti`, `letterati` (`headwordGenders`, kept: the adjective is the same word); several were reorders the classifier rated backwards (`fatta` on `fare` in a passive).
  - r2: all ten from `onlyNew`, fixed in r3.
  - r3: `detta` and `state` rated worse while the note says better; `vinte` on `vincere` is right (`le ha vinte`); `volte` shows `volgere` second, after `volta`; `all'ordine` opens on `stare a` in a sentence with `stata` before it (left).
- Other languages: French changes only through the elision fix; Spanish none (`headwordGenders` off there).
- No false positives were added. Of the 7 common grammar words still failing in r3, 4 are idioms (`passare di mano`, `cantar vittoria`, `in forma`, `dietro suggerimento di`), 1 is a thin `con`, and 2 are model names (`500 C`, `Pro`).
