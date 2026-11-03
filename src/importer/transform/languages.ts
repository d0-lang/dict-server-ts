/**
 * Per-language import rules; rules shared by every language are in `rules.ts`.
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
};

/**
 * Supported source languages. To add one, add its rules here and check its
 * data (historical-stage tags, pronunciation notes) on a real extract first.
 */
export const LANGUAGES: Readonly<Record<string, LanguageRules>> = {
  pl: {
    code: "pl",
    name: "Polish",
    target: "en",
    historicalStages: [
      ["Middle", "Polish"],
      ["Old", "Polish"],
    ],
    standardPronNotes: ["normal speech", "prescriptive"],
  },
  de: {
    code: "de",
    name: "German",
    target: "en",
    // Middle and Old High German are separate languages in the dump (gmh, goh),
    // not tags on German senses.
    historicalStages: [],
    standardPronNotes: [],
  },
};

export const languagePair = (rules: LanguageRules): string =>
  `${rules.code}_${rules.target}`;

/** Whether the tags mark a historical stage of the language. */
export const isHistorical = (
  rules: LanguageRules,
  tags: ReadonlyArray<string> = [],
): boolean =>
  rules.historicalStages.some((stage) => stage.every((t) => tags.includes(t)));
