import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { hiragana, isKana } from "@dict/core/kana";
import { lookupKey } from "@dict/core/lookupKey";
import {
  loadEntries,
  type LookupEntry,
  type LookupResult,
  type Segment,
} from "../../common/entries.ts";
import { type FormRow, grammarIds } from "../../common/forms.ts";
import type { Morpheme } from "../../common/analyzer.ts";
import type { Click } from "./click.ts";
import { hasPos, headOf, startOf, type Word } from "./words.ts";

/** A word's entries as a whole, and its pieces as `segments`, each with its own entries. */

/** `entries.source_pos` of entries that name a letter or a syllable, not a word. */
const LETTERS = new Set(["character", "letter-name", "syllable"]);

/** UD's open classes, and the function words a content word is not (`し` the verb, not the particle). */
const CONTENT_UPOS = new Set(["NOUN", "PROPN", "VERB", "ADJ", "ADV"]);
const FUNCTION_UPOS = new Set([
  "PART",
  "PRON",
  "ADP",
  "CCONJ",
  "SCONJ",
  "DET",
  "INTJ",
]);

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
  /** A label for these of `ids`: the piece a form ending closes (`並ぶ` in `並んで`, `て form`). */
  readonly form?: {
    readonly label: string;
    readonly ids: ReadonlyArray<number>;
  };
};

/** `entry` with `part`'s form label, when it is one of the ids the label is for. */
const withForm = (part: Part, id: number, entry: LookupEntry): LookupEntry =>
  part.form?.ids.includes(id) === true
    ? { ...entry, labels: [...(entry.labels ?? []), part.form.label] }
    : entry;

/**
 * A result of entries for the whole run, then each part's: the main parts'
 * first, then the others' as written. `match` names the run the parts spell,
 * when it is more than the clicked word: on the whole run's entries, as the
 * protocol asks of the first entry. With none of those, on the entries of the
 * part shown first, all of them: entries with one headword are merged only
 * when their `match` is the same (`presentResult`). One part is the whole
 * run, and no segments (`食べて`, its form ending joined).
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
        loadEntries(db, part.ids).map((loaded, k) => {
          const entry = withForm(part, part.ids[k]!, loaded);
          return part === first ? { ...entry, ...match } : entry;
        }),
      ),
    ],
    ...(parts.length > 1
      ? {
          segments: parts.map((part): Segment =>
            part.ids.length > 0
              ? {
                  text: part.text,
                  entries: part.ids.map((_, k) => from.get(part)! + k),
                }
              : { text: part.text },
          ),
        }
      : {}),
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
    // An entry read otherwise than the analyzer reads the head goes after
    // the others (`嫌` read いや: `いや`, not `や`, whose kana spelling
    // redirects there). A kana lemma is its own reading (`なる`).
    const reading =
      head.reading === undefined ? undefined : hiragana(head.reading);
    const misread = (row: FormRow) => {
      const readings = [
        ...c.infoOf(row.id).readings,
        ...(isKana(row.lemma) ? [hiragana(row.lemma)] : []),
      ];
      return reading !== undefined &&
        readings.length > 0 &&
        !readings.includes(reading)
        ? 1
        : 0;
    };
    const ranked = [...kept].sort(
      (a, b) => misread(a) - misread(b) || priority(a) - priority(b),
    );
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
    const rest = run
      .slice(1, -1)
      .map((m) => m.surface)
      .join("");
    // The first ending also by its base form: `で|い` is `ている`.
    const befores = [
      ...new Set([run[0]!.surface, ...run[0]!.bases].map((f) => f + rest)),
    ];
    const last = run.at(-1)!;
    const bases = last.bases.filter(
      (base) => last.surface === base || !last.surface.startsWith(base),
    );
    for (const before of befores) {
      for (const form of [last.surface, ...bases].map((f) => before + f)) {
        const ids = grammarIds(c.db, lookupKey(form));
        if (ids.length > 0) return { end, ids };
      }
    }
  }
  return undefined;
};

/**
 * Each morpheme a part: an ending by its grammar-file line, else by its base
 * forms (`し` -> `する`); the head also by its spelling (`勉強` the noun).
 * Endings the grammar file lists together are one part (`言え|なかった`,
 * `食べ|てい|ます`: `endingGroup`). A form ending closes the part before it
 * (`formEndings`: `食べて|います`). Entries already `shown` for the whole
 * word are left out.
 */
