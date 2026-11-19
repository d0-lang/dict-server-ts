# How lookups work

What the server does with a lookup, on top of the dictionary file. The fields and rules of the answer are the protocol's (`../protocol/PROTOCOL.md`, [d0-lang/protocol](https://github.com/d0-lang/protocol/blob/main/PROTOCOL.md)).

## Headwords

A lookup answers with headwords, as the protocol defines them (`apps/server/src/lookup/headword.ts`): the stored lemma with its article where the language has `[headword] articles` (`der Hund`, `der/das Bonbon`), the grammar features as `labels` elsewhere (`соба́ка` `f`, `anim`), and entries with the same headword merged. Entries whose grammar differs stay apart (`der See` "lake", `die See` "sea"); the importer already splits them. `see` links name their targets' headwords, and a lookup of such a headword with its article (`der See`) finds it.

## Ranking and compounds

Lookups rank entries in one query, using what the import stored: first by case (a lowercase word shows lowercase lemmas first, so `oder` gives "or" before the river `Oder`; acronyms go last unless the word is all caps), then the entry whose lemma is the word itself before the words it is a form of (`Frage` before `fragen`), then import order. For German, a word with no entry is split into known parts (`Gemüsefonds` -> `Gemüse` + `Fond`, linking `-s-`, `-n-`, `-en-`, ... allowed) and their entries are returned in reading order (`apps/server/src/lookup/features/compounds/`), with `segments` that slice the word as sent (`Schifffahrt` | `s` | `geschichte`). If normalizing changed the word's length (decomposed accents, spaces around it), the entries come without segments.

## With the sentence

With `context` (and `at`, which copy of the word was clicked), the entries matching the sentence come first (`apps/server/src/lookup/features/`, one file per feature; `lookup.ts` puts them in order). Each carries `match`, the parts of the sentence it covers as written, for the client to highlight:

- phrases the word is part of: multi-word forms of multi-word entries, all in a row (`vor allem`, `Stanów Zjednoczonych`). Only a verb phrase's verb may be inflected (`miało miejsce` -> `mieć miejsce`) or stand apart from the rest in its clause (`tritt morgen in Kraft`). In German it must come first, and the rest must end the clause, so `ist an` in `Er ist an der Uni` isn't `an sein`. Longest phrase first, at most three
- German separable verbs: the clicked verb with the particle that ends its clause, or the clicked particle with the nearest verb before it, when particle + verb is a form of a verb starting with that particle (`fand ... statt` -> `stattfinden`; `geht mit ihr` stays `gehen`)
- then the word's own entries, without those already shown

The phrase index is built at startup, about 0.5 s for German. A lookup with context takes about 0.7 ms on average for German and 0.35 ms for Polish, against 0.2 ms without.
