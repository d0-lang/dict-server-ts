# German (de_en)

Tier: **Reviewed** in principle (the user reads German), but this profile and the grammar lines added on 2026-11-06 are not reviewed yet. German passed tier 1 on 2026-11-06, after eight iterations. It has no context benchmark (`gold/`) yet, and the segments benchmark exists from earlier work.

Data: `data/raw/de.jsonl`, filtered from the 2026-11-01 dump. `data/de_en.sqlite` (schema v4) has 104,409 entries and about 578k forms:
- 59,464 nouns, 54,416 of them (92%) with a gender, which the headword shows as an article (`der Hund`);
- 20,508 adjectives;
- 10,279 verbs;
- 9,141 names.

The build from before this round is in `data/backup-2026-11-06-before-de-t1/`.

Corpus: `../corpus/de`, 38 texts, 70,438 tokens.
- **Spoken:** 34,404 words in 16 texts across 11 genres. Five speeches and an interview are on politics. Eleven videos were added on 2026-11-06 and repaired by Haiku: food, tech, science, history, two lifestyle vlogs, gaming, sport, news, kids' news and travel. The largest text is 12% of the spoken words.
- **Written:** 37,587 words in 22 texts across 18 genres. The largest is 20%. Eight are Wikipedia articles, and the rest are news, guides and articles.

## Quirks

### Spelling and headword

- **Spelling.** Nothing to normalize: no marks the dump writes and texts drop. `ß` and `ss` are different spellings and stay apart.
- **Headword.** Nouns show their article (`[headword] articles`). The 8% without a gender are mostly acronyms and abbreviations (`EU`, `SMS`).
- **Capitals.** Every noun is capitalized, which shows in two places:
  - **Ranking.** Without context a capitalized word may just start a sentence, so its entries rank as for a lowercase word. With context, `context.capitalNouns` ranks capitalized lemmas first for a capitalized word inside a sentence (`In wenigen Tagen` gives `der Tag` before `tagen`). Single letters are left out, and so are adjectives before another capitalized word (`der Deutschen Bahn`, `Großen Freiheit`), where an adjective takes a capital as part of a name. Polish and Russian leave the setting off: there a capital inside a sentence usually starts a multi-word name (`Pałac Saski`), and a surname entry would lead.
  - **Sampling.** The eval sampler used to treat any word that is always capitalized as a name. That dropped 340 of the 1,000 common words (`Jahren`, `Menschen`, `Geschichte`). `../corpus/eval/sample.ts` now trusts a capital only when the dictionary writes the word's nouns in lowercase. The German sample drops 26 names.

### Tokens

- **Abbreviations with periods.** The extension's sentence splitter cuts at `z. B.`, `Art. 53a` and `Abs. 1`, so the server gets `…Ferienwohnungen z.` or `…sieht Art. 53a Abs.` as the whole sentence. It can't tell an abbreviation from a sentence end there. This is the client's job (not fixed), and the judge counts those items as misses (`z`, `Art`, `schreibt … vor`).
- **Hyphenated words** (`Orang-Utan`, `Deutsch-Französische`) are split by the segmenter. German doesn't use `hyphenWords`, and `Orang-Utans` gives nothing for `Utans`. Left for tier 2.

### Coverage

97.1% of corpus tokens have an entry, and 3.7% are found only as split compounds (`Gemüsefonds`). The tokens with no entry:
- **names:** `Baader`, `Ensslin`, `Torvalds`, `Guardiola`, `Jasmund`;
- **product words and loanwords:** `Fold`, `Foldables`, `Kernel`, `Splitscreen`, `Lockscreen`, `VPN`, `PPI`;
- **technical terms:** `Stromatolithen`, `Phycobilisomen`, `Reduktans`;
- **decades:** `1970er`, `1990er`;
- **abbreviations:** `CO2`, `IOC`.

None of these is an importer bug. Declined participles without an entry (`ausgelegte`, `entworfenen`, about 90 tokens) are fixed below.

### Grammar words and irregular forms

