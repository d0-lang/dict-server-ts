import { caseClass, lookupKey } from "@dict/core/lookupKey";
import { CaseClass } from "@dict/core/schema";

/** A word of the context, with what separates it from the word before. */
export type Token = {
  readonly key: string;
  /** How the word is capitalised in the context. */
  readonly caseClass: CaseClass;
  /** Clauses are split at punctuation, so a match can't reach across one. */
  readonly clause: number;
  /** The text between this word and the one before ends a clause. */
  readonly breakBefore: boolean;
  /** Only a hyphen stands between this word and the one before (`что-нибудь`). */
  readonly joinedBefore: boolean;
  /** Only a period, and at most one space, stands between this word and the one before (`т.д.`, `z. B.`). */
  readonly dottedBefore: boolean;
  /** Only a comma stands between this word and the one before. */
  readonly commaBefore: boolean;
  /** Where the word starts and ends in the text, as UTF-16 indexes. */
  readonly start: number;
  readonly end: number;
};

/** Punctuation that ends a clause. A period also ends abbreviations, which only costs a missed match. */
const CLAUSE_BREAK = /[.!?;:,()[\]{}"„“”«»‹›–—]/u;

/** A hyphen joining two words with no space, which the segmenter splits apart. */
const JOINING_HYPHEN = /^[-\u2010\u2011]$/u;

/** A period inside an abbreviation (`т.д.`, `z. B.`): with no space, or one. */
const ABBREVIATION_PERIOD = /^\. ?$/u;

/**
 * A period between letters, where browsers' word segmenters split a word and
 * the server's (Bun's) doesn't: Chromium sends `т` for a click on `т.д.`, and
 * `lenta` for `lenta.ru`. Splitting here too keeps the context's words the
 * client's words.
 */
const INNER_PERIOD = /(?<=\p{L})\.(?=\p{L})/u;

const segmenters = new Map<string, Intl.Segmenter>();

const segmenterFor = (locale: string): Intl.Segmenter => {
  let segmenter = segmenters.get(locale);
  if (segmenter === undefined) {
    segmenter = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, segmenter);
  }
  return segmenter;
};

/** The words of `text`, normalized with `lookupKey`. */
export const tokenize = (
  text: string,
  locale: string,
): ReadonlyArray<Token> => {
  const tokens: Array<Token> = [];
  let clause = 0;
  let between = "";
  // A period inside a word (`comp.os.minix`, `т.д`) splits it, but ends no clause:
  // `kündigte es in comp.os.minix an` keeps its particle.
  const segments = [...segmenterFor(locale).segment(text)].flatMap(
    ({ segment, isWordLike }) =>
      isWordLike && INNER_PERIOD.test(segment)
        ? segment
            .split(INNER_PERIOD)
            .flatMap((piece, i) => [
              ...(i > 0
                ? [{ segment: ".", isWordLike: false, inner: true }]
                : []),
              { segment: piece, isWordLike: true, inner: false },
            ])
        : [{ segment, isWordLike: isWordLike === true, inner: false }],
  );
  let innerOnly = true;
  let offset = 0;
  for (const { segment, isWordLike, inner } of segments) {
    const start = offset;
    offset += segment.length;
    if (!isWordLike) {
      between += segment;
      innerOnly &&= inner;
      continue;
    }
    const breakBefore =
      tokens.length > 0 &&
      !(innerOnly && between !== "") &&
      CLAUSE_BREAK.test(between);
    if (breakBefore) clause++;
    tokens.push({
      key: lookupKey(segment),
      caseClass: caseClass(segment),
      clause,
      breakBefore,
      joinedBefore: tokens.length > 0 && JOINING_HYPHEN.test(between),
      dottedBefore: tokens.length > 0 && ABBREVIATION_PERIOD.test(between),
      commaBefore: tokens.length > 0 && between.trim() === ",",
      start,
      end: offset,
    });
    between = "";
    innerOnly = true;
  }
  return tokens;
};

/** Where the client clicked: the context as sent, and `at` from the protocol. */
export type Click = {
  readonly context: string;
  /** Which copy of the word in `context` was clicked, from 1. */
  readonly at?: number;
};

/**
 * Where the `at`-th copy of `word` starts in `context`: copies are counted
 * left to right without overlap, on the string as sent, as the protocol says.
 */
