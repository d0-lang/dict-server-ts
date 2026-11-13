/**
 * Whether a sense is about a number, by the words of the language the senses
 * are written in (`target`; English, for the English Wiktionary dump). It
 * tells an entry that is a number and its counter (`十分` "ten minutes",
 * `四月` "April") from another word spelled alike (`十分` "enough", `七節`
 * "a stick insect").
 */

const ENGLISH_NUMBER = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|(?:four|fif|six|seven|eigh|nin|ten|eleven|twelf|\w+teen|\w+tie|hundred|thousand|million)th|once|twice)`;
/** A month is a number too: `4月` is "April". Capitalised only (`may`, `march`). */
const ENGLISH_MONTH = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December)`;

type Patterns = {
  /** The sense has a number in it. */
  readonly inside: ReadonlyArray<RegExp>;
  /** The sense begins with one, after an article. */
  readonly first: ReadonlyArray<RegExp>;
};

const PATTERNS: Readonly<Record<string, Patterns>> = {
  en: {
    inside: [
      new RegExp(String.raw`\b${ENGLISH_NUMBER}\b`, "iu"),
      new RegExp(String.raw`\b${ENGLISH_MONTH}\b`, "u"),
    ],
    first: [
      new RegExp(String.raw`^(?:(?:the|a|an)\s+)?${ENGLISH_NUMBER}\b`, "iu"),
      new RegExp(String.raw`^${ENGLISH_MONTH}\b`, "u"),
    ],
  },
};

/**
 * How much the senses, written in `target`, are about a number: 2 when one
 * begins with a number ("ten minutes", "the first day of the month",
 * "April"), 1 when one has a number in it ("a millennium; a thousand years"),
 * 0 when none has. Undefined when the code knows no number words of `target`.
 */
export const numberSense = (
  target: string,
  senses: ReadonlyArray<string>,
): 0 | 1 | 2 | undefined => {
  const patterns = PATTERNS[target];
  if (patterns === undefined) return undefined;
  const some = (tests: ReadonlyArray<RegExp>) =>
    senses.some((sense) => tests.some((test) => test.test(sense.trim())));
  return some(patterns.first) ? 2 : some(patterns.inside) ? 1 : 0;
};
