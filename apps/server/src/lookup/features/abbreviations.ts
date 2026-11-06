import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { contextRules } from "../common/contextRules.ts";
import { type FormRow, formRows } from "../common/forms.ts";
import { positionsOf, tokenize } from "../common/tokenize.ts";

/**
 * Ways to write the dotted run of `parts` as a form, longest first: with the
 * word before it when that can belong to it (`и т. д.`), then alone; spaced
 * and unspaced (both are indexed), with the final period and without.
 */
const abbreviationSpellings = (
  parts: ReadonlyArray<string>,
  lead: string | undefined,
): ReadonlyArray<string> =>
  [...(lead !== undefined ? [`${lead} `] : []), ""].flatMap((before) =>
    [". ", "."].flatMap((joiner) => {
      const run = parts.join(joiner);
      return [`${before}${run}.`, `${before}${run}`];
    }),
  );

/**
 * Entry ids of the abbreviation the context word `word` is a piece of, in
 * any language (with the word before it when that is one of the language's
 * `context.abbreviationLeads`): `т` or `д` in `т.д.` (browsers send the piece alone),
 * `z` in `z.B.`. The pieces are the run of words joined by a period and at
 * most one space. As with hyphenated words, the client doesn't say which
 * occurrence was clicked, so every occurrence must be a piece of an
 * abbreviation the dictionary has.
 */
export const abbreviationEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
): ReadonlyArray<number> => {
  const locale = language.code;
  const leads = contextRules(language).abbreviationLeads;
  const tokens = tokenize(context, locale);
  const ids: Array<number> = [];
  for (const clicked of positionsOf(tokens, word, locale)) {
    let first = clicked;
    let last = clicked;
    while (tokens[first]!.dottedBefore) first--;
    while (tokens[last + 1]?.dottedBefore === true) last++;
    if (first === last) return [];
    // The longest run around the clicked piece that is a form: a period and a
    // space also end a sentence, so `т.д. лежали` holds `т. д.`.
    let found: ReadonlyArray<FormRow> | undefined;
    for (
      let length = last - first + 1;
      length >= 2 && found === undefined;
      length--
    ) {
      for (
        let start = Math.max(first, clicked - length + 1);
        start <= Math.min(clicked, last - length + 1);
        start++
      ) {
        const parts = tokens
          .slice(start, start + length)
          .map((token) => token.key);
        const before = tokens[start - 1];
        const lead =
          before !== undefined &&
          !tokens[start]!.dottedBefore &&
          !tokens[start]!.breakBefore &&
          leads.has(before.key)
            ? before.key
            : undefined;
        found = abbreviationSpellings(parts, lead)
          .map((spelling) => formRows(db, lookupKey(spelling)))
          .find((rows) => rows.length > 0);
        if (found !== undefined) break;
      }
    }
    if (found === undefined) return [];
    // One entry per spelling written with or without spaces (`и т. д.`, `и т.д.`).
    const spellings = new Set<string>();
    for (const row of found) {
      const spelling = lookupKey(row.lemma).replace(/\s+/g, "");
      if (spellings.has(spelling)) continue;
      spellings.add(spelling);
      ids.push(row.id);
    }
  }
  return [...new Set(ids)];
};
