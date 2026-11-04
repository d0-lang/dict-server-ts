export type Entry = {
  readonly lemma: string;
  readonly pos: string;
  readonly senses: ReadonlyArray<string>;
};

/** A piece of the word as sent; `entries` index the item's `entries`. */
export type Segment = {
  readonly text: string;
  readonly entries?: ReadonlyArray<number>;
};

/** A word in its sentence, with what the API returned for it. No entries means a miss. */
export type Item = {
  readonly word: string;
  readonly sentence: string;
  /** e.g. `news-article/0001.md` */
  readonly text: string;
  readonly entries: ReadonlyArray<Entry>;
  /** How the server split the word, if it did. */
  readonly segments?: ReadonlyArray<Segment>;
  /** Occurrences of the word in the corpus, per saved item of that word. */
  readonly weight: number;
};

export type Understood = "yes" | "partly" | "wrong" | "no";
export type Flag = "marginal" | "junk";

export type Verdict = {
  readonly id: string;
  readonly understood: Understood;
  /** `group.sense`, both from 1, or null when no sense gives the meaning. */
  readonly fits: string | null;
  /** Keyed by `group` or `group.sense`. Anything absent is valid. */
  readonly flags: Readonly<Record<string, Flag>>;
  readonly cause: string;
  readonly note: string;
};

export type SampleRecord = Item & {
  /** Where it was picked from: the frequent words or the random rest. */
  readonly stratum: "frequent" | "random";
};
