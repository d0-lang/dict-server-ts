import { lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import type { Morpheme } from "../../common/analyzer.ts";
import { loadEntries } from "../../common/entries.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import {
  derivedWord,
  INFLECTING,
  morphemeParts,
  type Part,
  splitResult,
  wholeIds,
} from "./parts.ts";
import { endOf, startOf } from "./words.ts";

/**
 * A piece that is several words (`よ|ね`, `年|前`, `明治|天皇`), or is cut
 * across them (`たん` of `なかった|ん`, `すか` of `あります|か`).
 */

/**
 * UD's open classes: content words. A morpheme the language maps to none of
 * them (a particle, an auxiliary, a conjunction) is a function word.
 */
const CONTENT = new Set(["NOUN", "PROPN", "VERB", "ADJ", "ADV", "INTJ"]);

/** Content words that name or describe, unlike adverbs and interjections: never a clause's edge alone. */
const NAMING = new Set(["NOUN", "PROPN", "VERB", "ADJ"]);

/**
 * Each word the piece touches is a part with its own entries, the one that
 * holds most of the piece first. The parts spell the run of those words,
 * which is the `match` when it is more than the piece. What the dictionary
 * has for the piece itself is left out (`委員` for `いいん`), unless it has
 * nothing for the word that holds most of the piece: then the analyzer's cut
 * is no better, and the plain lookup answers (`でも` in `横ばえで|も`,
 * `ちゃんと` in `スマホちゃん|と`). A piece at a clause's edge puts its own
 * entries first (`clauseEdgeIds`).
 */
export const acrossWords = (c: Click): Answer => {
  if (!c.wider) return undefined;
  const { word, piece, found, touched } = c;
  const known = !derivedWord(c, found) && wholeIds(c, found, c.text).length > 0;
  if (!known && c.rows(word).length > 0) return PLAIN;
  const own = clauseEdgeIds(c);
  const shown = new Set(own);
  const parts = touched.flatMap((w): ReadonlyArray<Part> => {
    if (!derivedWord(c, w)) {
      return [
        {
          text: c.textOf(w),
          ids: wholeIds(c, w, c.textOf(w)).filter((id) => !shown.has(id)),
          main: w === found,
        },
      ];
    }
    // Of a word shown by its parts, the ones inside the piece come first
    // (`上` of `保全|上` for `上の`).
    return morphemeParts(c, w, shown).map((part, i) => ({
      ...part,
      main: w === found && w[i]!.start < piece.end && w[i]!.end > piece.start,
    }));
  });
  if (own.length === 0 && parts.every((part) => part.ids.length === 0)) {
    return PLAIN;
  }
  return splitResult(
    c.db,
    loadEntries(c.db, own),
    parts,
    c.matchOf(startOf(touched[0]!), endOf(touched.at(-1)!)),
  );
};

/**
 * A piece over several words that the dictionary knows as a word, cut by the
 * analyzer only because of what stands around it: the plain lookup answers
 * it.
 *
 * - A piece that starts a word and runs on past it is a phrase the segmenter
 *   knows (`そうですね`), if the dictionary has it as a phrase spelled so. Not
 *   a one-word entry (`いいん`, read as `委員` "committee member", in
 *   `いい|ん|だ`), nor a redirect (`よね` to `米` "rice", for `よ` + `ね`).
 * - A piece of content words alone that the dictionary has as a word: a
 *   compound after a number or a prefix (`年代` in `2000年|代`, `日本語` in
 *   `非日本|語`), a filler cut into syllables (`ま|あ`). No particle or
 *   auxiliary is in it, which stand next to any word (`とも` is `と|も`,
 *   `すると` is `する|と`). It ends where a word ends, so no ending is cut
 *   off (not `外出` in `外|出たい`), and its entry has the part of speech of
 *   its last morpheme, which makes the compound's (not `となり` "neighbour"
 *   for `と|なり`).
 */
export const knownPiece = (c: Click): Answer => {
  const { word, piece, found, touched } = c;
  if (!c.wider) return undefined;
  if (
    piece.start === startOf(found) &&
    c
      .rows(word)
      .some((row) => row.source !== FormSource.Redirect && c.severalWords(row))
  ) {
    return PLAIN;
  }
  const inside = touched
    .flat()
    .filter((m) => m.start < piece.end && m.end > piece.start);
  const functionWord = (m: Morpheme) => {
    const tags = [...c.uposOf(m)];
    return tags.length > 0 && !tags.some((tag) => CONTENT.has(tag));
  };
  return inside[0]!.start === piece.start &&
    endOf(touched.at(-1)!) === piece.end &&
    !inside.some(functionWord) &&
    c
      .rows(word)
      .some(
        (row) =>
          row.source === FormSource.Lemma &&
          lookupKey(row.lemma) === lookupKey(word) &&
          c.uposOf(inside.at(-1)!).has(row.pos),
      )
    ? PLAIN
    : undefined;
};

/**
 * A piece of whole words that starts a clause or ends a sentence (`そう|して`
 * at the start, `、なん|て`, `ありますなる|ほど。`) is a word of its own as
 * often as not: its own entries, which come first as the whole word, with the
 * parts after. Inside a clause such a piece is mostly other words
 * (`博物館と|も`, `問題と|なり`, `わかんないよ|って`, `大きくなればなる|ほど`),
 * and only the parts answer.
 *
 * Its own entries are those of a word that stands at the edge of a clause:
 * an adverb, an interjection or a function word (`なんて`), as its lemma, as
 * a form-of entry (`そうして`, of `そして`), or as a spelling of the lemma
 * (`なるほど`, of `成程`). Not a noun (`すか` "nonsense" in `なんすか?`), an
 * inflected form (`かって` of `買う`) or a redirect (`いるか` to `海豚`
 * "dolphin").
 */
const clauseEdgeIds = (c: Click): ReadonlyArray<number> => {
  const { word, context, piece, touched } = c;
  const whole =
    piece.start === startOf(touched[0]!) &&
    piece.end === endOf(touched.at(-1)!);
  // Nothing before it, or a mark that ends a clause or opens a bracket or quote.
  const before = context.slice(0, piece.start).trimEnd().at(-1);
  const clauseStart =
    before === undefined ||
    /[\p{Terminal_Punctuation}\p{Ps}\p{Pi}]/u.test(before);
  // Nothing after it, or a sentence's last mark.
  const after = context.slice(piece.end).trimStart()[0];
  const sentenceEnd =
    after === undefined || /\p{Sentence_Terminal}/u.test(after);
  if (!whole || !(clauseStart || sentenceEnd)) return [];
  const key = lookupKey(word);
  return [
    ...new Set(
      c
        .rows(word)
        .filter(
          (row) =>
            !NAMING.has(row.pos) &&
            ((row.source === FormSource.Lemma &&
              lookupKey(row.lemma) === key) ||
              row.source === FormSource.FormOf ||
              (row.source === FormSource.Inflection &&
                !INFLECTING.has(row.pos))),
        )
        .map((row) => row.id),
    ),
  ];
};
