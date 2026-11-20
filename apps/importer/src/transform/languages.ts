import type { FeatureName } from "@dict/core/features";
import type { Language } from "@dict/core/language";

/**
 * Per-language import rules, read from `languages/<lang>/language.toml`
 * (`importRules`); rules shared by every language are in `rules.ts`.
 *
 * `rules.ts` and `pos.ts` were written against Polish data, so check them on a
 * real extract when adding a language too.
 */
export type LanguageRules = {
  /** wiktextract `lang_code` of the source language. */
  readonly code: string;
  /** Language name, as in the `#Polish` anchors of wiktextract links. */
  readonly name: string;
  /** Target (gloss) language; always English for the English Wiktionary dump. */
  readonly target: string;
  /**
   * Historical stages of the language. A sense, form or pronunciation is dropped
   * when its tags contain every tag of a stage. Each stage is a list because
   * wiktextract splits "Middle Polish" into the tags "Middle" and "Polish".
   */
  readonly historicalStages: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * `note` values on `sounds` that still mean the standard pronunciation
   * (other notes are regional variants, kept only when nothing else exists).
   */
  readonly standardPronNotes: ReadonlyArray<string>;
  /**
   * Letters that running text may write as another letter (`ё` as `е`), as
   * `[letter, plain]` pairs. Every form with `letter` is also indexed with
   * `plain`, ranked after the forms really spelled that way.
   */
  readonly optionalLetters?: ReadonlyArray<readonly [string, string]>;
  /**
   * Form tags that mark a misparsed table in this language's data, so the row
   * is dropped. Per language: Polish adjective tables carry
   * `error-unrecognized-form` on real forms.
   */
  readonly untrustedFormTags?: ReadonlyArray<string>;
  /**
   * Show the lemma with its stress marks: the headword's `canonical` form,
   * when it spells the same word (`соба́ка` for `собака`). Lookups still
   * match unstressed text, since `lookupKey` drops the marks.
   */
  readonly stressedLemmas?: boolean;
  /** With `headwordInflections`, an adjective's or determiner's headword genders are forms too (`bancaria` of `bancario`). */
  readonly headwordGenders?: boolean;
  /** Forms are also indexed without the stress marks before their last letter (`bisógna` -> `bisogna`). */
  readonly unmarkedStressForms?: boolean;
  /** Declined forms of adjectival participles, which tables list in the nominative only. */
  readonly participleDeclension?: {
    readonly tags: ReadonlyArray<string>;
    readonly ending: string;
    readonly endings: ReadonlyArray<string>;
    readonly onlyNew: boolean;
    readonly sharedWithParticiple: boolean;
  };
  /** Form-gloss openings that keep an entry of their own (`passive`, `active participle`): see `isOwnEntryGloss`. */
  readonly ownEntryForms?: ReadonlyArray<string>;
  /** Words that may make up a gloss opening that only names another word's form (`Yang-vowel form of -어서`): see `languagePointerTarget`. */
  readonly pointerWords?: ReadonlyArray<string>;
  /** Reflexive senses become an entry with the particle before or after the lemma (`bawić się`). */
  readonly reflexive?: "before" | "after";
  /** Without a table, the headword line's cases and numbers are forms (`structures` for `structure`). */
  readonly headwordInflections?: boolean;
  /** A verb form's chain goes on through a word with no verb entry (`partie` -> `parti` -> `partir`). */
  readonly verbChainsThroughEntries?: boolean;
  /** wiktextract parts of speech whose lines are not imported (Japanese `syllable`). */
  readonly skippedPos?: ReadonlyArray<string>;
  /** wiktextract parts of speech whose inflection tables are not indexed (Japanese `suffix`), unless the word is in `grammarWords`. */
  readonly formlessPos?: ReadonlyArray<string>;
  /** `lookupKey`s of the grammar file's words, set by the importer. */
  readonly grammarWords?: ReadonlySet<string>;
  /** This language's tags that give a headword feature, for any part of speech (`godan`, `-na`). */
  readonly featureTags?: Readonly<
    Record<string, readonly [FeatureName, string]>
  >;
  /** Head template name -> what the lemma gets added (`ja-verb-suru` -> `する`). */
  readonly lemmaSuffixes?: Readonly<Record<string, string>>;
};

/**
 * The import rules of a language record (`languages/<lang>/language.toml`),
 * flat, as the transform reads them.
 */
export const importRules = (language: Language): LanguageRules => ({
  code: language.code,
  name: language.name,
  target: language.target,
  ...language.import,
  optionalLetters: language.optionalLetters,
});

export const languagePair = (rules: LanguageRules): string =>
  `${rules.code}_${rules.target}`;

/** Whether the tags mark a historical stage of the language. */
export const isHistorical = (
  rules: LanguageRules,
  tags: ReadonlyArray<string> = [],
): boolean =>
  rules.historicalStages.some((stage) => stage.every((t) => tags.includes(t)));
