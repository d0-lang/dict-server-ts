import { lookupKey } from "@dict/core/lookupKey";
import { loadEntries } from "../../common/entries.ts";
import { grammarIds } from "../../common/forms.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import {
  derivedWord,
  INFLECTING,
  morphemeParts,
  type Part,
  splitResult,
  wholeIds,
} from "./parts.ts";
import { endOf, hasPos, startOf } from "./words.ts";

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
  const split = morphemeParts(c, found, new Set(whole));
  if (derived && split.every((part) => part.ids.length === 0)) {
    return PLAIN;
  }
  // A word shown by its parts (`電化|製品`) opens on the clicked one.
  const parts = derived ? clickedFirst(c, split) : split;
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
  // A head with no entries of its own (`飲ま` of `飲ませて`, `電流` of
  // `過電流`, whose entries are the word's) holds the word's: the client
  // opens on the part of the first entry in one, and can't pick a part
  // without entries.
  const head = parts.find((part) => part.main === true);
  if (head !== undefined && head.ids.length === 0 && whole.length > 0) {
    const moved = parts.map((part) =>
      part === head ? { ...part, ids: whole } : part,
    );
    return splitResult(c.db, [], moved, match);
  }
  return splitResult(c.db, wholeEntries, parts, match);
};

/**
 * `parts` with the one that holds most of the clicked piece as `main`
 * (`製品` in `電化|製品`, `企業` for `中小企業`), unless it is one prefix
 * or suffix (`お` of `お|星|さま`, `たち` of `選手|たち`): the stem carries
 * the meaning then.
 */
const clickedFirst = (
  c: Click,
  parts: ReadonlyArray<Part>,
): ReadonlyArray<Part> => {
  const spans: Array<{ readonly from: number; readonly to: number }> = [];
  let at = startOf(c.found);
  for (const part of parts) {
    spans.push({ from: at, to: at + part.text.length });
    at += part.text.length;
  }
  const overlap = (k: number) =>
    Math.min(spans[k]!.to, c.piece.end) -
    Math.max(spans[k]!.from, c.piece.start);
  let clicked = -1;
  parts.forEach((_, k) => {
    if (overlap(k) > 0 && (clicked < 0 || overlap(k) > overlap(clicked))) {
      clicked = k;
    }
  });
  if (clicked < 0) return parts;
  // One morpheme that is a prefix or suffix; `製|品`, two of them, is a word.
  const inside = c.found.filter(
    (m) => m.start >= spans[clicked]!.from && m.end <= spans[clicked]!.to,
  );
  const affix =
    inside.length === 1 &&
    hasPos(inside[0]!.pos, [...c.settings.prefixes, ...c.settings.suffixes]);
  if (affix) return parts;
  return parts.map(({ main: _, ...part }, k) =>
    k === clicked ? { ...part, main: true } : part,
  );
};