export const morphemeParts = (
  c: Click,
  w: Word,
  shown: ReadonlySet<number>,
): ReadonlyArray<Part> => {
  const head = w.findIndex((m) => !hasPos(m.pos, c.settings.prefixes));
  /** Each part, with the morphemes it spells (`from` up to `to`). */
  const parts: Array<Part & { readonly from: number; readonly to: number }> =
    [];
  const add = (
    from: number,
    to: number,
    ids: ReadonlyArray<number>,
    main = false,
  ) =>
    parts.push({
      text: w
        .slice(from, to)
        .map((m) => m.surface)
        .join(""),
      ids: [...new Set(ids)].filter((id) => !shown.has(id)),
      ...(main ? { main } : {}),
      from,
      to,
    });
  for (let i = 0; i < w.length;) {
    const group = head >= 0 && i > head ? endingGroup(c, w, i) : undefined;
    if (group !== undefined) {
      add(i, group.end, group.ids);
      i = group.end;
      continue;
    }
    const morpheme = w[i]!;
    // By its spelling first, when the grammar file has a line for it (`な`
    // after a な-adjective, whose base is `だ`), else by its base forms.
    const bySpelling = grammarIds(c.db, lookupKey(morpheme.surface));
    const grammar =
      bySpelling.length > 0
        ? bySpelling
        : morpheme.bases.flatMap((base) => grammarIds(c.db, base));
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
    const found =
      byLemma.length > 0
        ? byLemma
        : new Set(byBase.map((row) => lookupKey(row.lemma))).size === 1
          ? byBase
          : [];
    // A content word to the analyzer is no function word: `し` the verb is
    // not the particle or the pronoun. Other readings stay (`送り` the noun
    // for the verb's stem).
    const upos = c.uposOf(morpheme);
    const content = [...upos].some((tag) => CONTENT_UPOS.has(tag));
    const own = found.filter(
      (row) => !content || upos.has(row.pos) || !FUNCTION_UPOS.has(row.pos),
    );
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
      i,
      i + 1,
      !isHead && grammar.length > 0 ? grammar : ranked.map((row) => row.id),
      isHead,
    );
    i++;
  }
  return withFormEndings(c, w, head, parts, shown);
};

/**
 * The parts with each form ending moved onto the part before it, which it
 * closes (`並ん|で` is `並んで`): that part's entries get the ending's label,
 * and the ending's own line follows them. The parts after it, up to the next
 * form ending, are one part (`い|ます` is `います`), holding each one's
 * entries (`ている`, `ます`).
 */
const withFormEndings = (
  c: Click,
  w: Word,
  head: number,
  parts: ReadonlyArray<Part & { readonly from: number; readonly to: number }>,
  shown: ReadonlySet<number>,
): ReadonlyArray<Part> => {
  const endingOf = (m: Morpheme) =>
    c.settings.formEndings.find(
      (ending) =>
        hasPos(m.pos, ending.pos) &&
        (ending.surface === undefined || ending.surface.includes(m.surface)),
    );
  const out: Array<Part> = [];
  /** Whether the last part takes in the parts after it: what follows a form ending. */
  let open = false;
  let opensNext = false;
  for (const part of parts) {
    const first = w[part.from]!;
    const ending = part.from > head ? endingOf(first) : undefined;
    const before = out.at(-1);
    if (ending !== undefined && before !== undefined) {
      const own = first.bases
        .flatMap((base) => grammarIds(c.db, base))
        .filter((id) => !shown.has(id) && !before.ids.includes(id));
      out[out.length - 1] = {
        ...before,
        text: before.text + first.surface,
        ids: [...new Set([...before.ids, ...own])],
        // Only what inflects has the form (not `見` the noun in `見て`).
        form: {
          label: ending.label,
          ids: before.ids.filter((id) => INFLECTING.has(c.infoOf(id).pos)),
        },
      };
      open = false;
      opensNext = part.to - part.from === 1;
      if (!opensNext) {
        out.push({
          text: part.text.slice(first.surface.length),
          ids: part.ids,
        });
        open = true;
      }
      continue;
    }
    if (open) {
      const last = out.at(-1)!;
      out[out.length - 1] = {
        ...last,
        text: last.text + part.text,
        ids: [...new Set([...last.ids, ...part.ids])],
      };
      continue;
    }
    out.push(
      part.main === true
        ? { text: part.text, ids: part.ids, main: true }
        : { text: part.text, ids: part.ids },
    );
    if (opensNext) {
      open = true;
      opensNext = false;
    }
  }
  return out;
};

/**
 * A word of a run over several words as parts: an inflected word the
 * dictionary doesn't list as written by its morphemes, with the word's own
 * entries in its head's part (`接続` with `接続する`, in
 * `接続|して|しまった`); any other word as one part (`だった`, `いけない`,
 * `2900年`). The head's part is `main` when `main` is set. `shown` entries
 * are left out.
 */
export const wordParts = (
  c: Click,
  w: Word,
  shown: ReadonlySet<number>,
  main: boolean,
): ReadonlyArray<Part> => {
  const whole = wholeIds(c, w, c.textOf(w)).filter((id) => !shown.has(id));
  // A verb or adjective in it (`し` of `接続|し|て`, the head a noun).
  const inflected = w.some((m) =>
    [...c.uposOf(m)].some((tag) => INFLECTING.has(tag)),
  );
  if (w.length === 1 || !inflected || c.rows(c.textOf(w)).length > 0) {
    return [{ text: c.textOf(w), ids: whole, ...(main ? { main } : {}) }];
  }
  const parts = morphemeParts(c, w, new Set([...shown, ...whole]));
  const head = parts.find((part) => part.main === true) ?? parts[0]!;
  return parts.map((withMain) => {
    const { main: _, ...part } = withMain;
    return withMain === head
      ? {
          ...part,
          ids: [...whole, ...part.ids],
          ...(part.form !== undefined
            ? {
                form: {
                  ...part.form,
                  ids: [
                    ...whole.filter((id) => INFLECTING.has(c.infoOf(id).pos)),
                    ...part.form.ids,
                  ],
                },
              }
            : {}),
          ...(main ? { main } : {}),
        }
      : part;
  });
};
