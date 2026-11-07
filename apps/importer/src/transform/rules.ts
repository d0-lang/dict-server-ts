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
  (typeof SKIPPED_SENSE_TAGS)[number] | "historical-stage" | "placeholder";

/** Wiktionary's text for a sense nobody could define; not a meaning. */
const PLACEHOLDER_GLOSS = "The meaning of this term is uncertain";

export const isPlaceholderGloss = (gloss: string): boolean =>
  gloss.startsWith(PLACEHOLDER_GLOSS);

/**
 * Whether a level's own `raw_glosses` text is labelled as out of use. `tags`
 * covers the whole path, so only this tells a dead parent from a dead child.
 */
export const hasDeadLabel = (
  language: LanguageRules,
  rawGloss: string | undefined,
): boolean => {
  const label = rawGloss?.match(/^\(([^)]*)\)/)?.[1];
  if (label === undefined) return false;
  const words = label.split(/[\s,]+/);
  return (
    words.includes("archaic") ||
    words.includes("obsolete") ||
    isHistorical(language, words)
  );
};

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
 * are English, so the list holds across languages. Comparatives and superlatives
 * count too: a reader of `лучше` or `besser` needs "comparative of good", not
 * the base word's entry alone. So do causatives: "causative of liegen: to
 * lay" is what `legen` means. Any other opening is a form:
 * a word missing from this list redirects to its target, it doesn't lose data.
 * An optional first word covers qualifiers ("endearing diminutive of").
 */
const OWN_ENTRY_OPENING =
  /^(?:\S+\s+)?(?:(?:female|male) equivalent|diminutive|augmentative|verbal noun|agent noun|frequentative|iterative|causative|singulative|abbreviation|initialism|acronym|clipping|ellipsis|(?:comparative|superlative)(?: degree)?) of\b/i;

export const isOwnEntryGloss = (
  gloss: string,
  ownEntryForms: ReadonlyArray<string> = [],
): boolean => {
  if (OWN_ENTRY_OPENING.test(gloss)) return true;
  // A language's own kinds (`ownEntryForms`): every word of an item opens the
  // gloss before its "of" ("adjectival past passive participle of" has `passive`).
  const opening = gloss.match(/^(.*?)\s+of\s/i)?.[1];
  if (opening === undefined) return false;
  const words = new Set(opening.toLowerCase().split(/\s+/));
  return ownEntryForms.some((item) =>
    item
      .toLowerCase()
      .split(/\s+/)
      .every((word) => words.has(word)),
  );
};

const DEGREE_OPENING =
  /^(?:\S+\s+)?(comparative|superlative)(?: degree)? of\s+([^\s(:;,]+)/i;

/** A comparative or a superlative. */
export type Degree = "comparative" | "superlative";

/** A comparative or superlative sense ("comparative degree of хоро́ший"). */
export const isDegreeGloss = (gloss: string): boolean =>
  DEGREE_OPENING.test(gloss);

/** The word a comparative or superlative gloss names (`хоро́ший`), if it is one. */
export const degreeBase = (gloss: string): string | undefined =>
  gloss.match(DEGREE_OPENING)?.[2];

/** Which degree a comparative or superlative gloss names. */
export const degreeOf = (gloss: string): Degree | undefined =>
  gloss.match(DEGREE_OPENING)?.[1]?.toLowerCase() as Degree | undefined;

/** Senses that only refer to another word: not copied onto derived words. */
export const isPointerGloss = (gloss: string): boolean =>
  /^synonym of\b/i.test(gloss);

/**
 * "Form of address" style glosses, which wiktextract reads as a `form-of` link
 * with the rest of the sentence as its target. Real form glosses never open
 * with these words: they name the form ("alternative form of x").
 */
export const isMisreadFormOf = (gloss: string): boolean =>
  /^form of\b/i.test(gloss);

const GRAMMAR_CASES: ReadonlySet<string> = new Set([
  "nominative",
  "genitive",
  "dative",
  "accusative",
  "instrumental",
  "locative",
  "vocative",
]);

const GRAMMAR_WORDS: ReadonlySet<string> = new Set([
  ...GRAMMAR_CASES,
  "singular",
  "plural",
  "masculine",
  "feminine",
  "neuter",
  "personal",
  "animate",
  "ani",
  "virile",
  "nonvirile",
  "nondeprecative",
  "old",
]);

/** Pages a sense links to in this language, keeping the text shown for each. */
const languageLinks = (
  language: LanguageRules,
  links: ReadonlyArray<ReadonlyArray<string>>,
) => {
  const anchor = `#${language.name}`;
  return links.flatMap((link) => {
    const [text, target] = link;
    return text !== undefined && target?.endsWith(anchor)
      ? [{ text, word: target.slice(0, -anchor.length) }]
      : [];
  });
};

/**
 * A form-of target that is really English, as when wiktextract reads `sich`
 * "Reflexive pronoun of the third person singular or plural: herself, ..." as a
 * form of "the third person singular or plural". Such a target is several
 * words, the lemma is one, and the sense doesn't link it as a word of the
 * language. The sense is then a gloss, not a link to nothing.
 */
export const isMisreadTarget = (
  language: LanguageRules,
  lemma: string,
  targets: ReadonlyArray<string>,
  links: ReadonlyArray<ReadonlyArray<string>>,
): boolean => {
  if (targets.length === 0 || hasWhitespace(lemma)) return false;
  // "czesać się" links its text to the page `czesać`, so either counts.
  const linked = new Set(
    languageLinks(language, links).flatMap((l) => [l.word, l.text]),
  );
  return targets.every((t) => hasWhitespace(t.trim()) && !linked.has(t));
};

/**
 * The target of a gloss like "vocative/locative singular of sens", which has no
 * `form-of` tag. Every word before "of" must be grammar and the rest must be a
 * link, so "forms genitive singular of neuter nouns" is not one.
 */
export const grammarPointerTarget = (
  language: LanguageRules,
  gloss: string,
  links: ReadonlyArray<ReadonlyArray<string>>,
): string | undefined => {
  const match = gloss.match(/^(.+?) of (.+)$/);
  if (match === null) return undefined;
  const words = match[1]!.toLowerCase().split(/[\s/]+/);
  if (
    !words.some((word) => GRAMMAR_CASES.has(word)) ||
    !words.every((word) => GRAMMAR_WORDS.has(word))
  ) {
    return undefined;
  }
  return languageLinks(language, links).find((l) => l.text === match[2])?.word;
};

/**
 * The words a "synonym of x" gloss points at. `links` covers the whole path and
 * topic labels, so only links whose text follows "synonym of" count.
 */
export const synonymTargets = (
  language: LanguageRules,
  gloss: string,
  links: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  if (!isPointerGloss(gloss)) return [];
  const rest = gloss.replace(/^synonym of\s+/i, "");
  return [
    ...new Set(
      languageLinks(language, links)
        .filter((l) => rest.includes(l.text))
        .map((l) => l.word),
    ),
  ];
};

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
    // The aspect Slavic templates write after a verb, then the romanization:
    // "passive of використовува́ти impf (vykorystovuváty)".
    const after = rest
      .slice(word.length)
      .replace(/^\s+(?:impf|pf)(?:\s+or\s+(?:impf|pf))?/, "")
      .replace(/^\s*\([^“)]*\)/, "");
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

