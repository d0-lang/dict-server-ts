import { hiragana } from "@dict/core/kana";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import { loadEntries } from "../../common/entries.ts";
import type { FormRow } from "../../common/forms.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { morphemeParts, splitResult, wholeIds } from "./parts.ts";
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
      // Words that touch, or in a language with spaces, words a space apart
      // (`-ㄹ 수 있다`, `예를 들어`).
      const gaps = span.some((w, i) => {
        if (i === 0) return false;
        const between = c.context.slice(endOf(span[i - 1]!), startOf(w));
        return (
          between !== "" && !(c.settings.spacedWords && /^ +$/.test(between))
        );
      });
      if (gaps) continue;
      for (const start of startsIn(c, span[0]!)) {
        const answer = phraseAt(c, span, start);
        if (answer !== undefined) return answer;
      }
      for (const lead of endingLeads(c, span[0]!)) {
        const answer = phraseAt(c, span, lead.start, lead);
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

/**
 * A phrase's start at an ending or particle, written as the grammar file
 * writes it, with its hyphen (`baseSpellings`): what a construction over
 * words a space apart starts with in a language with spaces. `갈` (`가` +
 * `ㄹ`) of `갈 수 있다` starts `-ㄹ 수 있다`; `에` of `급수에 따라`,
 * `-에 따라`. The run underlined starts where that morpheme does.
 */
type Lead = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

const endingLeads = (c: Click, w: Word): ReadonlyArray<Lead> => {
  if (!c.settings.spacedWords) return [];
  const head = w.findIndex((m) => !hasPos(m.pos, c.settings.prefixes));
  return w.flatMap((m, i) => {
    const text = m.bases.at(-1);
    return i >= head && text !== undefined && text.startsWith("-")
      ? [{ start: m.start, end: m.end, text }]
      : [];
  });
};

/**
 * The phrase over `span` from `start` on, if the dictionary has one; a start
 * past the first word's own grammar-file phrases only, as is one from a
 * `lead`, written in its place.
 */
const phraseAt = (
  c: Click,
  span: ReadonlyArray<Word>,
  start: number,
  lead?: Lead,
): Answer => {
  const { context, piece, found, word } = c;
  const morphemes = span.flat().filter((m) => m.end > start);
  const grammarOnly = lead !== undefined || start !== startOf(span[0]!);
  // The phrase holds the clicked piece from its start on (not `より…`
  // for `たより`, which starts in the word before).
  if (start > piece.start) return undefined;
  const last = span.at(-1)!;
  const head = headOf(last, c.settings);
  const forms: Array<{ form: string; written: string }> = [];
  // Spelled as written, and with each morpheme spelled its lemma's way
  // (`かもしれない` -> `かも知れない`, `手にいれ` -> `手に入れ`).
  // A morpheme the phrase starts inside is written as it is.
  // The spaces between the words stay (`예를 들어`).
  const respelled = (upTo: number) =>
    morphemes
      .slice(0, upTo)
      .map(
        (m, i) =>
          (i > 0 ? context.slice(morphemes[i - 1]!.end, m.start) : "") +
          (m.start < start ? context.slice(start, m.end) : m.spellings.at(-1)!),
      )
      .join("");
  // From a lead, its spelling, then the text as written.
  const fromLead = (end: number) =>
    lead === undefined ? undefined : lead.text + context.slice(lead.end, end);
  for (let k = last.length; k >= 1; k--) {
    const end = last[k - 1]!.end;
    // The phrase holds the whole clicked piece (`による` in `に|よる|と`).
    if (end < piece.end) break;
    const written = context.slice(start, end);
    const upTo = morphemes.indexOf(last[k - 1]!) + 1;
    const led = fromLead(end);
    if (led !== undefined) forms.push({ form: led, written });
    else {
      forms.push(
        { form: written, written },
        { form: respelled(upTo), written },
      );
    }
    if (k === last.length) {
      const before = morphemes.indexOf(head);
      // The last word's head is before the start: nothing to put in its base form.
      if (head.start < start || (lead !== undefined && head.start < lead.end)) {
        continue;
      }
      for (const base of head.bases) {
        const ledBase = fromLead(head.start);
        if (ledBase !== undefined)
          forms.push({ form: ledBase + base, written });
        else {
          forms.push(
            { form: context.slice(start, head.start) + base, written },
            { form: respelled(before) + base, written },
          );
        }
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
    // In a language with spaces, the clicked word's own headword too, when
    // it is more than the analyzer's word (`때문에` "because of", `때문` +
    // `-에`, in `-기 때문에`).
    const clicked = c.settings.spacedWords
      ? c
          .rows(word)
          .filter(
            (row) =>
              row.source === FormSource.Lemma &&
              lookupKey(row.lemma) === lookupKey(word),
          )
          .map((row) => row.id)
      : [];
    const own = [...new Set([...clicked, ...wholeIds(c, found, c.text)])];
    // Each underlines what it covers, when that is more than the clicked
    // word: the phrase (`手に入る` for `入る`), and the word around the
    // piece (`しれないです` for `れ`). The clicked word's own entries
    // (`入る`) underline nothing.
    const phraseMatch = c.matchOf(start, start + written.length);
    const ownMatch = c.matchOf(startOf(found), endOf(found));
    const entries = [
      ...loadEntries(c.db, phraseIds).map((entry) => ({
        ...entry,
        ...phraseMatch,
      })),
      ...loadEntries(
        c.db,
        own.filter((id) => !phraseIds.includes(id)),
      ).map((entry) => ({ ...entry, ...ownMatch })),
    ];
    // A grammar construction keeps the clicked word's own pieces, as the
    // word alone would (`に|し|たい|です` for `にする`: たい "want to" is
    // there too), when the construction ends where that word ends.
    const construction = phrase.every(grammar);
    const parts =
      construction &&
      start + written.length === endOf(found) &&
      phraseMatch.match !== undefined
        ? morphemeParts(c, found, new Set([...phraseIds, ...own]))
        : [];
    // Segments split the match (PROTOCOL.md), which in a language with
    // spaces runs over several words (`알 수 있는`): the construction is
    // shown without them there.
    if (parts.length > 1 && !c.settings.spacedWords) {
      const before = context.slice(start, startOf(found));
      return splitResult(
        c.db,
        entries,
        [...(before === "" ? [] : [{ text: before, ids: [] }]), ...parts],
        {},
      );
    }
    return { entries };
  }
  return undefined;
};
