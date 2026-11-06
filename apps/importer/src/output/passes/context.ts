import type { Database, Statement } from "bun:sqlite";
import type { DerivedSense } from "../../transform/transform.ts";
import type { WriterCounts } from "../writer.ts";

/** How many steps to follow from a word to the word that has an entry or meaning. */
export const MAX_CHAIN_STEPS = 3;

/**
 * What the passes `finish` runs share with the writer: the open file, its
 * prepared statements, the counts, and what `writeEntry` collected for after
 * the last batch.
 */
export type WriterContext = {
  readonly sqlite: Database;
  readonly counts: WriterCounts;
  readonly insertSense: Statement;
  readonly insertForm: Statement;
  readonly optionalLetters: ReadonlyArray<readonly [string, string]>;
  /** Whether `key` is the lemma of an entry. */
  readonly hasEntry: (key: string) => boolean;
  readonly verbalNouns: ReadonlyArray<{ form: string; entryId: number }>;
  /** entry id -> gloss -> its derived sense */
  readonly derivedByEntry: ReadonlyMap<
    number,
    ReadonlyMap<string, DerivedSense>
  >;
  /** entry id -> forms its table tags comparative or superlative */
  readonly degreeFormsByEntry: ReadonlyMap<number, ReadonlySet<string>>;
};
