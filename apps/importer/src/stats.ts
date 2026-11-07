import type { TransformResult } from "./transform/transform.ts";

export type ImportStats = {
  readonly pair: string;
  readonly input: string;
  readonly out: string;
  readonly linesScanned: number;
  readonly languageLines: number;
  readonly invalidLines: number;
  readonly entries: number;
  readonly mergedLines: number;
  readonly linesWithoutEntry: number;
  readonly senses: number;
  readonly skippedSenses: {
    archaic: number;
    historicalStage: number;
    noGloss: number;
    placeholder: number;
  };
  readonly pronunciations: number;
  readonly droppedForms: number;
  readonly forms: {
    lemma: number;
    inflection: number;
    formOf: number;
    abbreviation: number;
    letterVariant: number;
  };
  readonly formOfLinks: number;
  readonly formOfUnresolved: number;
  readonly historicalEntries: number;
  readonly derivedCopied: number;
  readonly derivedBare: number;
  /** Comparative-only entries folded into the same word's other entry. */
  readonly degreeMerged: number;
  /** Comparative-only entries spelled like a plain form of their base, left to the base. */
  readonly degreeDropped: number;
  /** Irregular declined comparatives and superlatives that also reach their degree entry (`größte` -> `größten`). */
  readonly degreeForms: number;
  /** Declined participles indexed where no other entry had the form (`ausgelegte`). */
  readonly participleForms: number;
  readonly seeLinks: number;
  /** Entries from `languages/<lang>/grammar.tsv`. */
  readonly grammarEntries: number;
  /** Wiktionary grammar-word `forms` rows those entries replaced. */
  readonly grammarReplaced: number;
  /** Abbreviations also reachable without their period (`bzw` -> `bzw.`). */
  readonly abbreviations: number;
  /** Forms also indexed with an optional letter written plainly (`все` -> `всё`). */
  readonly letterVariants: number;
  /** Spaced abbreviations also indexed without the spaces (`z. B.` -> `z.B.`). */
  readonly unspacedAbbreviations: number;
  readonly redirectForms: number;
  /** Most repeated parent glosses across words, to spot new templates by eye. */
  readonly topParentGlosses: ReadonlyArray<{
    readonly gloss: string;
    readonly words: number;
  }>;
  readonly fileBytes: number;
  readonly seconds: number;
};

/** Running totals for what the stream read and the transform discarded. */
export const makeTally = () => ({
  linesScanned: 0,
  languageLines: 0,
  invalidLines: 0,
  linesWithoutEntry: 0,
  droppedForms: 0,
  skippedSenses: { archaic: 0, historicalStage: 0, noGloss: 0, placeholder: 0 },
  parentGlosses: new Map<string, number>(),
});
export type Tally = ReturnType<typeof makeTally>;

export const topParentGlosses = (tally: Tally, limit = 15) =>
  [...tally.parentGlosses]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([gloss, words]) => ({ gloss, words }));

export const tallyResult = (tally: Tally, result: TransformResult) => {
  if (result.entry === undefined && result.reflexiveEntries === undefined) {
    tally.linesWithoutEntry++;
  }
  tally.skippedSenses.archaic += result.skippedSenses.archaic;
  tally.skippedSenses.historicalStage +=
    result.skippedSenses["historical-stage"];
  tally.skippedSenses.noGloss += result.skippedSenses["no-gloss"];
  tally.skippedSenses.placeholder += result.skippedSenses.placeholder;
  tally.droppedForms += result.droppedForms;
  for (const gloss of result.parentGlosses) {
    tally.parentGlosses.set(gloss, (tally.parentGlosses.get(gloss) ?? 0) + 1);
  }
};
