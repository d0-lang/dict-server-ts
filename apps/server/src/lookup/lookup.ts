import { compoundRules } from "./features/compounds/split.ts";
import { abbreviationEntryIds } from "./features/abbreviations.ts";
import { hyphenEntryIds } from "./features/hyphenWords.ts";
import { phraseEntryIds } from "./features/phrases/match.ts";
import { separableEntryIds } from "./features/separableVerbs.ts";
import { analyzedLookup } from "./features/analyzedWords/lookup.ts";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import {
  dropLiteralPointers,
  loadEntries,
  type LookupEntry,
  type LookupResult,
} from "./common/entries.ts";
import { findEntriesWithCompounds } from "./features/compounds/lookup.ts";
import { elidedResult } from "./features/elision.ts";
import { orderByNeighbours } from "./features/neighbours.ts";
import {
  capitalisedInside,
  capitalisedNext,
  preceded,
  type ContextHit,
  matchStrings,
  positionsOf,
  tokenize,
} from "./common/tokenize.ts";
import { articleLookup, presentResult } from "./headword.ts";

/**
 * A lookup: the word's own entries (`common/entries.ts`), or its parts when it
 * has no entry and the language splits compounds (`features/compounds/`) or
 * writes elided words onto the next word (`features/elision.ts`). When the
 * client sends `context`, the sentence adds entries first, one feature per
 * file in `features/`. A language takes one of two paths there:
 *
 * - With an analyzer (`context.analyzer`, a script without spaces), the
 *   analyzer's features alone (`features/analyzedWords/`): the whole word the
 *   clicked piece is part of, and the phrases and constructions around it.
 * - Otherwise, the features of a language written with spaces: the phrases
 *   the word is part of, the abbreviation or hyphen-joined word it is a piece
 *   of, the separable verb it belongs to, and its neighbours' say in the
 *   order of its own entries.
 *
 * The two never call each other (`paths.test.ts`), so a change for one kind
 * of language leaves the other alone. Which features a language uses, and
 * how, is in its `language.toml`.
 */

type Capitals = Parameters<typeof findEntriesWithCompounds>[3];

/**
 * The word's own entries: by its forms, or by its parts as a compound, or as
 * an elided word and the word it is written onto (`l'homme`), where the
 * language writes them as one (`features/elision.ts`).
 */
const ownEntries = (
  db: DictionaryDb,
  language: Language,
  word: string,
  capitals?: Capitals,
): LookupResult => {
  const whole = findEntriesWithCompounds(
    db,
    word,
    compoundRules(language),
    capitals,
  );
  if (!language.elision) return whole;
  return (
    elidedResult(db, word, whole, (host) =>
      ownEntries(db, language, host, capitals),
    ) ?? whole
  );
};

/** Entries that read the same: same lemma (spacing aside: `и т. д.`, `и т.д.`), part of speech and senses. */
const entryId = (entry: LookupEntry) =>
  JSON.stringify([
    entry.lemma.toLowerCase().replace(/\s+/g, ""),
    entry.pos,
    entry.senses,
  ]);

/**
 * The entries for `word`, before they become headwords: with `context`, by
 * the language's path (the analyzer's, or `spacedLookup`), else its own.
 */
const contextLookup = (
  db: DictionaryDb,
  language: Language,
  word: string,
  context?: string,
  at?: number,
): LookupResult => {
  const analyzed = language.context.analyzer !== undefined;
  if (context === undefined || context.trim() === "") {
    const plain = ownEntries(db, language, word);
    // No sentence was sent and the word has no entry. If the language has an
    // analyzer, let it split the word by itself, as it would in a sentence:
    // `お送り` has no entry, but the analyzer reads it as the prefix `お` and
    // `送り`, a form of `送る`, so the lookup shows `送る`.
    if (plain.entries.length > 0 || !analyzed) return plain;
    return analyzedLookup(db, word, word, language) ?? plain;
  }
  // The word the analyzer finds around the click; when that is just the
  // word, its own entries.
  if (analyzed) {
    return (
      analyzedLookup(db, word, context, language, at) ??
      ownEntries(db, language, word)
    );
  }
  return spacedLookup(db, language, word, context, at);
};