`grammar.tsv` has about 300 lines. On 2026-11-06 the round added:
- **past and subjunctive forms of `sein`, `haben`, `werden` and the modals,** where Wiktionary's entry only said "to be": `war`, `wäre`, `sei`, `seien`, `hatte`, `hätte`, `wurde`, `würde`, `worden`, `konnte`, `könnte`, `musste`, `müsste`, `sollte`, `wollte`, `durfte`, `dürfte`, `möchte`;
- **units and abbreviations.** The dump spells some of them as other words: `kg` was only `KG` "basement", and `km` only `KM` "base rent". New lines: `g`, `mg`, `m`, `cm`, `mm`, `ml`, `min`, `TL`, `EL`, `Abs`, and `ca.` as "about";
- **set phrases English Wiktionary lacks:** `zur Verfügung stehen/stellen`, `zum Ausdruck bringen/kommen`, `in Höhe von`, `in Form von`, `im Laufe`, `im Verlauf`, `im Falle`, `ins Spiel kommen`, `ins Gespräch kommen`, `an Bedeutung gewinnen/verlieren`, `auf den Markt bringen/kommen`, `allen voran`, `im Handel`, `außer Kraft setzen/treten`, `daran liegen`;
- **fuller senses:** `zur Zeit` was only "at the time"; `nach` "about" (`die Frage nach`); `davon` "of them"; `beim` "with, in the case of"; `relativ` and `wesentlich` as adverbs; `super` "great, very";
- **the declined forms of `weiter`** ("further, additional": `weitere`, `weiteren`, `weiterer`, `weiteres`, `weiterem`). Wiktionary has `weiter` only as an adverb, so these were forms of `weit` "wide".

### Comparatives and superlatives

German has 190 comparative entries (`größer`) and 4,692 superlative ones (`größten`, `besten`). Their declined forms (`größte`, `beste`, `jüngeren`) are rows of the base's table, so the reader saw "big" for "biggest".

Decided with the user: an irregular one (an umlaut or another stem) gets both entries, base first (`größte`: `groß`, then `größten`), through `FormSource.Degree`. A regular one (`schnellere`, `wichtigsten`) stays with its base alone. German has 747 such forms, Polish 23 and Russian 2.

The user would also like both entries for common regular words, but the importer has no word frequencies. Those get grammar lines instead (`weiter` above).

Superlative entries read "superlative degree of wichtig: important", and the judge wants "most important". That is how the dictionary labels them: an override, as for Russian.

### Structure

- **Separable verbs** (`separableVerbs`, `clauseConjunctions`).
  - **A conjunction inside the clause** (`wirken … bei der Gesetzgebung und Verwaltung mit`) no longer stops the search for the particle. A particle found past the conjunction counts only if no word after the conjunction forms a verb with it (`geht heim und kommt mit`).
  - **A capitalized word inside the sentence** is never the verb or the particle (`die Spiele … an` is not `anspielen`, `in der Hand` is not `handhaben`).
  - Still missed: a particle after a comma (`fand 1356, der letzte 1669 statt`), and one followed by `wie` (`bieten sich … an wie etwa`).
- **Causatives.** "causative of liegen: to lay" was read as a pure form pointer and dropped, so `legen` meant only "to lie down, to castrate" and `setzen` only "to sit down". `causative` now counts as a word of its own, in every language.
- **Declined participles** (`import.participleDeclension`, now with `tags` and `onlyNew`). Tables list participles undeclined (`ausgelegt`, `vorspringend`), and each gets the five adjective endings: 148,225 forms. They are added only where no other entry has the form (`onlyNew`): Wiktionary lists many participles as adjectives (`bestehend` "existing", `folgend`, `gewünscht`), and adding the verb in front of those cost 116 corpus popovers. Polish leaves `onlyNew` off, because there an adjective often has only a figurative sense (`zniszczony` "beat-up" for `zniszczonych` "destroyed"), and turning it on made 21 Polish popovers worse against 46 better.
- **Reflexive verbs.** `sich setzen` "to sit down" and `sich legen` show after the causative sense now. German doesn't use `import.reflexive` yet (tier 2).
- **Verb bracket** (`verbBracket`). On, unchanged. `Rede und Antwort … zu stehen`, with three words in the gap, is missed.

### Known trade-offs of this round

