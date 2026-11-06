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
  ru: {
    code: "ru",
    name: "Russian",
    target: "en",
    // Old East Slavic is a separate language in the dump (orv).
    historicalStages: [],
    standardPronNotes: [],
    // Wiktionary writes ё; most texts write е (`все` for `всё`).
    optionalLetters: [["ё", "е"]],
    // Only 29 tables: the shared pronoun table and a Braille chart that gives
    // `азбука Брайля` every letter (`в`, `и`) as a form.
    untrustedFormTags: ["error-unrecognized-form"],
    // Russian stress is unpredictable, and learners need it to say the word.
    stressedLemmas: true,
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
