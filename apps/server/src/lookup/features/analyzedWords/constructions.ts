import { lookupKey } from "@dict/core/lookupKey";
import type { Morpheme } from "../../common/analyzer.ts";
import { loadEntries } from "../../common/entries.ts";
import { grammarIds } from "../../common/forms.ts";
import type { Answer, Click } from "./click.ts";
import { wholeIds } from "./parts.ts";
import { endOf, hasPos, startOf } from "./words.ts";

/** Most morphemes the part after the slot may take (`に|なっ|た`). */
const MAX_AFTER = 3;

/**
 * A construction with a word in it (`context.analyzer.constructions`): `お`
 * + one morpheme of the slot's parts of speech + what follows
 * (`お|待ち|し|ます`, `ご|案内|し|ます`, `お|書き|に|なっ|た`), run over the
 * clicked word and the words next to it. It shows the construction's line
 * first, underlining the run, then the clicked word's own entries.
 */
export const constructionLookup = (c: Click): Answer => {
  const { words, index, settings } = c;
  if (settings.constructions.length === 0) return undefined;
  // The clicked word, the one before and two after (`お書き|に|なった`).
  const span = words.slice(Math.max(0, index - 1), index + 3);
  const morphemes = span.flat();
  for (const construction of settings.constructions) {
    const after = new Set(construction.after.map(lookupKey));
    for (let i = 0; i + 2 < morphemes.length; i++) {
      const [first, slot] = [morphemes[i]!, morphemes[i + 1]!];
      if (
        !construction.before.includes(first.surface) ||
        !hasPos(slot.pos, construction.slot) ||
        slot.start !== first.end
      ) {
        continue;
      }
      const verbEnd = afterEnd(morphemes.slice(i + 2), slot.end, after);
      if (verbEnd === undefined) continue;
      // The run ends where the verb's word ends, with its endings (`します`).
      const end = endOf(
        span.find((w) => startOf(w) < verbEnd && endOf(w) >= verbEnd)!,
      );
      // The run holds the clicked piece.
      if (first.start > c.piece.start || end < c.piece.end) continue;
      const line = grammarIds(c.db, lookupKey(construction.line));
      if (line.length === 0) continue;
      const own = wholeIds(c, c.found, c.text).filter(
        (id) => !line.includes(id),
      );
      return {
        entries: [
          ...loadEntries(c.db, line).map((entry) => ({
            ...entry,
            ...c.matchOf(first.start, end),
          })),
          ...loadEntries(c.db, own).map((entry) => ({
            ...entry,
            ...c.matchOf(startOf(c.found), endOf(c.found)),
          })),
        ],
      };
    }
  }
  return undefined;
};

/**
 * Where the part after the slot ends, when the morphemes from the slot's end
 * spell one of `after`, the last written or in its base form (`し` as
 * `する`, `に|なっ` as `になる`); undefined when they don't.
 */
const afterEnd = (
  rest: ReadonlyArray<Morpheme>,
  from: number,
  after: ReadonlySet<string>,
): number | undefined => {
  let written = "";
  let found: number | undefined;
  let at = from;
  for (const m of rest.slice(0, MAX_AFTER)) {
    if (m.start !== at) break;
    const spellings = [m.surface, ...m.bases].map((last) =>
      lookupKey(written + last),
    );
    if (spellings.some((form) => after.has(form))) found = m.end;
    written += m.surface;
    at = m.end;
  }
  return found;
};
