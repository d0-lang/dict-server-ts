import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { contextRules } from "../common/contextRules.ts";
import { formRows } from "../common/forms.ts";
import { endsClause, positionsOf, tokenize } from "../common/tokenize.ts";

/** Verb entries of `particle` + `verb`, joined (`statt` + `fand`) or as a two-word form (`rief an`). */
const separableIds = (
  db: DictionaryDb,
  verb: string,
  particle: string,
): ReadonlyArray<number> =>
  [`${particle}${verb}`, `${verb} ${particle}`].flatMap((form) =>
    formRows(db, form)
      .filter((row) => {
        const lemma = lookupKey(row.lemma);
        return (
          row.pos === "VERB" &&
          !lemma.includes(" ") &&
          lemma.startsWith(particle) &&
          lemma !== particle
        );
      })
      .map((row) => row.id),
  );

/**
 * Entry ids of the separable verb `word` belongs to in `context`, for German:
 * the finite verb with its particle at the end of the clause (`Er fand gestern
 * statt`), whichever of the two was clicked. Only a particle-verb pair that is
 * a form in the dictionary counts, so `mit` in `geht mit ihr` is no particle.
 */
export const separableEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): ReadonlyArray<number> => {
  const locale = language.code;
  const { conjunctions } = contextRules(language);
  const tokens = tokenize(context, locale);
  const ids: Array<number> = [];
  for (const clicked of positionsOf(tokens, word, locale, { context, at })) {
    const { key, clause } = tokens[clicked]!;
    // The clicked word is the verb: its particle ends the clause.
    for (let j = clicked + 1; j < tokens.length; j++) {
      if (tokens[j]!.clause !== clause) break;
      if (endsClause(tokens, j, conjunctions)) {
        ids.push(...separableIds(db, key, tokens[j]!.key));
        break;
      }
    }
    // The clicked word is the particle: the nearest verb before it that forms one.
    if (endsClause(tokens, clicked, conjunctions)) {
      for (let j = clicked - 1; j >= 0; j--) {
        if (tokens[j]!.clause !== clause) break;
        const found = separableIds(db, tokens[j]!.key, key);
        if (found.length > 0) {
          ids.push(...found);
          break;
        }
      }
    }
  }
  return [...new Set(ids)];
};