/**
 * The entries for `word` in `context`, in a language written with spaces:
 * the entries that match the sentence come first, the phrases the word is
 * part of there, then the abbreviation it is a piece of (`т` in `т.д.`), then
 * the hyphen-joined word it is part of (`что` in `что-нибудь`), then the
 * separable verb it belongs to, then the word's own entries (and their
 * segments, re-indexed), in the order its neighbours give them
 * (`features/neighbours.ts`). An own entry already shown that way is dropped.
 */
const spacedLookup = (
  db: DictionaryDb,
  language: Language,
  word: string,
  context: string,
  at?: number,
): LookupResult => {
  // The features' token indexes are into this same tokenization.
  const tokens = tokenize(context, language.code);
  const clicked = positionsOf(tokens, word, language.code, { context, at });
  const capitalInside =
    language.context.capitalNouns &&
    capitalisedInside(context, tokens, clicked);
  // The word's own entries, ordered by its neighbours where the language
  // says how (`je passe` opens on `passer`).
  const base = orderByNeighbours(
    db,
    language,
    word,
    tokens,
    clicked,
    ownEntries(db, language, word, {
      capitalInside,
      capitalNext: capitalInside && capitalisedNext(tokens, clicked),
      nominalized:
        capitalInside &&
        preceded(tokens, clicked, new Set(language.context.nominalizers)),
    }),
  );

  const among = (hits: ReadonlyArray<ContextHit>) => (hit: ContextHit) =>
    hits.some((other) => other.id === hit.id);
  const phraseHits = phraseEntryIds(db, word, context, language, at);
  const abbreviationHits = abbreviationEntryIds(
    db,
    word,
    context,
    language,
    at,
  ).filter((hit) => !among(phraseHits)(hit));
  const hyphenHits = hyphenEntryIds(db, word, context, language, at).filter(
    (hit) => !among(phraseHits)(hit) && !among(abbreviationHits)(hit),
  );
  const separableHits = language.context.separableVerbs
    ? separableEntryIds(db, word, context, language, at).filter(
        (hit) => !among(phraseHits)(hit),
      )
    : [];
  const hits = [
    ...phraseHits,
    ...abbreviationHits,
    ...hyphenHits,
    ...separableHits,
  ];
  const seen = new Set<string>();
  const first = dropLiteralPointers(
    loadEntries(
      db,
      hits.map((hit) => hit.id),
    ).map((entry, i) => ({
      ...entry,
      match: matchStrings(context, tokens, hits[i]!.tokens),
    })),
  ).filter((entry) => {
    const id = entryId(entry);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (first.length === 0) return base;

  const shown = new Set(first.map(entryId));
  const newIndex = new Map<number, number>();
  const rest = base.entries.filter((entry, i) => {
    if (shown.has(entryId(entry))) return false;
    newIndex.set(i, first.length + newIndex.size);
    return true;
  });
  const segments = base.segments?.map((segment) => {
    const entries = segment.entries?.flatMap((i) => {
      const moved = newIndex.get(i);
      return moved === undefined ? [] : [moved];
    });
    return entries === undefined || entries.length === 0
      ? { text: segment.text }
      : { text: segment.text, entries };
  });
  return {
    entries: [...first, ...rest],
    ...(segments !== undefined ? { segments } : {}),
  };
};

/**
 * A `/v1/lookup` result, with headwords as the protocol sends them
 * (`presentResult`). A headword with its article (`der See`, how `see` names
 * it) finds the entries with that headword.
 */
export const lookupWord = (
  db: DictionaryDb,
  language: Language,
  word: string,
  context?: string,
  at?: number,
): LookupResult => {
  const article = articleLookup(language, word);
  if (article !== undefined) {
    const found = presentResult(
      db,
      language,
      findEntriesWithCompounds(db, article.word, compoundRules(language)),
    ).entries.filter((entry) => entry.lemma === article.headword);
    if (found.length > 0) return { entries: found };
  }
  return presentResult(
    db,
    language,
    contextLookup(db, language, word, context, at),
  );
};
