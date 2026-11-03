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
 * Split a normalized word into known parts, longest head first: the head is
 * a word as it stands (it carries the inflection), each modifier a word once
 * its linking element is removed. Undefined when there is no such split.
 */
export const splitCompound = (
  key: string,
  isPart: (form: string) => boolean,
  linkers: ReadonlyArray<string>,
  maxParts = MAX_PARTS,
): ReadonlyArray<string> | undefined => {
  if (maxParts < 2) return undefined;
  const chars = [...key];
  for (let cut = MIN_PART; cut <= chars.length - MIN_PART; cut++) {
    const head = chars.slice(cut).join("");
    if (!isPart(head)) continue;
    const left = chars.slice(0, cut).join("");
    for (const linker of linkers) {
      if (!left.endsWith(linker)) continue;
      const stem = left.slice(0, left.length - linker.length);
      if ([...stem].length < MIN_PART) continue;
      if (isPart(stem)) return [stem, head];
      const inner = splitCompound(stem, isPart, linkers, maxParts - 1);
      if (inner !== undefined) return [...inner, head];
    }
  }
  return undefined;
};
