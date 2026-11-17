# Spanish (es_en)

Tier: **Model only, unreviewed.** No reader of Spanish has checked this profile, the grammar file or any sample. Every point below rests on counts from the dump and the corpus, read by the developer agent, and the judge is Haiku. Tier 1 ran 2026-11-17 and all three gates pass (see Gates). No tier-2 work, no context benchmark (`gold/`).

Data: `data/raw/es.jsonl`, filtered from the 2026-11-01 dump (814,137 lines, most of them pages for single verb forms). `data/es_en.sqlite` has 126,354 entries, the most of any language so far.

Corpus: `../corpus/es`, 31 texts, 94,315 words, gathered 2026-11-17.
- **Spoken:** 51,342 words in 16 YouTube videos (auto-captions repaired by Haiku), 10 genres (food, tech, gaming, politics interviews, lifestyle, a podcast, science, history, sport, travel), at most two per channel. The largest text is 12% of the spoken words. Mostly from Spain; also Argentina, Colombia and Mexico.
- **Written:** 42,973 words in 15 texts, 13 genres: 12 es.wikipedia articles, cut at a section boundary near 3,300 words, and 3 government guides (consumer rights from consumo.gob.es, renting from the Junta de Andalucía, unemployment benefit from SEPE). The largest is 9%. All from Spain; no news articles.

## Quirks

### Spelling and headword

- **Accents.** Spanish accents tell words apart (`el` "the" and `él` "he", `si` and `sí`, `que` and `qué`, `mas` and `más`), and texts write them, capitals included. `lookupKey` keeps diacritics, so nothing to do.
- **Headword: gender labels, not articles.** 65,328 of 71,936 nouns carry a gender (`Masc` 36,353, `Fem` 24,191, both 4,337, plural-only 447). An article in the lemma would mislead where a learner needs it most: feminine nouns starting with a stressed a take `el` (`el agua`, `el águila`). So the default labels stay, and `labels.toml` explains `m`, `f`, `m/f` and `pl` for Spanish.
- **Nouns without a gender.** Most of the 6,608 are "female equivalent of" entries (`seguidora`, `tonta`, `coautora`), whose senses are all form-of, so the importer finds no shared tag, though the head template says `f`. The gloss says it. Not relevant.

### Tokens

- **Clitics are written onto the verb** (`hacerlo`, `dándose`, `dime`). Wiktionary's tables list every combined form (`hablándolo` under `hablar`), and 0 of the 50 commonest words without an entry were one. Nothing to do.
- **Contractions.** `del` and `al` (`de`, `a` + `el`) are words of their own. A phrase ending in `de` or `a` didn't match before them (`a partir del`, `en torno al`, `debido al`). **Fixed:** `context.contractions`.
- **Dotted abbreviations.** `a. C.` (4 times) is split into two sentences at `a.` by the segmenter, in the extension as in the API, so the entry `a. C.` is never found. `etc.` and `EE. UU.` are fine. Left.
- **Sentences over 500 characters.** Wikipedia sentences often run longer, and the extension then sends no sentence (1,706 of 92,740 words), so no phrase can be found: `así como`, `por ejemplo`, `en torno a`, `más allá de` in four common-word failures, which the API answers right. Same as French.
- **Misparsed table rows.** 604 rows are tagged `error-unrecognized-form`, and they are wrong: the combined forms of one-syllable verbs (`vete` and `vele` under `ver`, `date` under `dar`) and `este`, `aquel` as forms of `ese`. **Fixed:** `import.untrustedFormTags`.

### Coverage

97.6% of corpus words had an entry in the plain import (`r0`): spoken 98.3%, written 96.7%. What's left is names (`Linux`, `Cruyff`, `Picchu`), Roman numerals (`II`, `XIX`, `VII`: 80 tokens), units (`km`, `kg`, `nm`), chemistry (`CO2`, `NADPH`), English (`review`, `vlog`, `frames`), fillers (`hm`, `ehm`, `Mmm`), and diminutives Wiktionary has no page for (`saborcito`, `lentejitas`, `tranquilita`, `libretita`, `truquillo`).

