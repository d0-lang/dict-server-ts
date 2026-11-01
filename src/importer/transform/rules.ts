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

/**
 * Gloss openings of `form-of` / `alt-of` senses that describe a word of its own
 * rather than a grammatical form of another word. Matched on the text because
 * tags can't tell these apart (`feminine` is also on inflections). All glosses
 * are English, so the list holds across languages. Any other opening is a form:
 * a word missing from this list redirects to its target, it doesn't lose data.
 * An optional first word covers qualifiers ("endearing diminutive of").
 */
const OWN_ENTRY_OPENING =
  /^(?:\S+\s+)?(?:(?:female|male) equivalent|diminutive|augmentative|verbal noun|agent noun|frequentative|iterative|singulative|abbreviation|initialism|acronym|clipping|ellipsis) of\b/i;

export const isOwnEntryGloss = (gloss: string): boolean =>
  OWN_ENTRY_OPENING.test(gloss);

/** Senses that only refer to another word: not copied onto derived words. */
export const isPointerGloss = (gloss: string): boolean =>
  /^synonym of\b/i.test(gloss);

/**
 * Whether a derived gloss has nothing beyond its target: "diminutive of kotek",
 * or "diminutive of па́лка (pálka)" with a romanization. Anything else, like
 * "diminutive of dziewczyna; little girl", already explains the word.
 */
export const isBareDerivedGloss = (
  gloss: string,
  targets: ReadonlyArray<string>,
): boolean => {
  const rest = gloss.replace(/^.*?\bof\s+/is, "").toLowerCase();
  return targets.some((target) => {
    const word = target.trim().toLowerCase();
    if (!rest.startsWith(word)) return false;
    const after = rest.slice(word.length).replace(/^\s*\([^“)]*\)/, "");
    return /^[\s.,;:]*$/.test(after);
  });
};

const hasWhitespace = (text: string): boolean => /\s/.test(text);

/**
 * Conjugation tables list the verbal noun, which is a word of its own. It only
 * resolves to the verb when the dump has no line for it.
 */
export const isVerbalNounForm = (form: WiktextractForm): boolean =>
  form.tags?.includes("noun-from-verb") ?? false;

/** Whether a raw form is indexed as a form of its lemma. */
export const keepForm = (
  language: LanguageRules,
  lemma: string,
  form: WiktextractForm,
): boolean => {
  const word = form.form.trim();
  if (word === "" || word === "-" || word === "—") return false;
  // "będę robił", "bym robił": multi-word forms of a single-word lemma are not
  // indexed, to keep the index small. Each word still resolves on its own, but a
  // tokenizer sending the whole span finds nothing (see docs/importer-notes.md).
  if (hasWhitespace(word) && !hasWhitespace(lemma)) return false;
  if (word.startsWith("-") || word.includes("(")) return false;
  const tags = form.tags ?? [];
  if (tags.some((t) => TEMPLATE_FORM_TAGS.has(t))) return false;
  if (isVerbalNounForm(form)) return false;
  if (isHistorical(language, tags)) return false;
  if (form.source === undefined) {
    return (
      tags.some((t) => HEADWORD_FORM_TAGS.sameWord.has(t)) &&
      !tags.some((t) => HEADWORD_FORM_TAGS.relatedWord.has(t))
    );
  }
  return true;
};
