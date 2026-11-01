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
    historical: number;
    noGloss: number;
  };
  readonly pronunciations: number;
  readonly droppedForms: number;
  readonly forms: { lemma: number; inflection: number; formOf: number };
  readonly formOfLinks: number;
  readonly formOfUnresolved: number;
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
  skippedSenses: { archaic: 0, historical: 0, noGloss: 0 },
});
export type Tally = ReturnType<typeof makeTally>;

export const tallyResult = (tally: Tally, result: TransformResult) => {
  if (result.entry === undefined) tally.linesWithoutEntry++;
  tally.skippedSenses.archaic += result.skippedSenses.archaic;
  tally.skippedSenses.historical += result.skippedSenses.historical;
  tally.skippedSenses.noGloss += result.skippedSenses["no-gloss"];
  tally.droppedForms += result.droppedForms;
};
