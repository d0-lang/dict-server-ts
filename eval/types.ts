export type Entry = {
  readonly lemma: string;
  readonly pos: string;
  readonly senses: ReadonlyArray<string>;
};

/** A word in its sentence, with what the API returned for it. No entries means a miss. */
export type Item = {
  readonly word: string;
  readonly sentence: string;
  /** e.g. `news-article/0001.md` */
  readonly text: string;
  readonly entries: ReadonlyArray<Entry>;
  /** Occurrences of the word in the corpus, per saved item of that word. */
  readonly weight: number;
};

export type Rating = "clear" | "buried" | "misleading" | "no_help";

export type Cause =
  | "none"
  | "order"
  | "noise"
  | "missing_sense"
  | "missing_word"
  | "fixed_phrase"
  | "bad_gloss"
  | "form_gloss"
  | "transcription_error"
  | "name"
  | "foreign_word"
  | "other";

export type Verdict = {
  readonly id: string;
  readonly meaning: string;
  readonly rating: Rating;
  /** The rating before the second look, for anything first rated below clear. */
  readonly first_rating: Rating;
  readonly cause: Cause;
  readonly note: string;
};

export type SampleRecord = Item & {
  readonly id: string;
  readonly batch: string;
};