- **Plurals.** Nouns and adjectives have no inflection tables; plurals and feminines are on the headword line. **Fixed** before r0 with `import.headwordInflections` (from French).
- **`vosotros`.** Its only sense is tagged `archaic` (Wiktionary's "Spain; Philippines, archaic"), so the importer dropped it, and `os` lost its link and opened on `ox` "shoo". **Fixed** in the grammar file.
- **Participles agree,** and the tables list all four forms (`hablado`, `hablada`, `hablados`, `habladas`), so `participleDeclension` stays off.

### Grammar words

`grammar.tsv`, 145 lines, written without a reader. Wiktionary's Spanish grammar words are better than its French ones, but the common words had these problems in the plain import:
- **letter names first:** `de`, `te`, `ese` opened on the letter (`de` "The name of the Latin script letter D").
- **wrong or misleading glosses:** `su` "apocopic form of suyo; used to express an approximate number", `sus` "your" only, `me` "Used as an emphatic pronoun or as an expletive", `nos` "we", `los` the pronoun before the article, `esto` "substitutes a noun one can't remember", `al` "upon", `cual` "suchlike", `muy` without its own entry.
- **plural demonstratives** (`estos`, `esas`) reached only the singular, with `ése` and `aquél` after it.
- **forms of ser, estar, haber, ir and poder:** `son` opened on "tone", `era` on "era, age", `he` on "here is", `hay` on "to have", `puede` and `va` on interjections. Their common forms are `AUX` lines ("are", "was", "there is", "can", "is going to"), with the tense, which the judge counts as what the form adds (`podía`, `habría`, `iba`, `hubiera`).
- **two verbs:** `creo` opened on `crear` "create" before `creer` "believe"; `sé` on `ser`.
- **set phrases English Wiktionary lacks or glosses wrongly:** `así es` ("so it goes"), `lo mismo` (only "perhaps"), `la verdad es que` (Wiktionary's `verdad es que` "it may be true that" opened 91 popovers), `es que` (only the explaining sense, on every literal `es que`), `el hecho de que` (`hecho de` matched `hacer de` "to pretend"), `eso sí`, `ahora sí`, `y demás`, `de cara a` "with a view to", `a golpe de` ("synonym of a fuerza de"), `inicio de sesión`, `cabeza fría`, `fuego alto/medio/bajo`, `mil por mil`, `mayoría simple`. A longer grammar-file phrase comes before Wiktionary's shorter one.
- **hesitation:** `ah` as "uh", `hm`, `ehm`.
- **units after numbers** (`g`, `kg`, `mg`, `km`, `cm`, `mm`, `nm`, `ml`): `g` gave the letter.

### Structure

- **Neighbour hints.** Wiktionary ranks a noun whose lemma is a word before the verb whose form it is (`trata` "trafficking" before `tratar`, `cuenta` before `contar`, `hace` "ago" before `hacer`). **Fixed** with the French settings:
  - `verbAfter`: the clitics `me te se nos os le les`, and `yo`, `tú`, `usted`, `ustedes` (`se trata`, `les digo`, `me sale`). The first round also had `no` and `él ella ellos ellas nosotros vosotros`; its diff showed `no como obra seria` opening on `comer` and `entre ellos uno` on `unir`, so they were left out.
  - `noVerbAfter`: articles and possessives that are never pronouns (`el poder` opens on "power"). The demonstratives are left out (`esto es`), and so is `al` (`al llegar`).
  - `participleEndings`: from the dump's tables, 9,263 masculine singular participles end in `-ado` (7,966), `-ido` (1,060), `-to` (140), `-ído` (57), `-cho` (25) and `-so` (3), plus their agreeing forms. `he estado` opens on `estar`, not "state".
- **Pronominal verbs.** Wiktionary has `hacerse cargo`, but the text says `se hizo cargo`: the phrase's verb is `hacerse`, and `hizo` is a form of `hacer`. Tier 2: a verb phrase whose verb ends in `-se` should match a form of the verb with a reflexive pronoun nearby.
- **Phrase entries that match ordinary text.** Wiktionary's `una de` "a great deal of" (81 popovers, mostly `una de las`, "one of the"), `de una` "synonym of de una vez" (117), `de esta` "definitely this time" (56), `se puede` "may I?" (72), `ser de` "synonym of hay que" (78). They open popovers wrongly, but the word's own entries follow and the judge failed none of them in the gate sample. Tier 2, like French `être à`.
- **Not relevant:** compounds are written apart (no splitting); no verb bracket, no separable particles; negation doesn't change case; reflexive verbs have pages of their own (`quedarse`, `irse`), so `import.reflexive` stays off.

### What the general rules do here

- **Comparatives:** formed with `más`, which the reader clicks. The irregular ones (`mejor`, `peor`, `mayor`, `menor`) have entries. The judge counts `más alto` on `alto` as a miss (a false positive) and superlatives like `el más antiguo` as a `form_gloss` miss (two content failures).
- **Hyphens:** rare in Spanish; `hyphenWords` stays off.

## Coverage gaps (hand-patch list)

Words and senses English Wiktionary lacks that the judge found, for a person to check:
- **words:** `vosotros` (has a page, but its only sense is tagged archaic), `izquierdas` (as in `las izquierdas`), `tranquilita`, `saborcito`, `lentejitas` and other diminutives, `hogadito`, `cts` (céntimos), `Voronoi`.
- **senses:** `hacer penitencia` "to do penance" (only "to diet"), `poder` "branch of government" (`Poder Judicial`), `menor` "lesser" (in value), `bloque lector` "reader's block", `opinión` "public opinion", `régimen` in `en régimen de`, `carácter` "nature" (of an institution), `I` and other Roman numerals, `español` NOUN "(man)" for the plural "Spaniards".
- **phrases:** `por no decir`, `a nivel general`, `dar una ducha`, `poner en vigor`, `a la orden del día`, `buena parte`, `de primeras`, `de estas características`, `en la misma línea`, `aprendizaje automático`, `bien de interés cultural`, `pasar a la historia`, `hacer fotos`, `dar coletazos`, `con motivo de`, `hasta la próxima`, `tomar una decisión`, `balance de blancos`, `a contratiempo`, `hacer presión`, `salarios de tramitación`, `dar la razón`, `hombre de pase`.

## Log

All runs are in `../corpus/eval/out/es/` on the same 2,200 items (sample from `r0`). Judge: Haiku, `--effort medium`, `--concurrency 10`.

| Run | Change | Common grammar | Common content | Random |
|---|---|---|---|---|
| r0 | plain import (`headwordInflections`, `untrustedFormTags`, `contractions`) | 90.6% | 93.1% | 91.1% |
| r1 | grammar file (135 lines) | 96.4% | 95.0% | 91.5% |
| r2 | 10 phrase lines (`es que`, `ahora sí`, `y demás`, `de cara a`, cooking heat, ...) | 97.7% | 95.0% | 91.5% |
| r3 | neighbour hints (`verbAfter`, `noVerbAfter`, `participleEndings`), 4 false positives | **98.4%** | **95.0%** | **91.6%** |

Without the judge's `missing_word` misses: random 92.3% (r0) and 92.4% (r3); the common gates have none left. Without the false positives, r3's grammar gate is 97.7%. Judge's overall understood: 90.3% (r0), 92.5%, 92.8%, 92.9% (r3).

Judging r0 cost $0.72 (88 batches, about 40 minutes, with 7 retries, while the full browser collection ran). Later runs judged only changed popovers (8, 1 and 1 batches).

The full browser collection (92,740 words, run once on r0) agreed with the API on every word the extension sent a sentence for. The first gate collection differed on 43 items, all in the sentence: the Wikipedia files had single newlines between paragraphs, which the page joins into one paragraph, and `[cita requerida]` tags inside sentences. The files were fixed (a blank line between paragraphs, tags removed) and re-collected.

Classified diffs (Haiku, words per verdict):
- **r0→r1** (gate sample): 131 better, 32 same, 8 worse. The worse were read. Six contradict their own reasoning or swap before and after (`de` in `2,5 g de plata` "now opens on the letter", which is the r0 popover). `de` in `tortilla de patatas` now opens on the phrase, which fits.
- **r1→r2** (whole corpus): 218 better, 105 same, 2 worse, both `y demás`, which the classifier says fits.
- **r2→r3** (whole corpus): 311 better, 383 same, 102 worse. Read by first entry instead: of 432 changes, 409 keep their first entry (the rest of the order changes), 291 move from a noun to its verb, 27 from a verb to its noun after a determiner. The verbs that now open wrongly are `para` in `yo para el análisis` (→ `parar`), and two transcription slips (`se uno tras otro`, `Habilita nos además`). Most of the classifier's worse are names moved above a verb (`Campo`, `Río`) or swap before and after (`el poder`).

Other languages: no code changed, only Spanish settings and files, and `language.test.ts` now lists `es`.

## Gates

| Gate | Needs | r0 | r3 |
|---|---|---|---|
| Common grammar words | 97.5% | 90.6% (90.7%) | **98.4%** of 557, 9 failing |
| Common content words | 92.5% | 93.1% (93.2%) | **95.0%** of 638, 32 failing |
| Random words | 87.5% | 91.1% (92.3%) | **91.6%** of 970 (92.4% without 8 missing words) |
| Common words without an entry (no gate) | | 0 | 0 |
| Judge: overall understood | | 90.3% | 92.9% |

In brackets: without the judge's `missing_word` misses.

What still fails among the common grammar words: the four long sentences (`así como`, `por ejemplo`, `en torno a`, `más allá de`), `hacerse cargo de` (pronominal verb phrase), `fuego` in `en fuego alto` (`en fuego` "on fire" ties with `fuego alto` and comes first), `hombre de pase`, `el nueve` (the number-nine striker) and `un no caso`.

### False positives

In `../corpus/eval/out/es/false-positives.jsonl`:
- `alto` in `más alto será el precio`: the comparative comes from `más`, which the reader clicks.
- `términos` in `en términos muy críticos`: "in very critical terms"; English says it the same way.
- `lugar` in `recuperando su lugar`: "regaining its place".
- `X` in `Clear X`, `Solid X`: product model names.

### Not counted, with a doubtful label

- `Pro` (`iPhone 15 Pro`) is labelled a name: right.

## Tier 2

Not started. Candidates:
- pronominal verb phrases (`hacerse cargo de`, `darse cuenta de`) matching `se` + a form of the verb;
- phrase entries that match ordinary text (`una de`, `de una`, `de esta`, `se puede`, `ser de`);
- productive diminutives (`-ito`, `-ita`, `-illo`) without a page of their own;
- Roman numerals (`siglo XIX`, `Felipe II`), shared with French;
- the 500-character sentence limit in the extension.
