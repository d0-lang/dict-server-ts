# Italian (it_en) profile

Tier 1, in progress. Support tier: model only (no reader yet). Counts are from
`data/it_en.sqlite` built from the 2026-11 dump (`data/raw/it.jsonl`, 624,122
lines) on 2026-11-17. There is no Italian corpus yet, so nothing here is
measured on text: the corpus points wait for the texts listed in the draft PR.

## Import

164,462 entries: 66,593 nouns, 46,849 verbs, 25,743 adjectives, 17,137 names,
4,951 adverbs, 2,065 `X` (contractions and letters), 173 pronouns, 147
prepositions, 158 coordinating conjunctions, 74 determiners. 202,540 senses;
3,202 archaic senses dropped. 1,074,976 form rows. No invalid lines.

## Spelling: what's matched and what's shown

- **Stress marks on forms.** Wiktionary writes Italian verb tables and
  headword forms with marks texts don't write: `diàmo`, `davàmo`,
  `abbandonerèbbe`, diminutives `casétta`, `canìno`. 428,853 form rows (40%)
  carry an accent before the word's last letter. Every standard form checked
  also has its unmarked row (`diamo`, `davamo`, `parleremo`, `chiedevamo`,
  `casetta`). 102,122 marked rows have no unmarked twin under the same entry,
  over 5,966 lemmas, and they are archaic or alternative stems (`arài`,
  `averràggio` under `avere`, `reprobavàmo` under `riprovare`).
  Decision: **not relevant** for matching, no `lookupKey` change. Stripping
  marks would also merge real pairs texts keep apart (`è`/`e`, `dà`/`da`,
  `papà`/`papa`), so final accents must stay as they are. The marked rows are
  dead weight in the file; dropping them is a size cleanup for later.
- **Final accents** are real spelling and match as written: `città`, `perché`
  (3 entries), `è` (2).
- **Apostrophes.** The dump writes `'` (1,111 words) and once `ʼ`;
  `lookupKey` maps `’` and `ʼ` to `'`, so typographic apostrophes in texts
  match. Decision: fixed already.

## Tokens

- **Elision** (`elision = true`): `l'anno`, `dell'anno`, `un'altra`,
  `quest'anno`. The elided forms reach their full words (`l'` → `la`, `lo`;
  `un'` → `uno`; `c'` → `ci`; `d'` → `di`) or have entries of their own
  (`dell'`, `quest'`), and 745 lemmas contain an apostrophe, among them words
  that stay whole (`c'è` → `c'è`, `esserci`; `po'` → `poco`).
- **Articulated prepositions** are entries of their own (POS `X`, from
  Wiktionary's `contraction`): `del`, `della`, `nel`, `sul`, `col`, `dell'`…
  `context.contractions` maps all 38 forms of di, a, da, in, su, con to their
  preposition, so the 14 dump phrases ending in one (`a causa di`, `grazie a`,
  `rispetto a`, `a partire da`, `nei confronti di`, `sulla base di`) match
  `a causa del`, `grazie all'aiuto`.
- `untrustedFormTags = ["error-unrecognized-form"]`: 81 misparsed rows (53
  under `avere gli occhi foderati di prosciutto`, 20 regional truncations
  under `essere`, 8 under `bello`). The 170 `error-unknown-tag` rows are real
  forms and stay.

## The headword

Gender is stored for 64,162 of 66,593 nouns. Italian gender is mostly
predictable from the ending (-o, -a) but not for -e nouns (`il fiore`, `la
chiave`). Decision: open; `[headword] labels = ["Gender"]` or articles
(`il`/`la` need `lo`/`l'` by the next sound, so labels are the simpler fit).

- **Names block the elision split.** Through the server, lowercase
  `dell'acqua` and `dell'anno` open only on the surnames `Dell'Acqua` and
  `Dell'Anno`: a word with an entry of its own stays whole, and the
  capitalised name counts as one. 153 names contain an apostrophe, 121 of
  them one word (`D'Angelo`, `D'Amico`, `Dall'Olio`, `Dell'Utri`).
  `nell'anno` and `un'altra` split as they should. Decision: **to fix** in the
  elision feature, as a general rule: a name doesn't keep a lowercase word
  whole. Not started (time).
- **Phrases through contractions** work on the server: `a causa della` opens
  on `a causa di`, `grazie all'aiuto` on `grazie a`, `rispetto al` on
  `rispetto a`.

## Ranking (to check at r0)

On the server, `dei` opens on the contraction, then `dio`; `alla` on the
contraction, then `a`. Two open on the wrong word for a beginner:

| Word | Opens on now | Should open on |
|---|---|---|
| `sulla` | `sulla` (a plant) | su + la |
| `dai` | `dai` (interjection "come on!"), then `dare` | da + i, then the others |

Decision: grammar lines in `languages/it/grammar.tsv` for the articulated
prepositions, after the r0 judge run shows how often they're read wrong.

## Not done yet

- Corpus: none. Candidates are listed in the draft PR.
- Collect, sample and judge `r0`; gates.
- `grammar.tsv`, `labels.toml`, the headword decision.
- Context settings French and Spanish have (`verbAfter`, `noVerbAfter`,
  `participleEndings`, `participleDeclension`): not checked against Italian
  data yet, so left out.

## Log

- 2026-11-17: first import, settings above.
