import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupKey } from "@dict/core/lookupKey";
import {
  loadEntries,
  type LookupEntry,
  type LookupResult,
  type Segment,
} from "../../common/entries.ts";
import { type FormRow, grammarIds } from "../../common/forms.ts";
import type { Click } from "./click.ts";
import { hasPos, headOf, startOf, type Word } from "./words.ts";

/** A word's entries as a whole, and its pieces as `segments`, each with its own entries. */

/** `entries.source_pos` of entries that name a letter or a syllable, not a word. */
const LETTERS = new Set(["character", "letter-name", "syllable"]);

/** Parts of speech that take endings, so a word with endings keeps only these entries. */
export const INFLECTING = new Set(["VERB", "ADJ", "AUX"]);

/**
 * A written piece of the answer with its entries' ids. `main`: its entries
 * rank first, because it holds the click or carries the word's meaning.
 */
export type Part = {
  readonly text: string;
  readonly ids: ReadonlyArray<number>;
  readonly main?: boolean;
};

/**
 * A result of entries for the whole run, then each part's: the main parts'
 * first, then the others' as written. `match` names the run the parts spell,
 * when it is more than the clicked word: on the whole run's entries, as the
 * protocol asks of the first entry. With none of those, on the entries of the
 * part shown first, all of them: entries with one headword are merged only
 * when their `match` is the same (`presentResult`).
 */
export const splitResult = (
  db: DictionaryDb,
  whole: ReadonlyArray<LookupEntry>,
  parts: ReadonlyArray<Part>,
  match: Pick<LookupEntry, "match">,
): LookupResult => {
  const ranked = [
    ...parts.filter((part) => part.main === true),
    ...parts.filter((part) => part.main !== true),
  ];
  const from = new Map<Part, number>();
  let next = whole.length;
  for (const part of ranked) {
    from.set(part, next);
    next += part.ids.length;
  }
  const first =
    whole.length === 0 ? ranked.find((part) => part.ids.length > 0) : undefined;
  return {
    entries: [
      ...whole.map((entry) => ({ ...entry, ...match })),
      ...ranked.flatMap((part) =>
        loadEntries(db, part.ids).map((entry) =>
          part === first ? { ...entry, ...match } : entry,
        ),
      ),
    ],
    segments: parts.map((part): Segment =>
      part.ids.length > 0
        ? {
            text: part.text,
            entries: part.ids.map((_, k) => from.get(part)! + k),
          }
        : { text: part.text },
    ),
  };
};

/** The word's own entries: its form as written, else its head's base forms (`勉強` for `勉強しています`). */
export const wholeIds = (
  c: Click,
  w: Word,
  written: string,
): ReadonlyArray<number> => {
  const head = headOf(w, c.settings);
  const prefix = c.context.slice(startOf(w), head.start);
  const candidates = [
    written,
    ...head.bases.flatMap((base) =>
      prefix === "" ? [base] : [prefix + base, base],
    ),
  ];
  const inflected = w.length > 1 && w.at(-1) !== head;
  for (const form of candidates) {
    const found = c.rows(form);
    if (found.length === 0) continue;
    const inflecting = found.filter((row) => INFLECTING.has(row.pos));
    const kept = inflected && inflecting.length > 0 ? inflecting : found;
    // The base forms' own entries first, the last named first: it is the
    // most specific (UniDic's lemma `要る` against the written `いる`, which
    // is also `居る`). Entries that only name the form follow (`行った`
    // "past of 行く").
    const priority = (row: FormRow) => {
      const at = head.bases.map(lookupKey).lastIndexOf(lookupKey(row.lemma));
      return at < 0 ? head.bases.length : head.bases.length - 1 - at;
    };
    const ranked = [...kept].sort((a, b) => priority(a) - priority(b));
    return [...new Set(ranked.map((row) => row.id))];
  }
  return [];
};

/**
 * A word made with a suffix (`機械|屋` "mechanic") is not the word before
 * the suffix (`機械` "machine"). Without an entry of its own, it has no
 * entries as a whole: each part shows its own.
 */
export const derivedWord = (c: Click, w: Word): boolean =>
  c.rows(c.textOf(w)).length === 0 &&
  w.some((m) => hasPos(m.pos, c.settings.suffixes));