/**
 * German verb tables list the perfect auxiliary (`haben`, `sein`) as a row, so
 * without this `haben` resolves to every verb that takes it.
 */
const isAuxiliaryRow = (form: WiktextractForm): boolean =>
  form.tags?.includes("auxiliary") ?? false;

/**
 * Usage labels of a spelling outside the standard language. A form-of link or
 * headword alternative carrying one is "marked": it only resolves when the
 * word reaches nothing else, so obsolete `für` ("alternative form of vor")
 * doesn't add `vor` to the everyday `für`, while a word that is only a
 * dialect spelling still finds its standard form.
 */
const MARKED_TAGS: ReadonlySet<string> = new Set([
  "obsolete",
  "archaic",
  "dated",
  "rare",
  "uncommon",
  "colloquial",
  "informal",
  "slang",
  "dialectal",
  "regional",
  "poetic",
  "literary",
  "humorous",
  "nonstandard",
  "proscribed",
  "misspelling",
  "pronunciation-spelling",
  "Internet",
  "Biblical",
  "historical",
  "extinct",
]);

export const isMarked = (tags: ReadonlyArray<string> = []): boolean =>
  tags.some((t) => MARKED_TAGS.has(t));

/** A headword-line spelling variant with a usage label: a marked link, not a form. */
export const isMarkedAlternative = (form: WiktextractForm): boolean =>
  form.source === undefined &&
  (form.tags?.includes("alternative") ?? false) &&
  isMarked(form.tags);

/** A headword-line form that names a case or number of the word itself (`моне́ти` genitive). */
const isHeadwordInflection = (tags: ReadonlyArray<string>): boolean =>
  tags.some((t) => GRAMMAR_CASES.has(t) || t === "plural") &&
  !tags.some(
    (t) =>
      HEADWORD_FORM_TAGS.relatedWord.has(t) ||
      t === "definite" ||
      t === "indefinite",
  );

/**
 * Whether a raw form is indexed as a form of its lemma. `noTable`: the entry's
 * inflection table lists no form (Ukrainian `монета`'s is all dashes), so the
 * cases and numbers its headword line gives (`моне́ти`, `моне́т`) are its forms,
 * articles apart (German `der` in `des CIA`).
 */
export const keepForm = (
  language: LanguageRules,
  lemma: string,
  form: WiktextractForm,
  noTable = false,
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
  if (tags.some((t) => language.untrustedFormTags?.includes(t))) return false;
  if (isVerbalNounForm(form)) return false;
  if (isAuxiliaryRow(form)) return false;
  if (isHistorical(language, tags)) return false;
  if (form.source === undefined) {
    if (isMarkedAlternative(form)) return false;
    if (noTable && isHeadwordInflection(tags)) return true;
    return (
      tags.some((t) => HEADWORD_FORM_TAGS.sameWord.has(t)) &&
      !tags.some((t) => HEADWORD_FORM_TAGS.relatedWord.has(t))
    );
  }
  return true;
};
