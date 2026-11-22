import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import type { LookupResult } from "../../common/entries.ts";
import { acrossWords, knownPiece } from "./acrossWords.ts";
import { aroundWord } from "./aroundWord.ts";
import { type Answer, type Click, clickOf, PLAIN } from "./click.ts";
import { constructionLookup } from "./constructions.ts";
import { numberLookup } from "./numbers.ts";
import { phraseLookup } from "./phrases.ts";
import { pieceInWord } from "./pieceInWord.ts";
import { singleWord } from "./singleWord.ts";

/**
 * Words found by a morphological analyzer (`context.analyzer`), for a script
 * without spaces. The segmenter, client's and server's alike, cuts inflected
 * words short (`食|べ|ま|した`), so a click on `食` would show "food". With the
 * sentence, the analyzer cuts it into morphemes with their base forms, the
 * language's `join` rules make words of them (`食べ` + `まし` + `た`), and the
 * lookup returns the word around the clicked piece as `match`: its entries
 * first (`食べる`, by the head's base form), then each morpheme as a part
 * (`segments`), an ending by its grammar-file line (`ます`, `た`). A phrase the
 * dictionary lists over several words (`手に入る`, `かもしれない`) comes first.
 *
 * `match` is the protocol's: only on entries the sentence adds, and always a
 * run that holds the clicked piece and more. A piece the analyzer reads as
 * several words (`よ|ね`), or that is cut across them (`たん` of
 * `なかった|ん`), is answered by those words as parts, not by the first of
 * them alone.
 */

/**
 * The steps, in order; the first that answers decides. The order matters:
 * a piece over two words can be spelled like the first of them (`ポロポロ`
 * across `ポロポロ|ポロっ`), and then `singleWord` answers it before
 * `acrossWords`.
 */
const STEPS: ReadonlyArray<(click: Click) => Answer> = [
  // a phrase over several words (`手に入る`)
  phraseLookup,
  // a construction with a word in it (`お|待ち|し|ます`)
  constructionLookup,
  // a piece over several words that the dictionary knows (`そうですね`, `年代`)
  knownPiece,
  // a number and its counter (`10|月`)
  numberLookup,
  // the piece is spelled as the word (`もの`)
  singleWord,
  // a piece over several words (`よ|ね`, `そう|して`)
  acrossWords,
  // a word inside one of the dictionary's own words (`都` of `都会`)
  pieceInWord,
  // the word around the piece (`食べました` for `食`)
  aroundWord,
];

/**
 * The lookup of `word` as part of the word the analyzer finds around it in
 * `context`, or undefined when that word is just `word` (or the click can't be
 * placed): then the plain lookup answers.
 */
export const analyzedLookup = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): LookupResult | undefined => {
  const click = clickOf(db, word, context, language, at);
  if (click === undefined) return undefined;
  for (const step of STEPS) {
    const answer = step(click);
    if (answer !== undefined) return answer === PLAIN ? undefined : answer;
  }
  return undefined;
};
