import { compoundRules } from "./features/compounds/split.ts";
import { abbreviationEntryIds } from "./features/abbreviations.ts";
import { hyphenEntryIds } from "./features/hyphenWords.ts";
import { phraseEntryIds } from "./features/phrases/match.ts";
import { separableEntryIds } from "./features/separableVerbs.ts";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import {
  dropLiteralPointers,
  loadEntries,
  type LookupEntry,
  type LookupResult,
} from "./common/entries.ts";
import { findEntriesWithCompounds } from "./features/compounds/lookup.ts";
import { articleLookup, presentResult } from "./headword.ts";

/**
 * A lookup: the word's own entries (`common/entries.ts`), or its parts when it
 * has no entry and the language splits compounds (`features/compounds/`).
 * When the client sends `context`, the sentence adds entries first, one
 * feature per file in `features/`: the phrases the word is part of there, the
 * abbreviation or hyphen-joined word it is a piece of, and the separable verb
 * it belongs to. Which features a language uses, and how, is in its
 * `language.toml`.
 */

/** Entries that read the same: same lemma (spacing aside: `и т. д.`, `и т.д.`), part of speech and senses. */
const entryId = (entry: LookupEntry) =>
  JSON.stringify([
    entry.lemma.toLowerCase().replace(/\s+/g, ""),
    entry.pos,
    entry.senses,
  ]);

/**
 * The entries for `word`, before they become headwords. With `context`, the entries that match it come
 * first: the phrases the word is part of there, then the abbreviation it is a
 * piece of (`т` in `т.д.`), then the hyphen-joined word it is part of (`что`
 * in `что-нибудь`), then the separable verb it belongs to, then the word's
 * own entries (and their segments, re-indexed).
 * An own entry already shown that way is dropped.
 */
const contextLookup = (
  db: DictionaryDb,
  language: Language,
  word: string,
  context?: string,
  at?: number,
): LookupResult => {
  const base = findEntriesWithCompounds(db, word, compoundRules(language));
  if (context === undefined || context.trim() === "") return base;

  const phraseIds = phraseEntryIds(db, word, context, language, at);
  const abbreviationIds = abbreviationEntryIds(
    db,
    word,
    context,
    language,
    at,
  ).filter((id) => !phraseIds.includes(id));
  const hyphenIds = hyphenEntryIds(db, word, context, language, at).filter(
    (id) => !phraseIds.includes(id) && !abbreviationIds.includes(id),
  );
  const separableIds = language.context.separableVerbs
    ? separableEntryIds(db, word, context, language, at).filter(
        (id) => !phraseIds.includes(id),
      )
    : [];
  const seen = new Set<string>();
  const first = dropLiteralPointers(
    loadEntries(db, [
      ...phraseIds,
      ...abbreviationIds,
      ...hyphenIds,
      ...separableIds,
    ]),
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
