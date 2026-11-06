import { compoundRules } from "./compounds.ts";
import {
  abbreviationEntryIds,
  hyphenEntryIds,
  phraseEntryIds,
  separableEntryIds,
} from "./context.ts";
import type { DictionaryDb } from "@dict/core/DictionaryDb";
import {
  dropLiteralPointers,
  findEntriesWithCompounds,
  loadEntries,
  type LookupEntry,
  type LookupResult,
} from "./queries.ts";

/** Languages whose verbs leave a particle at the end of the clause. */
const SEPARABLE: ReadonlySet<string> = new Set(["de"]);

/** Entries that read the same: same lemma (spacing aside: `и т. д.`, `и т.д.`), part of speech and senses. */
const entryId = (entry: LookupEntry) =>
  JSON.stringify([entry.lemma.toLowerCase().replace(/\s+/g, ""), entry.pos, entry.senses]);

/**
 * A `/v1/lookup` result. With `context`, the entries that match it come
 * first: the phrases the word is part of there, then the abbreviation it is a
 * piece of (`т` in `т.д.`), then the hyphen-joined word it is part of (`что`
 * in `что-нибудь`), then the separable verb it belongs to, then the word's
 * own entries (and their segments, re-indexed).
 * An own entry already shown that way is dropped.
 */
export const lookupWord = (
  db: DictionaryDb,
  pair: string,
  word: string,
  context?: string,
): LookupResult => {
  const lang = pair.split("_")[0]!;
  const base = findEntriesWithCompounds(db, word, compoundRules(pair));
  if (context === undefined || context.trim() === "") return base;

  const phraseIds = phraseEntryIds(db, word, context, lang);
  const abbreviationIds = abbreviationEntryIds(db, word, context, lang).filter(
    (id) => !phraseIds.includes(id),
  );
  const hyphenIds = hyphenEntryIds(db, word, context, lang).filter(
    (id) => !phraseIds.includes(id) && !abbreviationIds.includes(id),
  );
  const separableIds = SEPARABLE.has(lang)
    ? separableEntryIds(db, word, context, lang).filter(
        (id) => !phraseIds.includes(id),
      )
    : [];
  const seen = new Set<string>();
  const first = dropLiteralPointers(
    loadEntries(db, [...phraseIds, ...abbreviationIds, ...hyphenIds, ...separableIds]),
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
