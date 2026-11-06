import type { UdPos } from "../core/schema.ts";

/**
 * Compound splitting for languages that write compounds as one word, used only
 * when a word has no entry of its own. Wiktionary can't list every German
 * compound (`Gemüsefonds`, `Vorgängerregierung`), but it has their parts, and
 * the parts in reading order usually explain the word.
 */

/** How a language joins words into compounds. */
export type CompoundRules = {
  /**
   * Linking elements that may join a modifier to the next part, tried in
   * order. `""` is a plain join (`Gemüse|fond`).
   */
  readonly linkers: ReadonlyArray<string>;
  /**
   * Endings a modifier drops before its linker, for languages whose
   * modifiers are stems rather than words: Russian `нефть` → `нефт|е|газовый`,
   * `новый` → `нов|о|греческий`. Without them, a modifier is a word form, as
   * in German.
   */
  readonly stemEndings?: ReadonlyArray<string>;
  /** Letters a stem may be written without (`ё` as `е`), as `[letter, plain]`. */
  readonly optionalLetters?: ReadonlyArray<readonly [string, string]>;
  /**
   * With `stemEndings`: endings of adjective forms (a reflexive `ся` after
   * them is added in code). A verb form is a head only with one of them, as
   * a participle (`лес|о|обрабатывающий`), since a
   * finite verb that doesn't split into known words is mostly a prefixed or
   * slang verb (`шпиговали` isn't `шпиг` + `валить`).
   */
  readonly adjectiveEndings?: ReadonlyArray<string>;
};

/** Compound rules by source language; a language without them doesn't split. */
const COMPOUNDS: Readonly<Record<string, CompoundRules>> = {
  de: { linkers: ["", "s", "es", "n", "en", "er", "e", "ens"] },
  ru: {
    // Not `и`: it joins only numbers (`пяти|этажный`, a plain join of the
    // genitive), and as a linker it misreads `дож|и|мать`.
    linkers: ["", "о", "е"],
    stemEndings: ["ый", "ий", "ой", "а", "я", "о", "е", "ы", "и", "ь", "й"],
    optionalLetters: [["ё", "е"]],
    adjectiveEndings: [
      ...["ый", "ий", "ой", "ая", "яя", "ое", "ее", "ые", "ие"],
      ...["ого", "его", "ому", "ему", "ым", "им", "ых", "их", "ую", "юю", "ей"],
      ...["ыми", "ими"],
    ],
  },
};

export const compoundRules = (pair: string): CompoundRules | undefined =>
  COMPOUNDS[pair.split("_")[0]!];

export const compoundLinkers = (
  pair: string,
): ReadonlyArray<string> | undefined => compoundRules(pair)?.linkers;

/** Shorter parts match too much by chance (`ei`, `en`). */
export const MIN_PART = 3;
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
 * a word as it stands (it carries the inflection, scored by `headScore`),
 * each modifier a word or stem once its linking element is removed. Of the linkers that leave a known modifier,
 * the first whose modifier scores best wins. The pieces joined give `key`
 * back. Undefined when there is no such split.
 */
export const splitCompound = (
  key: string,
  partScore: PartScore,
  linkers: ReadonlyArray<string>,
  maxParts = MAX_PARTS,
  headScore: PartScore = partScore,
): ReadonlyArray<CompoundPiece> | undefined => {
  if (maxParts < 2) return undefined;
  const chars = [...key];
  for (let cut = MIN_PART; cut <= chars.length - MIN_PART; cut++) {
    const head = chars.slice(cut).join("");
    if (headScore(head, "") === 0) continue;
    const left = chars.slice(0, cut).join("");
    let best:
      { pieces: ReadonlyArray<CompoundPiece>; score: number } | undefined;
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
