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
  readonly forms: { lemma: number; inflection: number; formOf: number };
  readonly formOfLinks: number;
  readonly formOfUnresolved: number;
  readonly historicalEntries: number;
  readonly derivedCopied: number;
  readonly derivedBare: number;
  readonly seeLinks: number;
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
  if (result.entry === undefined) tally.linesWithoutEntry++;
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
