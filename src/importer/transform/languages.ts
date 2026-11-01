/**
 * Per-language import rules. Everything language specific lives here; the
 * transform in `transform.ts` is generic.
 */
export type LanguageRules = {
  /** wiktextract `lang_code` of the source language. */
  readonly code: string;
  /** Target (gloss) language; always English for the English Wiktionary dump. */
  readonly target: string;
  /**
   * Tag combinations that mark a historical stage of the language. A sense,
   * form or pronunciation is dropped when its tags contain every tag of any set.
   * (Replaces the old hard-coded "Middle Polish" check.)
   */
  readonly excludedTagSets: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * `note` values on `sounds` that still mean the standard pronunciation
   * (other notes are regional variants, kept only when nothing else exists).
   */
  readonly standardPronNotes: ReadonlyArray<string>;
};

/** Sense tags dropped for every language. */
export const SKIPPED_SENSE_TAGS: ReadonlyArray<string> = [
  "archaic",
  "no-gloss",
];

/**
 * Supported source languages. To add one, add its rules here and check its
 * data (historical-stage tags, pronunciation notes) on a real extract first.
 */
export const LANGUAGES: Readonly<Record<string, LanguageRules>> = {
  pl: {
    code: "pl",
    target: "en",
    excludedTagSets: [
      ["Middle", "Polish"],
      ["Old", "Polish"],
    ],
    standardPronNotes: ["normal speech", "prescriptive"],
  },
};

export const languagePair = (rules: LanguageRules): string =>
  `${rules.code}_${rules.target}`;
