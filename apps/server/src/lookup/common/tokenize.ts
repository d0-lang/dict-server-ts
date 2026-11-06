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
  for (const { segment, isWordLike, inner } of segments) {
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
    });
    between = "";
    innerOnly = true;
  }
  return tokens;
};

/** Context words equal to `word`; a word the client sent with spaces is not looked for. */
export const positionsOf = (
  tokens: ReadonlyArray<Token>,
  word: string,
  locale: string,
): ReadonlyArray<number> => {
  const own = tokenize(word, locale);
  if (own.length !== 1) return [];
  return tokens.flatMap((token, i) => (token.key === own[0]!.key ? [i] : []));
};

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
