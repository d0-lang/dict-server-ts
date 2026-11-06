import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import { contextRules } from "../common/contextRules.ts";
import { formRows } from "../common/forms.ts";
import {
  capitalisedInside,
  endsClause,
  positionsOf,
  tokenize,
  type ContextHit,
  uniqueHits,
} from "../common/tokenize.ts";

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

/** The nearest word before `particle`, from `from` on, that may be a verb and forms a separable verb with it. */
const nearestVerb = (
  db: DictionaryDb,
  tokens: ReturnType<typeof tokenize>,
  particle: number,
  from: number,
  mayBeVerb: (i: number) => boolean,
): number | undefined => {
  for (let j = particle - 1; j >= from; j--) {
    if (tokens[j]!.clause !== tokens[particle]!.clause) return undefined;
    if (
      mayBeVerb(j) &&
      separableIds(db, tokens[j]!.key, tokens[particle]!.key).length > 0
    ) {
      return j;
    }
  }
  return undefined;
};

/**
 * Entry ids of the separable verb `word` belongs to in `context`, for German:
 * the finite verb with its particle at the end of the clause (`Er fand gestern
 * statt`), whichever of the two was clicked. Only a particle-verb pair that is
 * a form in the dictionary counts, so `mit` in `geht mit ihr` is no particle.
 * A conjunction may end the clause or only join two words inside it (`bei der
 * Gesetzgebung und Verwaltung mit`), so from the verb every such end is tried
 * in turn. A particle found past a conjunction is the verb's only if no word
 * after that conjunction forms one with it (`geht heim und kommt mit`: `mit`
 * is `kommen`'s). Where nouns are capitalised (`context.capitalNouns`), a
 * capitalised word inside the sentence is no verb (`die Spiele ... an`), and
 * no particle (`habe ... in der Hand`).
 */
export const separableEntryIds = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): ReadonlyArray<ContextHit> => {
  const locale = language.code;
  const { conjunctions } = contextRules(language);
  const tokens = tokenize(context, locale);
  const hits: Array<ContextHit> = [];
  const add = (ids: ReadonlyArray<number>, verb: number, particle: number) =>
    hits.push(...ids.map((id) => ({ id, tokens: [verb, particle] })));
  const mayBeVerb = (i: number) =>
    !(language.context.capitalNouns && capitalisedInside(context, tokens, [i]));
  for (const clicked of positionsOf(tokens, word, locale, { context, at })) {
    const { key, clause } = tokens[clicked]!;
    // The clicked word is the verb: its particle ends the clause.
    let pastConjunction: number | undefined;
    for (let j = clicked + 1; mayBeVerb(clicked) && j < tokens.length; j++) {
      if (tokens[j]!.clause !== clause) break;
      if (!endsClause(tokens, j, conjunctions)) continue;
      const found = mayBeVerb(j) ? separableIds(db, key, tokens[j]!.key) : [];
      if (found.length === 0) {
        // The end of the clause, or a conjunction inside it: look past it.
        if (j + 1 >= tokens.length || tokens[j + 1]!.breakBefore) break;
        pastConjunction = j + 2;
        continue;
      }
      if (
        pastConjunction === undefined ||
        nearestVerb(db, tokens, j, pastConjunction, mayBeVerb) === undefined
      ) {
        add(found, clicked, j);
      }
      break;
    }
    // The clicked word is the particle: the nearest verb before it that forms one.
    if (mayBeVerb(clicked) && endsClause(tokens, clicked, conjunctions)) {
      const verb = nearestVerb(db, tokens, clicked, 0, mayBeVerb);
      if (verb !== undefined) {
        add(separableIds(db, tokens[verb]!.key, key), verb, clicked);
      }
    }
  }
  return uniqueHits(hits);
};
