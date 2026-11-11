import { loadEntries } from "../../common/entries.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { wholeIds } from "./parts.ts";
import { endOf, headOf, startOf } from "./words.ts";

/** Most words a phrase may span. */
const MAX_PHRASE_WORDS = 4;

/**
 * A phrase over several words around the clicked one, longest first: an entry
 * whose lemma is itself several words (`手に入る`, `かも知れない`; not
 * `似合う` for `に|あわせて`). It may end inside its last word
 * (`かもしれない` in `か|も|しれないです`), or be written with that word's
 * base form (`手に入れ|た` -> `手に入れる`). It is tried before the
 * segmenter's own piece: `によると` before `による`.
 */
export const phraseLookup = (c: Click): Answer => {
  const { context, piece, words, index, found, word } = c;
  for (let size = MAX_PHRASE_WORDS; size >= 2; size--) {
    for (let first = Math.max(0, index - size + 1); first <= index; first++) {
      const span = words.slice(first, first + size);
      if (span.length < size) continue;
      const gaps = span.some(
        (w, i) => i > 0 && startOf(w) !== endOf(span[i - 1]!),
      );
      if (gaps) continue;
      const start = startOf(span[0]!);
      // The phrase holds the clicked piece from its start on (not `より…`
      // for `たより`, which starts in the word before).
      if (start > piece.start) continue;
      const last = span.at(-1)!;
      const head = headOf(last, c.settings);
      const forms: Array<{ form: string; written: string }> = [];
      // Spelled as written, and with each morpheme spelled its lemma's way
      // (`かもしれない` -> `かも知れない`, `手にいれ` -> `手に入れ`).
      const morphemes = span.flat();
      const respelled = (upTo: number) =>
        morphemes
          .slice(0, upTo)
          .map((m) => m.spellings.at(-1)!)
          .join("");
      for (let k = last.length; k >= 1; k--) {
        const end = last[k - 1]!.end;
        // The phrase holds the whole clicked piece (`による` in `に|よる|と`).
        if (end < piece.end) break;
        const written = context.slice(start, end);
        const upTo = morphemes.indexOf(last[k - 1]!) + 1;
        forms.push(
          { form: written, written },
          { form: respelled(upTo), written },
        );
        if (k === last.length) {
          const before = morphemes.indexOf(head);
          for (const base of head.bases) {
            forms.push(
              { form: context.slice(start, head.start) + base, written },
              { form: respelled(before) + base, written },
            );
          }
        }
      }
      for (const { form, written } of forms) {
        const phrase = c.rows(form).filter(c.severalWords);
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
    }
  }
  return undefined;
};
