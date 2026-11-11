import { lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import { loadEntries } from "../../common/entries.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { wholeIds } from "./parts.ts";

/**
 * The clicked piece is the word: the plain lookup answers, unless its top
 * entry is only redirected there, as an obscure word written alike (`みる`
 * to `海松` "seaweed"). Then the analyzer's lemma comes first (`見る`), with
 * nothing underlined.
 */
export const singleWord = (c: Click): Answer => {
  const { word, found, text } = c;
  if (found.length !== 1 || text !== word) return undefined;
  // A word written in kana whose lemma the analyzer writes in kanji, as a
  // part of speech none of its own entries has (`もの` the noun is `物`,
  // and `もの` has only particle entries): that lemma's entries of that
  // part of speech first. Not `ちょっと`, an adverb with an adverb entry,
  // before `一寸`, a unit of length.
  const lemma = found[0]!.bases.at(-1);
  const upos = c.uposOf(found[0]!);
  const own =
    lemma !== undefined &&
    upos.size > 0 &&
    /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(word) &&
    /\p{Script=Han}/u.test(lemma) &&
    !c.rows(word).some((row) => upos.has(row.pos))
      ? c
          .rows(lemma)
          .filter(
            (row) =>
              lookupKey(row.lemma) === lookupKey(lemma) && upos.has(row.pos),
          )
      : [];
  if (own.length > 0) {
    const ids = [...new Set(own.map((row) => row.id))];
    const rest = c
      .rows(word)
      .map((row) => row.id)
      .filter((id) => !ids.includes(id));
    return { entries: loadEntries(c.db, [...ids, ...new Set(rest)]) };
  }
  // Nothing for the word as written (`暗く`): its base form's entries
  // (`暗い`). A top entry only redirected there: the lemma's entries first
  // (`所` for `とこ`, before `常` and `床`).
  if (
    c.rows(word).length > 0 &&
    c.rows(word)[0]!.source !== FormSource.Redirect
  ) {
    return PLAIN;
  }
  const byLemma =
    lemma === undefined
      ? []
      : c
          .rows(lemma)
          .filter((row) => lookupKey(row.lemma) === lookupKey(lemma))
          .map((row) => row.id);
  const ranked = byLemma.length > 0 ? byLemma : wholeIds(c, found, text);
  if (ranked.length === 0 || ranked[0] === c.rows(word)[0]?.id) {
    return PLAIN;
  }
  const rest = c
    .rows(word)
    .map((row) => row.id)
    .filter((id) => !ranked.includes(id));
  return { entries: loadEntries(c.db, [...ranked, ...new Set(rest)]) };
};
