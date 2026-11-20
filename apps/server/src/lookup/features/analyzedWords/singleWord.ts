import { hasKanji, isKana } from "@dict/core/kana";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource } from "@dict/core/schema";
import { loadEntries } from "../../common/entries.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { LEXICALIZED, wholeIds } from "./parts.ts";

/**
 * The clicked piece is the word: the plain lookup answers, unless its top
 * entry is only redirected there, as an obscure word written alike (`みる`
 * to `海松` "seaweed"). Then the analyzer's lemma comes first (`見る`), with
 * nothing underlined.
 */
export const singleWord = (c: Click): Answer => {
  const { word, found, text } = c;
  if (found.length !== 1 || text !== word) return undefined;
  // A morpheme the dictionary spells otherwise (`갈` is `가다` + `-ㄹ`, not
  // `갈` "reed"): its base forms' entries first, then the word's own as
  // written, those of the analyzer's part of speech first.
  // With spaces, a headword spelled as written that names nothing comes
  // first: `다른` "other", `그런` "such", not `다르다`, `그렇다`.
  if (found[0]!.respelled === true) {
    const ids = wholeIds(c, found, text);
    const written = c.rows(word).map((row) => row.id);
    const verbal = ["VERB", "ADJ"].some((tag) => c.uposOf(found[0]!).has(tag));
    const own =
      c.settings.spacedWords && verbal
        ? c
            .rows(word)
            .filter(
              (row) =>
                row.source === FormSource.Lemma &&
                LEXICALIZED.has(row.pos) &&
                lookupKey(row.lemma) === lookupKey(word),
            )
            .map((row) => row.id)
        : [];
    const first = [...own, ...ids];
    if (first.length === 0 || first[0] === written[0]) return PLAIN;
    const upos = c.uposOf(found[0]!);
    const fits = (id: number) => upos.has(c.infoOf(id).pos);
    const rest = written.filter((id) => !first.includes(id));
    return {
      entries: loadEntries(c.db, [
        ...new Set([...first, ...rest.filter(fits), ...rest]),
      ]),
    };
  }
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
    isKana(word) &&
    hasKanji(lemma) &&
    !c.rows(word).some((row) => upos.has(row.pos))
      ? c
          .rows(lemma)
          .filter(
            (row) =>
              lookupKey(row.lemma) === lookupKey(lemma) && upos.has(row.pos),
          )
      : [];
  // Written in kana, the word is its reading: the lemma's entries read so
  // come first (`ところ` is `所` ところ "place", before `所` しょ), of the
  // analyzer's part of speech first (`まだ` the adverb).
  if (own.length > 0) {
    const ids = c.byReading([...new Set(own.map((row) => row.id))], [word]);
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
    return byPos(c, upos);
  }
  const byLemma =
    lemma === undefined
      ? []
      : c
          .rows(lemma)
          .filter((row) => lookupKey(row.lemma) === lookupKey(lemma))
          .map((row) => row.id);
  const ranked =
    byLemma.length > 0
      ? c.byReading(byLemma, [word], (id) =>
          upos.has(c.infoOf(id).pos) ? 1 : 0,
        )
      : wholeIds(c, found, text);
  if (ranked.length === 0 || ranked[0] === c.rows(word)[0]?.id) {
    return PLAIN;
  }
  const rest = c
    .rows(word)
    .map((row) => row.id)
    .filter((id) => !ranked.includes(id));
  return { entries: loadEntries(c.db, [...ranked, ...new Set(rest)]) };
};

/**
 * The plain lookup's entries, those of the analyzer's parts of speech first
 * (`ranksByPos`: `우리` the pronoun before `우리` "cage"), when the first
 * is none of them and some are.
 */
const byPos = (c: Click, upos: ReadonlySet<string>): Answer => {
  if (!c.settings.ranksByPos || upos.size === 0) return PLAIN;
  const ids = [...new Set(c.rows(c.word).map((row) => row.id))];
  const fits = (id: number) => upos.has(c.infoOf(id).pos);
  if (fits(ids[0]!) || !ids.some(fits)) return PLAIN;
  return {
    entries: loadEntries(c.db, [...new Set([...ids.filter(fits), ...ids])]),
  };
};
