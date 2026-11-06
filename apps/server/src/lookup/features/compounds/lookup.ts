import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { caseClass, cleanWord, lookupKey } from "@dict/core/lookupKey";
import { CaseClass } from "@dict/core/schema";
import {
  findEntriesByForm,
  type LookupEntry,
  type LookupResult,
  type Segment,
} from "../../common/entries.ts";
import type { CompoundPiece, CompoundRules } from "./split.ts";
import { stemCompound } from "./stems.ts";
import { wordCompound } from "./words.ts";

/**
 * `pieces` of `lookupKey(word)` as slices of `word` itself, which segments
 * must spell exactly. Undefined when normalizing changed the length of the
 * word (surrounding spaces, decomposed accents), so slices can't be mapped.
 */
export const surfaceSlices = (
  word: string,
  pieces: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined => {
  const original = [...word];
  const key = [...lookupKey(word)];
  if (
    original.length !== key.length ||
    original.some((char, i) => char.toLowerCase() !== key[i])
  ) {
    return undefined;
  }
  let at = 0;
  return pieces.map((piece) => {
    const length = [...piece].length;
    const slice = original.slice(at, at + length).join("");
    at += length;
    return slice;
  });
};

/**
 * `findEntriesByForm`, and for a word with no entry in a compounding language,
 * the content-word entries of its parts in reading order: `Gemüsefonds` gives
 * `Gemüse` then `Fond`, with a segment per part (and per linking element).
 * The parts take the word's capitalisation, so a noun compound ranks the noun
 * readings of its parts first.
 */
export const findEntriesWithCompounds = (
  db: DictionaryDb,
  word: string,
  rules: CompoundRules | undefined,
): LookupResult => {
  const direct = findEntriesByForm(db, word);
  if (direct.length > 0 || rules === undefined) return { entries: direct };
  // Tables don't list a name's genitive (`Dortmunds`), which would split
  // into nonsense (`Dort` + `Mund`).
  const capital = caseClass(cleanWord(word)) !== CaseClass.Lower;
  const key = lookupKey(word);
  if (capital && key.endsWith("s") && [...key].length > 3) {
    const names = findEntriesByForm(db, cleanWord(word).slice(0, -1), {
      abbreviations: false,
    }).filter((entry) => entry.pos === "PROPN");
    if (names.length > 0) return { entries: names };
  }
  return compoundEntries(db, word, rules);
};

/**
 * The parts of `word` as a compound, with their entries and segments, whether
 * or not the word has an entry of its own. Empty when it doesn't split.
 * `findEntriesWithCompounds` uses it for words without an entry; the segments
 * benchmark calls it directly.
 */
export const compoundEntries = (
  db: DictionaryDb,
  word: string,
  rules: CompoundRules,
): LookupResult => {
  const split =
    rules.stemEndings === undefined
      ? wordCompound(db, word, rules.linkers)
      : stemCompound(db, word, rules);
  return split === undefined
    ? { entries: [] }
    : compoundResult(word, split.pieces, split.perPart);
};

/** The entries of a split word in reading order, with its segments. */
const compoundResult = (
  word: string,
  pieces: ReadonlyArray<CompoundPiece>,
  perPart: ReadonlyArray<ReadonlyArray<LookupEntry>>,
): LookupResult => {
  const result = perPart.flat();
  const slices = surfaceSlices(
    word,
    pieces.map((piece) => piece.text),
  );
  if (slices === undefined) return { entries: result };
  // A part repeated in the word (`Kindeskind`) gets its own copies, since an
  // entry belongs to at most one segment.
  let next = 0;
  let part = 0;
  const segments = pieces.map((piece, i): Segment => {
    if (!piece.part) return { text: slices[i]! };
    const count = perPart[part++]!.length;
    const indexes = Array.from({ length: count }, (_, k) => next + k);
    next += count;
    return count > 0
      ? { text: slices[i]!, entries: indexes }
      : { text: slices[i]! };
  });
  return { entries: result, segments };
};
