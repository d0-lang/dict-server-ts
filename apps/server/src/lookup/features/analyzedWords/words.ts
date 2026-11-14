import type { Language } from "@dict/core/language";
import type { Morpheme } from "../../common/analyzer.ts";

/** Morphemes as words: the analyzer's morphemes joined by the language's rules. */

export type Settings = NonNullable<Language["context"]["analyzer"]>;
type Rule = Settings["join"][number];

/** A word: the morphemes the `join` rules make one (`食べ|まし|た`). */
export type Word = ReadonlyArray<Morpheme>;

/** `pos` is one of `tags` or starts with one and a `-`. */
export const hasPos = (pos: string, tags: ReadonlyArray<string>): boolean =>
  tags.some((tag) => pos === tag || pos.startsWith(`${tag}-`));

const joins = (rule: Rule, morpheme: Morpheme, before: Morpheme): boolean =>
  hasPos(morpheme.pos, rule.pos) &&
  (rule.surface === undefined || rule.surface.includes(morpheme.surface)) &&
  (rule.base === undefined ||
    morpheme.bases.some((base) => rule.base!.includes(base))) &&
  (rule.after === undefined
    ? /\p{L}/u.test(before.surface)
    : hasPos(before.pos, rule.after)) &&
  (rule.afterSurface === undefined ||
    rule.afterSurface.includes(before.surface));

/** The morphemes as words: each joined to the word before it when a rule says so. */
export const wordsOf = (
  morphemes: ReadonlyArray<Morpheme>,
  settings: Settings,
): ReadonlyArray<Word> => {
  const words: Array<Array<Morpheme>> = [];
  let prefixes: Array<Morpheme> = [];
  for (const morpheme of morphemes) {
    const word = words.at(-1);
    const before = word?.at(-1);
    if (
      prefixes.length === 0 &&
      before !== undefined &&
      before.end === morpheme.start &&
      settings.join.some((rule) => joins(rule, morpheme, before))
    ) {
      word!.push(morpheme);
    } else if (hasPos(morpheme.pos, settings.prefixes)) {
      prefixes.push(morpheme);
    } else if (!/\p{L}/u.test(morpheme.surface)) {
      // A prefix joins a word, not a number (`約` + `30`) or a sign.
      for (const prefix of prefixes) words.push([prefix]);
      prefixes = [];
      words.push([morpheme]);
    } else {
      words.push([...prefixes, morpheme]);
      prefixes = [];
    }
  }
  for (const prefix of prefixes) words.push([prefix]);
  return words;
};

export const startOf = (w: Word): number => w[0]!.start;
export const endOf = (w: Word): number => w.at(-1)!.end;

/** A word's head: its first morpheme that is no prefix and has letters (`日` in `2|7|日`, `勉強` in `お|勉強`). */
export const headOf = (w: Word, settings: Settings): Morpheme =>
  w.find(
    (m) => !hasPos(m.pos, settings.prefixes) && /\p{L}/u.test(m.surface),
  ) ??
  w.find((m) => !hasPos(m.pos, settings.prefixes)) ??
  w[0]!;