const copyStart = (context: string, word: string, at: number): number => {
  let start = -word.length;
  for (let n = 0; n < at; n++) {
    start = context.indexOf(word, start + word.length);
    if (start < 0) return -1;
  }
  return start;
};

/**
 * Context words equal to `word`; a word the client sent with spaces is not
 * looked for. With `at`, only the clicked one, if `at` points at such a word;
 * an `at` that points elsewhere is ignored.
 */
export const positionsOf = (
  tokens: ReadonlyArray<Token>,
  word: string,
  locale: string,
  click?: Click,
): ReadonlyArray<number> => {
  const own = tokenize(word, locale);
  if (own.length !== 1) return [];
  const all = tokens.flatMap((token, i) =>
    token.key === own[0]!.key ? [i] : [],
  );
  if (click?.at === undefined || word === "") return all;
  const start = copyStart(click.context, word, click.at);
  const clicked = all.find((i) => tokens[i]!.start === start);
  return clicked === undefined ? all : [clicked];
};

/** What can come before a sentence's first word inside the context: its end, or an opening quote. */
const SENTENCE_START = /[.!?:…„“"«»‹›]/u;

/**
 * The clicked word is capitalised, and the context shows it inside a
 * sentence rather than at the start of one (or of a quote), so the capital is
 * the word's own. Every occurrence must be, when the click is ambiguous. A
 * single letter (`Vitamin A`) says nothing.
 */
export const capitalisedInside = (
  context: string,
  tokens: ReadonlyArray<Token>,
  positions: ReadonlyArray<number>,
): boolean =>
  positions.length > 0 &&
  positions.every(
    (i) =>
      i > 0 &&
      tokens[i]!.caseClass === CaseClass.Capitalised &&
      [...tokens[i]!.key].length > 1 &&
      !SENTENCE_START.test(context.slice(tokens[i - 1]!.end, tokens[i]!.start)),
  );

/** Every occurrence follows, in its clause, one of `words` (`zum Binden`). */
export const preceded = (
  tokens: ReadonlyArray<Token>,
  positions: ReadonlyArray<number>,
  words: ReadonlySet<string>,
): boolean =>
  positions.length > 0 &&
  positions.every(
    (i) => i > 0 && !tokens[i]!.breakBefore && words.has(tokens[i - 1]!.key),
  );

/** Every occurrence is followed, in its clause, by a capitalised word (`der Deutschen Bahn`). */
export const capitalisedNext = (
  tokens: ReadonlyArray<Token>,
  positions: ReadonlyArray<number>,
): boolean =>
  positions.length > 0 &&
  positions.every((i) => {
    const next = tokens[i + 1];
    return (
      next !== undefined &&
      !next.breakBefore &&
      next.caseClass === CaseClass.Capitalised
    );
  });

/**
 * The word at `i` ends its clause, where a separated particle stands: a
 * clause break or one of `conjunctions` follows it.
 */
export const endsClause = (
  tokens: ReadonlyArray<Token>,
  i: number,
  conjunctions: ReadonlySet<string>,
): boolean => {
  const next = tokens[i + 1];
  return next === undefined || next.breakBefore || conjunctions.has(next.key);
};

/** An entry the context adds, and the context words (token indexes) it covers. */
export type ContextHit = {
  readonly id: number;
  readonly tokens: ReadonlyArray<number>;
};

/** `hits` with each entry once, at its first hit. */
export const uniqueHits = (
  hits: ReadonlyArray<ContextHit>,
): ReadonlyArray<ContextHit> => {
  const seen = new Set<number>();
  return hits.filter((hit) => !seen.has(hit.id) && seen.add(hit.id));
};

/**
 * The protocol's `match`: the covered words as runs of `context` as sent,
 * a run being words next to each other with what stands between them
 * (`ухо востро`, `кого-нибудь`), in order.
 */
export const matchStrings = (
  context: string,
  tokens: ReadonlyArray<Token>,
  covered: ReadonlyArray<number>,
): ReadonlyArray<string> => {
  const sorted = [...new Set(covered)].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const i of sorted) {
    const last = runs.at(-1);
    if (last !== undefined && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs.map(([from, to]) =>
    context.slice(tokens[from]!.start, tokens[to]!.end),
  );
};
