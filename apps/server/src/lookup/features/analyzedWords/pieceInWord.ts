import { loadEntries } from "../../common/entries.ts";
import type { Answer, Click } from "./click.ts";
import { wholeIds } from "./parts.ts";
import { dictionaryWords, endOf, startOf } from "./words.ts";

/**
 * In the dictionary's own words (`dictionaryWords`), a clicked piece inside a
 * longer word that is a word itself: its own entries first, then the word
 * around it, underlined. The fewest words are not always the reader's
 * (`都会` "metropolis" in `他都会来` "he will come too", which the browser
 * cuts `都|会`), and on the corpus the piece where the dictionary has it,
 * else the word around it, agreed best with the reference words (84.1%,
 * against 80.7% for the fewest words alone).
 */
export const pieceInWord = (c: Click): Answer => {
  if (!dictionaryWords(c.settings) || c.wider) return undefined;
  const { piece, found } = c;
  if (piece.start === startOf(found) && piece.end === endOf(found)) {
    return undefined;
  }
  const own = [...new Set(c.rows(c.word).map((row) => row.id))];
  if (own.length === 0) return undefined;
  const whole = wholeIds(c, found, c.text).filter((id) => !own.includes(id));
  const match = c.matchOf(startOf(found), endOf(found));
  return {
    entries: [
      ...loadEntries(c.db, own),
      ...loadEntries(c.db, whole).map((entry) => ({ ...entry, ...match })),
    ],
  };
};
