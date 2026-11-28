# Latvian (lv_en)

Tier: **Model only, unreviewed.** No reader of Latvian has checked this profile, the grammar file or any sample. Every point below rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-28: the two common gates pass and the random gate fails on missing words alone (see Log). No tier-2 work, no context benchmark (`gold/`).

Data: `data/raw/lv.jsonl`, filtered from the 2026-11-01 dump (134,448 lines, 117,944 of them pages for single forms). The plain import had 16,460 entries; `data/lv_en.sqlite` now has 18,048: 6,113 verbs (1,240 of them reflexives spelled from a verb's table), 5,780 nouns, 2,129 adjectives, 2,097 adverbs, 1,389 names, and 380 lines from the grammar file. English Wiktionary is thin for Latvian: Ukrainian has 38k entries, Russian 62k.

Corpus: `../corpus/lv`, 53 texts, 125,921 words, gathered 2026-11-28.
- **Spoken:** 75,571 words in 23 YouTube videos (auto-captions repaired by Haiku, 30 parts, all passing the check), 15 genres: interviews with a minister and the prime minister, a sport interview, a dermatologist, two history lectures, two radio talk shows, a business podcast, cooking, travel and nature shows, fishing, a flat renovation, a car review, and six everyday vlogs by ordinary people (a day in the life, a family abroad, student life, a Q&A, Minecraft). At most two per channel; the largest text is 8% of the spoken words.
- **Written:** 50,350 words in 30 texts, 18 genres: 24 lv.wikipedia articles and 6 LSM.lv articles (news, health, food, nature, a profile, sport). The largest is 10%. No government guides: latvija.gov.lv, vid.gov.lv and vsaa.gov.lv timed out from this machine. Blogs by ordinary people are hard to find in Latvian; the everyday vlogs stand in for them on the spoken side.

## Spelling and headword

- **Marks.** Texts write the long vowels and the softened consonants (`ā ē ī ū č ģ ķ ļ ņ š ž`), and so does the dump: no form outside a headword carries a mark texts leave out. `lookupKey` stays as it is.
- **Tone marks.** 394 headwords give a `canonical` spelling with Latvian's tone marks (`laĩva`, `ar̂t`, `cȩna`). Texts never write them, and with 2% of lemmas carrying them they would show on a few words only, so `stressedLemmas` stays off.
- **Headword: gender labels.** 5,624 of Wiktionary's 5,697 nouns carry a gender (`Fem` 2,908, `Masc` 2,697, either 19). Gender mostly follows the ending, but not always (`sirds` f, `puika` m), so the default labels stay, and `labels.toml` explains `m` and `f` for Latvian.

## Tokens

- **Abbreviations** are dotted (`u.c.`, `t.i.`, `piem.`, `g.`, `gs.`), and Chromium splits them at the period (`u`, `c`). They have grammar lines, which the abbreviations feature joins back (`u. c.` "and others").
- **Hyphens and apostrophes** are rare: 5 hyphenated words in the dump, none with an apostrophe, none in the corpus. `hyphenWords` and `elision` stay off.
- **Browser and API:** 0 of the 2,200 sampled words differ (r0), and the full browser collection of r4 (all 122,574 words, 14 minutes) shows the same word, entries and senses as the API's for every one.

## Coverage

78.4% of corpus words had an entry in the plain import (spoken 83.1%, written 70.9%); 83.3% after r4 (spoken 87.1%, written 77.3%). The words still without one are mostly ordinary words English Wiktionary has no Latvian entry for (`pieņemšana`, `ievēlēšana`, `pētnieks`, `atļauties`, `parunāt`), names (`Baltijas`, `Kurzemē`, `Latgales`, `PSRS`), English inside Latvian sentences (`the`, `of`, `from`, `YouTube`), and negated verbs (`nepatīk`, `nenotiek`, `negribās`, `neatceros`).

- **Missing words.** A check of the full 26 GB dump found no Latvian entry for `veidot`, `dati`, `savukārt`, `vispār`, `uzreiz`, `nosaukums`, `pieņemt`, `iegūt`, `mēģināt` and many more: a data gap, not an import one. The common ones are hand patches in the grammar file (see below); 121 of the 1,000 common words had no entry at r0, 2 at r4.
- **Pronoun headings as forms.** Latvian verb tables head each row with its pronoun (`es`, `tu`, `viņš`, `mēs`), which wiktextract keeps as a form tagged with a person and `indicative` but no tense: `mēs` "we" reached 907 verbs, and opened on `robot` "to notch". **Fixed** for every language: such a row is no form (it matches nothing in the other languages' dumps).
- **Reflexive verbs.** A reflexive verb is the verb with a suffix (`sākt` "to begin", `sākties` "to begin, of itself"), and the dump has 111 reflexive verbs against 3,249 verbs with a table, so `sākās`, `beidzās`, `mainās`, `izveidojās` had no entry (about 400 corpus words at r0). **Fixed:** a new setting, `import.reflexiveSuffix`, spells a verb's reflexive from its table with endings by tags (`sāka` > `sākās`, `sāk` > `sākas`, `sāku` > `sākos`, `sākam` > `sākamies`), as an entry "reflexive of sākt" with the verb's meanings, where the dump has no reflexive of its own and only with forms no other word has. 1,240 reflexives. Lithuanian builds reflexives the same way, with its own endings. Reflexives whose meaning drifted from the verb's have grammar lines (`izdoties` "to succeed", `izrādīties` "to turn out", `parādīties` "to appear", `tikties` "to meet").
- **Participles.** Past passive participles decline like adjectives (`saistīts`, `saistīta`, `saistītās`), and tables list only the masculine. Wiktionary has pages for some declined forms and not most. **Fixed:** `import.participleDeclension` with `onlyNew`, 6,913 forms; participles that are adjectives too (`noteikts` "definite") keep their own tables.
- **Definite adjectives** (`jaunajā`, `lielākie`) are in the adjective tables. The ordinals had no forms (`pirmajā`, `pēdējā`) and have lines.
- **A broken table.** `svērt` "to weigh" lists its past forms as bare endings (`u`, `i`, `a`, `ām`), so `a`, `i` and `u` reach it. One page; on the hand-patch list.

## Grammar words

`grammar.tsv`, 380 lines, written without a reader of Latvian; 135 for grammar words and phrases, 245 for common words the dump lacks. A second model (Gemini) reviewed the file on 2026-11-28: its fixes to `ja`, `jau`, `ā`, `vispār`, `vidējais`, `tikt` and `izmaksas` were taken, with six of its missing phrases (`gan jau`, `tā kā`, `kā arī`, `pie tam`, `ņemot vērā`, `jā`); its claims that `ja` never means "yeah" and that `šit` isn't a word were first rejected on the corpus counts (191 and 8 times), then confirmed by the user: the spoken `ja` is `jā` with its long mark lost in the captions, and `šit` is a clipped `šito`/`šitā`. Both lines are out; the captions keep the errors (Haiku's repair didn't fix them). The plain import's problems among the common words:
- **forms of būt** glossed only as forms (`ir` "third-person singular present indicative of būt"). They are `AUX` lines with what they do with another word: there is (`te ir veikals`), has (`man ir suns`), the perfect (`ir uzrakstījis`), "would be" (`būtu`), "must be" (`jābūt`).
- **the passive auxiliary** `tikt`: Wiktionary gives "to arrive at", so `tiek izmantots` "is used" read as "arrives". An `AUX` line for its forms, and one for `netiek`, `netika`, which comes first.
- **ranking:** `var` opened on `varš` "copper", and `varam`, `redzam`, `ejam` on their adverbial participles before the verb. Lines for the forms.
- **senses Wiktionary lacks:** `ja` "yes, right" (spoken), `jau` as a particle, `kāds` "some, a certain", `pats` "very, the same" (`pašā apakšā`, `tas pats`), `cik` "as … as", `tūlīt` "in a moment", `klāt` "here, in addition", `protams` "of course" (Wiktionary has only a participle), `apmēram` "about", `pagaidām` "for now".
- **set phrases English Wiktionary lacks:** `lai gan`, `vai nu`, `tajā skaitā`, `starp citu`, `no vienas puses`, `katrā ziņā`, `tikt galā`, `ņemt vērā`, `lielākā daļa`, `it īpaši`, `ik pa`, `kaut kas`.
- **fillers and abbreviations:** `ā`, `ē`, `mhm`, `okei`, `vot`, `paga` opened on a letter or nothing; `u.c.`, `t.i.`, `piem.`, `utt.`, `g.`, `gs.`, `km`, `kg`.

Without a reader, the classified diffs were the review (Log). Every "worse" was read: of 16 at r2, 13 were the classifier misreading a reorder (`jūs` lost three unrelated verbs and kept "you"); the real ones were fixed (`pazīstami` an adjective, `piekrist` lost Wiktionary's richer senses, `netiek galā` lost its phrase).

## Structure

- **Reflexives:** suffixes, not particles (see Coverage). `import.reflexive` and `context.reflexiveParticles` stay off.
- **Negation** is a prefix on the verb (`ne` + `sāk` = `nesāk`), and tables give only the negated infinitive (`nesākt`), so negated forms reach nothing unless Wiktionary has a page (`nezinu`, `nevar`). About 30 corpus word types are left (`nepatīk`, `nenotiek`, `negribās`, `nepietiek`). A tier-2 candidate: the same kind of setting as `reflexiveSuffix`, for verb forms with a prefix. Negation no longer changes case in everyday Latvian, so `context.negation` stays off.
- **Debitive** (`jāsāk` "must begin"): the table forms reach the verb, but the popover doesn't say "must" (2 partly-understood items). Tier 2.
- **Compounds** are written as one word (`rupjmaize`, `ārpakalpojumi`) and mostly missing. No `[compounds]` table yet: tier 2, with the segments benchmark.
- **Not relevant:** no verb bracket or separable particles; no articles.

## What the general rules do here

- **Comparatives** have entries (`lielāks` "bigger, larger; indefinite comparative degree of liels"); the definite comparative is the superlative (`lielākais`), which the judge read as a miss once (a false positive).
- **Numbers:** ordinals are written with a period (`1990. gadā`, `20. gs.`); the number and the word are separate tokens, so nothing to do.

## Hand-patch list

Words English Wiktionary lacks or gets wrong, for a reader to check and, once checked, to add to Wiktionary. Never filed on a model's word alone.
- **In the grammar file** (245 lines): common adverbs and linking words (`savukārt`, `vispār`, `uzreiz`, `iepriekš`, `principā`, `manuprāt`, `turklāt`, `tostarp`, `drīzāk`, `pakāpeniski`, `galvenokārt`, `pietiekami`, `toreiz`, `godīgi`, `beidzot`, `nekur`), prepositional words (`saskaņā`, `izņemot`, `pateicoties`, `neskatoties`, `salīdzinot`, `atšķirībā`), nouns (`nosaukums`, `dati`, `spēlētājs`, `priekšsēdētājs`, `vārti`, `komisija`, `periods`, `sēde`, `pakalpojums`, `pašvaldība`, `internets`, `izlase`), verbs (`veidot`, `nodrošināt`, `uzskatīt`, `iegūt`, `pieņemt`, `mēģināt`, `norādīt`, `sekot`, `paņemt`, `nopirkt`, `ietekmēt`) and adjectives (`piemērots`, `nozīmīgs`, `pazīstams`, `pēdējais`, `vidējais`).
- **Not yet patched:** the rest of the random gate's 342 missing words, mostly ordinary vocabulary (`pieņemšana`, `ievēlēšana`, `pētnieks`, `atļauties`, `parunāt`, `pārtraukums`, `pieaugušais`, `rīcība`, `reakcija`).
- **Data errors:** `svērt`'s table (past forms as bare endings); `noteikt` "to determine" (`nosaka`) is missing beside `noteikt` "to say firmly"; `tikt` lacks the passive auxiliary; `ikdiena` gives only "weekday"; `izmaksa` lacks "costs".

## Log

Gates from `../corpus/eval/out/lv/<run>/gate`, sample drawn at r0 and reused (`sample.ts --from ../r0/gate`). Grammar / content / random, each with the figure without the judge's missing words.

| Run | Change | Grammar | Content | Random | Coverage |
|---|---|---|---|---|---|
| r0 | plain import | 90.3 / 90.3 | 90.0 / 91.3 | 53.0 / 91.4 | 78.4% |
| r1 | pronoun headings, participles, grammar file (not judged) | | | | 83.0% |
| r2 | `reflexiveSuffix` | 97.7 / 97.7 | 95.3 / 96.1 | 59.2 / 91.5 | 83.3% |
| r3 | lines the r2 judge found missing; 7 false positives | 98.9 / 98.9 | 97.0 / 97.2 | 59.2 / 91.5 | 83.3% |
| r4 | `netiek galā` phrase restored | 98.9 / 98.9 | 97.2 / 97.4 | 59.2 / 91.5 | 83.3% |

- **r0** judged in two goes: the first stopped at 200 items on the 5-hour usage limit, after the caption repairs.
- **r0 → r2 diff** (gate sample, 343 changes): 285 better, 66 same, 16 worse; the worse ones are read above.
- **r2 → r3** (18 changes): 17 better, 1 worse (`netiek galā`), fixed in r4.
- **False positives** (`../corpus/eval/out/lv/false-positives.jsonl`, 7): plurals and cases read as their singular (`putnu`, `vietām`, `miljoniem`, `Lielu`, `gados`, `latvieši`), and the definite comparative as the comparative (`lielākais`).
- **Borrowed and colloquial words:** the judge leaves out foreign words (15 random items not counted: English inside Latvian sentences). Of the 342 missing random words, about 20 are slang, abbreviations or tech borrowings (`knapi`, `sūdīgi`, `šmuce`, `parkings`, `suši`, `PVN`, `MHz`, `UDP`); leaving them out would move the random gate by about 2 points, not to a pass.

**Tier 1 verdict:** the common gates pass. The random gate fails on missing words alone (91.5% without them, against 87.5%): Latvian needs hand patches or a better source, not rules.

## Tier 2 candidates

- Negated verb forms (`nepatīk`, `nenotiek`): a prefix setting next to `reflexiveSuffix`.
- The debitive (`jā-`) and the perfect's tense in the popover.
- Compounds (`[compounds]`), with the segments benchmark.
- Phrases with a negated verb (`neņēma vērā`), which need the negated form to reach the verb.