/**
 * Endings after the head that the grammar file lists together, as one part:
 * the longest run from `from` whose spelling has a line (`なかっ|た` is
 * `なかった`, "past of ない"), or whose last morpheme in its base form does
 * (`て|おい` is `ておく`, `て|い` is `ている`). Not by a base form that the
 * ending only adds to, since it then says more than its base: `たら` is `た`
 * and "if", so `なかっ|たら` is not `なかった`. Undefined when no run of two
 * or more has one.
 */
const endingGroup = (
  c: Click,
  w: Word,
  from: number,
):
  { readonly end: number; readonly ids: ReadonlyArray<number> } | undefined => {
  for (let end = w.length; end >= from + 2; end--) {
    const run = w.slice(from, end);
    const before = run
      .slice(0, -1)
      .map((m) => m.surface)
      .join("");
    const last = run.at(-1)!;
    const bases = last.bases.filter(
      (base) => last.surface === base || !last.surface.startsWith(base),
    );
    for (const form of [last.surface, ...bases].map((f) => before + f)) {
      const ids = grammarIds(c.db, lookupKey(form));
      if (ids.length > 0) return { end, ids };
    }
  }
  return undefined;
};

/**
 * Each morpheme a part: an ending by its grammar-file line, else by its base
 * forms (`し` -> `する`); the head also by its spelling (`勉強` the noun).
 * Endings the grammar file lists together are one part (`言え|なかった`,
 * `食べ|てい|ます`: `endingGroup`). Entries already `shown` for the whole
 * word are left out.
 */
export const morphemeParts = (
  c: Click,
  w: Word,
  shown: ReadonlySet<number>,
): ReadonlyArray<Part> => {
  const head = w.findIndex((m) => !hasPos(m.pos, c.settings.prefixes));
  const parts: Array<Part> = [];
  const add = (text: string, ids: ReadonlyArray<number>, main = false) =>
    parts.push({
      text,
      ids: [...new Set(ids)].filter((id) => !shown.has(id)),
      ...(main ? { main } : {}),
    });
  for (let i = 0; i < w.length;) {
    const group = head >= 0 && i > head ? endingGroup(c, w, i) : undefined;
    if (group !== undefined) {
      add(
        w
          .slice(i, group.end)
          .map((m) => m.surface)
          .join(""),
        group.ids,
      );
      i = group.end;
      continue;
    }
    const morpheme = w[i]!;
    const grammar = morpheme.bases.flatMap((base) => grammarIds(c.db, base));
    const isHead = i === head;
    const forms = isHead
      ? [morpheme.surface, ...morpheme.bases]
      : morpheme.bases;
    const bases = new Set([morpheme.surface, ...morpheme.bases].map(lookupKey));
    // Entries of the part's own lemma; else what its base forms find, for a
    // lemma the dictionary writes otherwise (`欲しい` under `ほしい`).
    const byLemma = forms.flatMap((form) =>
      c.rows(form).filter((row) => bases.has(lookupKey(row.lemma))),
    );
    // Only when they find one lemma: `とく` (casual `ておく`) would bring
    // `解く`, `説く` and `得`.
    const byBase = morpheme.bases.flatMap((base) => c.rows(base));
    const own =
      byLemma.length > 0
        ? byLemma
        : new Set(byBase.map((row) => lookupKey(row.lemma))).size === 1
          ? byBase
          : [];
    // A prefix is shown by its entries as a prefix first (`御` "used to
    // respectfully refer to…" for `お`), then as another word, and as a
    // syllable or character last.
    const rank = (row: FormRow) =>
      row.sourcePos === "prefix" ? 0 : LETTERS.has(row.sourcePos) ? 2 : 1;
    const ranked =
      head >= 0 && i < head ? [...own].sort((a, b) => rank(a) - rank(b)) : own;
    // The stem carries the word's meaning, so its entries rank first, even
    // with a prefix written before it (`お|送り`, `お|名前`): the client
    // opens on the segment of the first entry in one.
    add(
      morpheme.surface,
      !isHead && grammar.length > 0 ? grammar : ranked.map((row) => row.id),
      isHead,
    );
    i++;
  }
  return parts;
};
