import type { UdPos } from "./schema.ts";

/**
 * Compound splitting for languages that write compounds as one word, used only
 * when a word has no entry of its own. Wiktionary can't list every German
 * compound (`Gemüsefonds`, `Vorgängerregierung`), but it has their parts, and
 * the parts in reading order usually explain the word.
 */

/**
 * Linking elements that may join a modifier to the next part, by source
 * language. `""` is a plain join (`Gemüse|fond`).
 */
const LINKERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  de: ["", "s", "es", "n", "en", "er", "e", "ens"],
};

export const compoundLinkers = (
  pair: string,
): ReadonlyArray<string> | undefined => LINKERS[pair.split("_")[0]!];

/** Shorter parts match too much by chance (`ei`, `en`). */
const MIN_PART = 3;
/** Parts per word, so a split can't wander into nonsense. */
const MAX_PARTS = 3;

/** Parts of speech a compound part can be; `der` or `ein` inside a word are chance matches. */
export const CONTENT_POS: ReadonlySet<UdPos> = new Set([
  "NOUN",
  "PROPN",
  "ADJ",
  "VERB",
  "ADV",
  "NUM",
]);

/**
 * One piece of a split word: a known `part`, or the linking element before
 * the next part (`s` in `Gemüse|s|fonds`), which has no meaning of its own.
 */
export type CompoundPiece = { readonly text: string; readonly part: boolean };

/**
 * How well `stem` works as a part followed by `linker` ("" for a head or a
 * plain join): 0 not at all, 1 as some content-word form, 2 as the lemma of a
 * content word other than a verb, 3 when `stem + linker` is itself a form of
 * that noun (`spitzen` of `Spitze`, `tages` of `Tag`, `kinder` of `Kind`), 4
 * for a plain join onto a noun, adverb or number lemma (`Mais`, not `Mai` +
 * `s`). So `Spitzen|gastronomie` is `Spitze` + `n`, not the verb `spitzen`,
 * while `Wander|routen` stays the verb stem rather than `Wand` + `er`.
 */
export type PartScore = (stem: string, linker: string) => number;

/** Score of a modifier that is itself split, below any lemma. */
const SPLIT_SCORE = 1;
/** The best a modifier can score; the first linker reaching it wins. */
const BEST_SCORE = 4;

/**
 * Split a normalized word into known parts, longest head first: the head is
 * a word as it stands (it carries the inflection), each modifier a word once
 * its linking element is removed. Of the linkers that leave a known modifier,
 * the first whose modifier scores best wins. The pieces joined give `key`
 * back. Undefined when there is no such split.
 */
export const splitCompound = (
  key: string,
  partScore: PartScore,
  linkers: ReadonlyArray<string>,
  maxParts = MAX_PARTS,
): ReadonlyArray<CompoundPiece> | undefined => {
  if (maxParts < 2) return undefined;
  const chars = [...key];
  for (let cut = MIN_PART; cut <= chars.length - MIN_PART; cut++) {
    const head = chars.slice(cut).join("");
    if (partScore(head, "") === 0) continue;
    const left = chars.slice(0, cut).join("");
    let best: { pieces: ReadonlyArray<CompoundPiece>; score: number } | undefined;
    for (const linker of linkers) {
      if (!left.endsWith(linker)) continue;
      const stem = left.slice(0, left.length - linker.length);
      if ([...stem].length < MIN_PART) continue;
      const tail: ReadonlyArray<CompoundPiece> = [
        ...(linker === "" ? [] : [{ text: linker, part: false }]),
        { text: head, part: true },
      ];
      const score = partScore(stem, linker);
      if (score > 0) {
        if (best === undefined || score > best.score) {
          best = { pieces: [{ text: stem, part: true }, ...tail], score };
        }
      } else if (best === undefined) {
        const inner = splitCompound(stem, partScore, linkers, maxParts - 1);
        if (inner !== undefined) {
          best = { pieces: [...inner, ...tail], score: SPLIT_SCORE };
        }
      }
      if (best !== undefined && best.score >= BEST_SCORE) break;
    }
    if (best !== undefined) return best.pieces;
  }
  return undefined;
};
