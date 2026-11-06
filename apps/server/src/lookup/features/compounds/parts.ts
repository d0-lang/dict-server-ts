import type { LookupEntry } from "../../common/entries.ts";
import type { CompoundPiece } from "./split.ts";

export type CompoundSplit = {
  readonly pieces: ReadonlyArray<CompoundPiece>;
  /** The entries of each part, in order. */
  readonly perPart: ReadonlyArray<ReadonlyArray<LookupEntry>>;
};

export const distinctEntries = (
  entries: ReadonlyArray<LookupEntry>,
): ReadonlyArray<LookupEntry> => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const id = JSON.stringify([entry.lemma, entry.pos, entry.senses]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
