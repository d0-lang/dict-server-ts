import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupKey } from "@dict/core/lookupKey";
import type { Morpheme } from "../../common/analyzer.ts";
import { formRows } from "../../common/forms.ts";
import { hasPos, type Settings } from "./words.ts";

/** Shorter pieces of a noun match by chance (`간` "liver" in `간송`). */
const MIN_PIECE = 2;
const NOUNS: ReadonlySet<string> = new Set(["NOUN", "PROPN"]);

/**
 * A `compoundPos` morpheme the dictionary doesn't have, cut into the nouns
 * it has, longest first, as morphemes of its part of speech: the analyzer
 * reads a compound it doesn't know as one noun (`간송미술관`, with
 * `미술관` "art museum"; `단중모리`, with `모리`). Pieces between them are
 * morphemes of their own, of two letters or more, and the last piece is a
 * noun it has. Others stay as they are.
 */
export const withKnownPieces = (
  db: DictionaryDb,
  settings: Settings,
  morphemes: ReadonlyArray<Morpheme>,
): ReadonlyArray<Morpheme> => {
  if (settings.compoundPos.length === 0) return morphemes;
  const rows = (text: string) => formRows(db, lookupKey(text));
  // A noun's own headword, not a form of another word (`베리` of `별`).
  const known = (text: string) =>
    rows(text).some(
      (row) => NOUNS.has(row.pos) && lookupKey(row.lemma) === lookupKey(text),
    );
  return morphemes.flatMap((m) => {
    const chars = [...m.surface];
    if (
      chars.length <= MIN_PIECE ||
      chars.length !== m.end - m.start ||
      !hasPos(m.pos, settings.compoundPos) ||
      rows(m.surface).length > 0
    ) {
      return [m];
    }
    // The cut covering the most letters with known nouns, then the one with
    // fewest pieces.
    const best: Array<{ covered: number; pieces: number; cut: number[] }> = [
      { covered: 0, pieces: 0, cut: [] },
    ];
    for (let end = 1; end <= chars.length; end++) {
      let pick = {
        covered: best[end - 1]!.covered,
        pieces: best[end - 1]!.pieces + 1,
        cut: [...best[end - 1]!.cut, end],
      };
      for (let start = 0; start <= end - MIN_PIECE; start++) {
        if (!known(chars.slice(start, end).join(""))) continue;
        const before = best[start]!;
        const covered = before.covered + end - start;
        if (
          covered > pick.covered ||
          (covered === pick.covered && before.pieces + 1 < pick.pieces)
        ) {
          pick = {
            covered,
            pieces: before.pieces + 1,
            cut: [...before.cut, end],
          };
        }
      }
      best.push(pick);
    }
    const { covered, cut } = best[chars.length]!;
    if (covered === 0) return [m];
    // Unknown letters next to each other are one piece.
    const knownPiece = (start: number, end: number) =>
      end - start >= MIN_PIECE && known(chars.slice(start, end).join(""));
    const ends = cut.filter(
      (end, k) =>
        end === chars.length ||
        knownPiece(cut[k - 1] ?? 0, end) ||
        knownPiece(end, cut[k + 1]!),
    );
    // A compound ends in its head, a noun the dictionary has; what comes
    // before it may be a name (`간송`), not a letter left over: `김|연수`
    // is a person's name, `사이|클` a loanword.
    const starts = [0, ...ends.slice(0, -1)];
    if (
      !knownPiece(starts.at(-1)!, chars.length) ||
      ends.some((end, k) => end - starts[k]! < MIN_PIECE)
    ) {
      return [m];
    }
    return ends.map((end, k): Morpheme => {
      const surface = chars.slice(ends[k - 1] ?? 0, end).join("");
      return {
        surface,
        start: m.start + (ends[k - 1] ?? 0),
        end: m.start + end,
        pos: m.pos,
        bases: [surface],
        spellings: [surface],
      };
    });
  });
};
