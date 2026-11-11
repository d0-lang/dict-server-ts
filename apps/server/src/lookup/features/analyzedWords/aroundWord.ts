import { loadEntries } from "../../common/entries.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { derivedWord, morphemeParts, splitResult, wholeIds } from "./parts.ts";
import { endOf, startOf } from "./words.ts";

/**
 * The word around the piece (`食べました` for `食`), or the piece itself read
 * as several morphemes (`新|幹線`): its own entries, underlining it when it
 * is more than the piece, then each morpheme as a part.
 */
export const aroundWord = (c: Click): Answer => {
  const { found } = c;
  const derived = derivedWord(c, found);
  const whole = derived ? [] : wholeIds(c, found, c.text);
  // Without the word's own entries there is nothing to show it by.
  if (whole.length === 0 && !derived) return PLAIN;
  const match = c.matchOf(startOf(found), endOf(found));
  const wholeEntries = loadEntries(c.db, whole);
  if (found.length === 1) {
    return derived
      ? PLAIN
      : { entries: wholeEntries.map((entry) => ({ ...entry, ...match })) };
  }
  const parts = morphemeParts(c, found, new Set(whole));
  if (derived && parts.every((part) => part.ids.length === 0)) {
    return PLAIN;
  }
  return splitResult(c.db, wholeEntries, parts, match);
};
