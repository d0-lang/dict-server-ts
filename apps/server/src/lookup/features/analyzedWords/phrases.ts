import { hiragana } from "@dict/core/kana";
import { GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import { loadEntries } from "../../common/entries.ts";
import type { FormRow } from "../../common/forms.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { wholeIds } from "./parts.ts";
import { endOf, hasPos, headOf, startOf, type Word } from "./words.ts";

/** Most words a phrase may span. */
const MAX_PHRASE_WORDS = 4;

/**
 * A phrase over several words around the clicked one, longest first: an entry
 * whose lemma is itself several words (`手に入る`, `かも知れない`; not
 * `似合う` for `に|あわせて`). It may end inside its last word
 * (`かもしれない` in `か|も|しれないです`), or be written with that word's
 * base form (`手に入れ|た` -> `手に入れる`). It is tried before the
 * segmenter's own piece: `によると` before `による`.
 *
 * A grammar-file phrase may also start at an ending of its first word
 * (`なければならない` in `行か|なけれ|ば|ならない`), or inside the ending of
 * a conjugated verb that the analyzer gives as one morpheme (`ようとする` in
 * `出よう|と|した`, `うとする` in `行こう|と|した`): a construction that
 * follows any verb. Wiktionary's phrases start where a word starts.
 */
export const phraseLookup = (c: Click): Answer => {
  const { words, index } = c;
  for (let size = MAX_PHRASE_WORDS; size >= 2; size--) {
    for (let first = Math.max(0, index - size + 1); first <= index; first++) {
      const span = words.slice(first, first + size);
      if (span.length < size) continue;
      const gaps = span.some(
        (w, i) => i > 0 && startOf(w) !== endOf(span[i - 1]!),
      );
      if (gaps) continue;
      for (const start of startsIn(c, span[0]!)) {
        const answer = phraseAt(c, span, start);
        if (answer !== undefined) return answer;
      }
    }
  }
  return undefined;
};

/**
 * Where in its first word a phrase may start, earliest first: the word's
 * start, then each ending after its head, and inside a conjugated morpheme
 * from the head on, each place past its stem, the part it shares with its
 * base form (`よう` of `食べよう`, base `食べる`).
 */
const startsIn = (c: Click, w: Word): ReadonlyArray<number> => {
  const head = w.findIndex((m) => !hasPos(m.pos, c.settings.prefixes));
  const starts = [startOf(w)];
  w.forEach((m, i) => {
    if (head < 0 || i < head) return;
    if (i > head) starts.push(m.start);
    const upos = c.uposOf(m);
    if (!["VERB", "ADJ", "AUX"].some((tag) => upos.has(tag))) return;
    const base = m.bases[0] ?? "";
    let stem = 0;
    while (stem < base.length && m.surface[stem] === base[stem]) stem++;
    for (let k = Math.max(1, stem); k < m.surface.length; k++) {
      starts.push(m.start + k);
    }
  });
  return [...new Set(starts)];
};

/** The phrase over `span` from `start` on, if the dictionary has one; a start past the first word's own grammar-file phrases only. */
const phraseAt = (
  c: Click,
  span: ReadonlyArray<Word>,
  start: number,
): Answer => {
  const { context, piece, found, word } = c;
  const morphemes = span.flat().filter((m) => m.end > start);
  const grammarOnly = start !== startOf(span[0]!);
  // The phrase holds the clicked piece from its start on (not `より…`
  // for `たより`, which starts in the word before).
  if (start > piece.start) return undefined;
  const last = span.at(-1)!;
  const head = headOf(last, c.settings);
  const forms: Array<{ form: string; written: string }> = [];
  // Spelled as written, and with each morpheme spelled its lemma's way
  // (`かもしれない` -> `かも知れない`, `手にいれ` -> `手に入れ`).
  // A morpheme the phrase starts inside is written as it is.
  const respelled = (upTo: number) =>
    morphemes
      .slice(0, upTo)
      .map((m) =>
        m.start < start ? context.slice(start, m.end) : m.spellings.at(-1)!,
      )
      .join("");
  for (let k = last.length; k >= 1; k--) {
    const end = last[k - 1]!.end;
    // The phrase holds the whole clicked piece (`による` in `に|よる|と`).
    if (end < piece.end) break;
    const written = context.slice(start, end);
    const upTo = morphemes.indexOf(last[k - 1]!) + 1;
    forms.push({ form: written, written }, { form: respelled(upTo), written });
    if (k === last.length) {
      const before = morphemes.indexOf(head);
      // The last word's head is before the start: nothing to put in its base form.
      if (head.start < start) continue;
      for (const base of head.bases) {
        forms.push(
          { form: context.slice(start, head.start) + base, written },
          { form: respelled(before) + base, written },
        );
      }
    }
  }
  // A name over a span written with digits is read with one of its numbers
  // (`第2次世界大戦`, with に in it). `四月一日` the surname, read わたぬき,
  // is not `4月1日`.
  const numbers = morphemes.flatMap((m) =>
    /[0-9０-９]/u.test(m.surface) && m.reading !== undefined
      ? [hiragana(m.reading)]
      : [],
  );
  const otherName = (row: FormRow) => {
    const { pos, readings } = c.infoOf(row.id);
    return (
      pos === "PROPN" &&
      numbers.length > 0 &&
      readings.length > 0 &&
      !readings.some((reading) => numbers.some((n) => reading.includes(n)))
    );
  };
  // A grammar-file line found over these words is a phrase, even if the
  // analyzer reads its spelling alone as one word (`がする`, a verb to it).
  const grammar = (row: FormRow) =>
    c.infoOf(row.id).sourcePos === GRAMMAR_SOURCE_POS;
  const fits = (row: FormRow) =>
    (c.severalWords(row) || grammar(row)) &&
    !otherName(row) &&
    (!grammarOnly || grammar(row));
  for (const { form, written } of forms) {
    const phrase = c.rows(form).filter(fits);
    if (phrase.length === 0) continue;
    // The phrase is just the clicked piece (`日本語`, `日本|語` to the
    // analyzer): the plain lookup answers, if it has the piece.
    if (written === word && c.rows(word).length > 0) return PLAIN;
    const phraseIds = [...new Set(phrase.map((row) => row.id))];
    const own = wholeIds(c, found, c.text);
    // Each underlines what it covers, when that is more than the clicked
    // word: the phrase (`手に入る` for `入る`), and the word around the
    // piece (`しれないです` for `れ`). The clicked word's own entries
    // (`入る`) underline nothing.
    const phraseMatch = c.matchOf(start, start + written.length);
    const ownMatch = c.matchOf(startOf(found), endOf(found));
    return {
      entries: [
        ...loadEntries(c.db, phraseIds).map((entry) => ({
          ...entry,
          ...phraseMatch,
        })),
        ...loadEntries(
          c.db,
          own.filter((id) => !phraseIds.includes(id)),
        ).map((entry) => ({ ...entry, ...ownMatch })),
      ],
    };
  }
  return undefined;
};
