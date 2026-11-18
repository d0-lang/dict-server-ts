import { lookupKey } from "@dict/core/lookupKey";
import { loadEntries } from "../../common/entries.ts";
import { grammarIds } from "../../common/forms.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import {
  derivedWord,
  INFLECTING,
  morphemeParts,
  splitResult,
  wholeIds,
} from "./parts.ts";
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
  // A word the grammar file lists as a whole (`します`, "polite する"): its
  // line first, then the word's entries, as one piece.
  const spelled = found.length > 1 ? grammarIds(c.db, lookupKey(c.text)) : [];
  if (spelled.length > 0) {
    return {
      entries: [
        ...loadEntries(c.db, spelled),
        ...loadEntries(
          c.db,
          whole.filter((id) => !spelled.includes(id)),
        ),
      ].map((entry) => ({ ...entry, ...match })),
    };
  }
  if (found.length === 1) {
    return derived
      ? PLAIN
      : { entries: wholeEntries.map((entry) => ({ ...entry, ...match })) };
  }
  const parts = morphemeParts(c, found, new Set(whole));
  if (derived && parts.every((part) => part.ids.length === 0)) {
    return PLAIN;
  }
  // A form ending closes the head (`並んで`): the word's entries are that
  // part's, with the form's label (`並ぶ` [て form]), not the whole word's.
  const formed = parts.find((part) => part.main === true && part.form);
  if (formed !== undefined && whole.length > 0) {
    const moved = parts.map((part) =>
      part === formed
        ? {
            ...part,
            ids: [...whole, ...part.ids],
            form: {
              ...part.form!,
              ids: [
                ...whole.filter((id) => INFLECTING.has(c.infoOf(id).pos)),
                ...part.form!.ids,
              ],
            },
          }
        : part,
    );
    return splitResult(c.db, [], moved, match);
  }
  return splitResult(c.db, wholeEntries, parts, match);
};
