import type { Database, Statement } from "bun:sqlite";
import type { Degree } from "../../transform/rules.ts";
import type { DerivedSense } from "../../transform/transform.ts";
import type { WriterCounts } from "../writer.ts";

/** How many steps to follow from a word to the word that has an entry or meaning. */
export const MAX_CHAIN_STEPS = 3;

/**
 * What the passes `finish` runs share with the writer: the open file, its
 * prepared statements, the counts, and what `writeEntry` collected for after
 * the last batch.
 */
/** A soft redirect: `form` (a lookup key) spells the words `targets`. */
export type Redirect = {
  readonly form: string;
  readonly targets: ReadonlyArray<string>;
};

export type WriterContext = {
  readonly sqlite: Database;
  readonly redirects: ReadonlyArray<Redirect>;
  readonly counts: WriterCounts;
  readonly insertSense: Statement;
  readonly insertForm: Statement;
  /** Add Wiktionary pages to those an entry credits (`entries.pages`), after its own. */
  readonly addPages: (id: number, pages: Iterable<string>) => void;
  readonly optionalLetters: ReadonlyArray<readonly [string, string]>;
  /** Whether `key` is the lemma of an entry. */
  readonly hasEntry: (key: string) => boolean;
  readonly verbalNouns: ReadonlyArray<{ form: string; entryId: number }>;
  /** Declined participles, indexed only where no other entry has the form. */
  readonly participleForms: ReadonlyArray<{ form: string; entryId: number }>;
  /** A participle's own adjective or noun doesn't block its declined forms (`participleDeclension.sharedWithParticiple`). */
  readonly participlesSharedWithOwn: boolean;
  /** entry id -> gloss -> its derived sense */
  readonly derivedByEntry: ReadonlyMap<
    number,
    ReadonlyMap<string, DerivedSense>
  >;
  /** entry id -> forms its table tags comparative or superlative -> the degree, if only one */
  readonly degreeFormsByEntry: ReadonlyMap<
    number,
    ReadonlyMap<string, Degree | undefined>
  >;
};
