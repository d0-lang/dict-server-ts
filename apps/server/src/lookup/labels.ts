import type { DictionaryDb } from "@dict/core/DictionaryDb";
import {
  explainLabel,
  readLabels,
  type LabelExplanation,
} from "@dict/core/labels";
import type { Language } from "@dict/core/language";
import { headwordOf } from "./headword.ts";

/**
 * The explanations `/v1/get-labels` sends for a pair: one for each label
 * string its lookups can show, and no others. Which those are depends on the
 * dictionary (the grammar its entries have, `m/f` included) and the language
 * (German shows gender as the article, so `de_en` has no `m`), so they are
 * read from the file, as `headwordOf` would show them. A label with no
 * explanation is left out; the client shows it as it always did.
 */
export const pairLabels = (
  db: DictionaryDb,
  language: Language,
): Readonly<Record<string, LabelExplanation>> => {
  const explanations = readLabels(language);
  const articles = [
    ...new Set(Object.values(language.headword.articles ?? {})),
  ];
  // Whether the lemma already starts with an article (`die Alten`), which
  // then shows the gender as a label.
  const startsWithArticle =
    articles.length === 0
      ? "0"
      : articles
          .map(
            (_, i) =>
              `substr(lemma, 1, length(?${i + 1}) + 1) = ?${i + 1} || ' '`,
          )
          .join(" OR ");
  const rows = db.$client
    .query<{ pos: string; features: string; article: number }, Array<string>>(
      `SELECT DISTINCT pos, features, (${startsWithArticle}) AS article
       FROM entries WHERE features IS NOT NULL`,
    )
    .all(...articles);
  const shown = new Set(
    rows.flatMap(
      (row) =>
        headwordOf(
          language,
          row.article === 1 ? `${articles[0]} -` : "-",
          row.pos,
          row.features,
        ).labels,
    ),
  );
  // Labels the lookup adds to a form (`て form`).
  for (const ending of language.context.analyzer?.formEndings ?? []) {
    shown.add(ending.label);
  }
  return Object.fromEntries(
    [...shown].sort().flatMap((label) => {
      const explanation = explainLabel(explanations, label);
      return explanation === undefined ? [] : [[label, explanation]];
    }),
  );
};
