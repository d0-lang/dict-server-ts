import type { WiktextractForm } from "../source/wiktextract.ts";
import { isHistorical, type LanguageRules } from "./languages.ts";

/**
 * Keep-or-drop decisions for senses and forms. The tag lists here are shared by
 * every language; language-specific rules live in `languages.ts`.
 */

/**
 * Sense tags that drop the sense. The tag is also the reason counted in the
 * stats; when a sense has several, the first one listed here is counted.
 */
const SKIPPED_SENSE_TAGS = ["archaic", "no-gloss"] as const;

/**
 * `historical-stage` is our own label for a match on the language's
 * `historicalStages`, unrelated to wiktextract's `historical` tag.
 */
export type SkippedSenseReason =
  (typeof SKIPPED_SENSE_TAGS)[number] | "historical-stage";

/** Rows of an inflection table that are template metadata, not words. */
const TEMPLATE_FORM_TAGS: ReadonlySet<string> = new Set([
  "table-tags",
  "inflection-template",
  "class",
  "canonical",
  "romanization",
]);

/**
 * `forms` rows without a `source` come from the headword line. Most are
 * related *words* (diminutives, aspect partners, feminine equivalents, the
 * derived adverb), which must not resolve to this lemma. A row is kept only
 * when it has a `sameWord` tag and no `relatedWord` tag.
 */
const HEADWORD_FORM_TAGS: {
  readonly sameWord: ReadonlySet<string>;
  readonly relatedWord: ReadonlySet<string>;
} = {
  sameWord: new Set(["alternative", "comparative", "superlative"]),
  relatedWord: new Set([
    "adjective",
    "adverb",
    "augmentative",
    "demonym",
    "derived",
    "diminutive",
    "feminine",
    "masculine",
    "neuter",
    "abbreviation",
    "imperfective",
    "perfective",
    "frequentative",
    "surname",
    "noun-from-verb",
  ]),
};

/** Why a sense with these tags is dropped, or undefined when it is kept. */
export const skipSense = (
  language: LanguageRules,
  tags: ReadonlyArray<string>,
): SkippedSenseReason | undefined =>
  SKIPPED_SENSE_TAGS.find((tag) => tags.includes(tag)) ??
  (isHistorical(language, tags) ? "historical-stage" : undefined);

/** Whether a raw form is indexed as a form of its lemma. */
export const keepForm = (
  language: LanguageRules,
  lemmaHasSpace: boolean,
  form: WiktextractForm,
): boolean => {
  const word = form.form.trim();
  if (word === "" || word === "-" || word === "—") return false;
  // "-(e)m robił", "będę robił": analytic forms of single-word lemmas are not
  // something a single-word lookup can hit, and they bloat the index.
  if (!lemmaHasSpace && /\s/.test(word)) return false;
  if (word.startsWith("-") || word.includes("(")) return false;
  const tags = form.tags ?? [];
  if (tags.some((t) => TEMPLATE_FORM_TAGS.has(t))) return false;
  if (isHistorical(language, tags)) return false;
  if (form.source === undefined) {
    return (
      tags.some((t) => HEADWORD_FORM_TAGS.sameWord.has(t)) &&
      !tags.some((t) => HEADWORD_FORM_TAGS.relatedWord.has(t))
    );
  }
  return true;
};