- **Nominalized infinitives** (`zum Binden`, `das Tragen`, `am Reisen`, `durch Drücken`). The capital put unrelated nouns first (`die Binde`, `die Trage`, `der Reis`). `context.nominalizers` lists the words after which a capitalized infinitive is likely the verb used as a noun (`zum`, `beim`, `das`, `dem`, `durch`, possessives), and there the verb stays on top with the nouns. Decided with the user: it can't be perfect, so both entries stay. After other words the noun comes first (`in wenigen Tagen`, `zwei Binden`).
- **Capitalized adjectives without a capitalized noun after them** (`Bad Kleinen`, `die Deutschen`) now lead with the noun (`die Kleine` "girl", `Deutsch` the language).
- **Modal lines for main-verb uses** (`wollten einen Toten haben`). The "wanted to" line leads, with the full verb second.
- **Unit lines for initials and other abbreviations** (`Hans M.`, `g.g.A.`) lead with "metre" or "gram".
- **Compound splits through new participle forms.** `Supportende` splits as `Supp|ortende`, because `ortende` is now a form of `orten`.

## Gates

**Tier 1 passes** (run `../corpus/eval/out/de/t1-r8`, 2026-11-06). Every run uses the same 2,200 items. Rounds 1–6 were judged with the earlier judge prompt, and round 8 with the current one.

| Gate | Needs | Baseline | Round 8 |
|---|---|---|---|
| Common grammar words | 97.5% | 94.8% | **98.4%** |
| Common content words | 92.5% | 88.9% | **93.4%** |
| Random words | 87.5% | 85.5% | **88.3%** |
| Overall understood | | 88.9% | 91.3% |

Three things changed in how the gates count, all decided with the user on 2026-11-06:
- **The limits** went from 100, 95 and 90% to 97.5, 92.5 and 87.5%. The judge itself is noisy: re-judging the same popovers from scratch moved content words by about a point.
- **The judge prompt:** a word whose meaning here comes from another word the reader can click is no miss, when its own popover gives its meaning (`mit` in `mit … rechnen`).
- **Not counted:** foreign words, names, transcription slips, URL pieces, and false positives.

German has 3 false positives (`../corpus/eval/out/de/false-positives.jsonl`): `denen` in `von denen`, `überall ran(kommen)`, and `sein` in `wird … gewesen sein`.

In the corpus-wide diff against the baseline, the classifier rated about 2,240 words better and 70 worse; the worse ones are the trade-offs above. Polish has one change (`mędrszy` also lists `mądrzejszy`), and Russian has none.

The rounds:
1. grammar lines, the separable conjunction rule, `capitalNouns`, declined degree forms;
2. causatives, the degree pass after form-of links, more grammar lines;
3. irregular degree forms on both entries, base first;
4. no capitalized word as verb or particle;
5. declined participles;
6. `participleDeclension.onlyNew`, `nominalizers`;
7. `ihr` "it", `Moment!`;
8. `Moment!` removed again, since its line put "wait" before the noun everywhere.

**Left for tier 2:**
- **Phrases the matcher can't place:**
  - a rest that is only an adverb (`daran liegen`);
  - coordination (`außer Kraft oder außer Anwendung gesetzt`);
  - long gaps (`Rede und Antwort … zu stehen`);
  - verb-first phrases whose rest is a preposition (`es geht um`).
- **Senses English Wiktionary lacks:** `eben` "namely", `einmal` softening, `Moment!`, `dran`, `unterwegs`. These are on the hand-patch list below.
- **Random words:** 52 have no entry (compounds, loanwords, technical terms).

## Coverage gaps (patch by hand later)

- **Senses missing for common words:**
  - `Moment` "wait!" as an interjection;
  - `eben` "namely";
  - `gehen um` "to be about";
  - `setzen auf` "to rely on";
  - `jünger` "recent";
  - `Disziplin` "a sport's event";
  - `Westen` "the West";
  - `parallel` "at the same time";
  - `cool` "great";
  - `neu` "again";
  - `vorsehen` "to provide for";
  - `stehen unter` "to be under (a licence)".
- **Words with no entry:**
  - `Kernel`, `Splitscreen`, `Lockscreen`, `VPN`, `PPI`;
  - `Tankrabatt`, `Entschuldung`, `Beantwortung`, `Fähranleger`, `Knöpfle`;
  - `Orang-Utan`, `Ayatollah`;
  - `zitronig`, `fachlich`, `wilhelminisch`.
