import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { hiragana } from "@dict/core/kana";
import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";
import {
  analyzerFor,
  type Analyzer,
  type Known,
  type Morpheme,
} from "../../common/analyzer.ts";
import type { LookupEntry, LookupResult } from "../../common/entries.ts";
import { type FormRow, formRows } from "../../common/forms.ts";
import { copyStart } from "../../common/tokenize.ts";
import {
  endOf,
  hasPos,
  type Settings,
  startOf,
  type Word,
  wordsOf,
} from "./words.ts";

/**
 * A click placed in the analyzer's words, with what every step of the lookup
 * asks about it: the word around it, the words it touches, the dictionary's
 * rows for a form, and the readings of entries.
 */

/** A step's answer: its result, `PLAIN` for the plain lookup's, or undefined to leave it to the next step. */
export const PLAIN = "plain";
export type Answer = LookupResult | typeof PLAIN | undefined;

/** An entry's part of speech, Wiktionary's part of speech, and its readings in hiragana. */
export type EntryInfo = {
  readonly pos: string;
  readonly sourcePos: string;
  readonly readings: ReadonlyArray<string>;
};

export type Click = {
  readonly db: DictionaryDb;
  readonly word: string;
  readonly context: string;
  /** The language the senses are written in. */
  readonly target: string;
  readonly settings: Settings;
  readonly analyze: Analyzer;
  /** Where the clicked piece is in `context`. */
  readonly piece: { readonly start: number; readonly end: number };
  readonly words: ReadonlyArray<Word>;
  /** The word around the piece, and its index in `words`. */
  readonly found: Word;
  readonly index: number;
  /** `found` as written. */
  readonly text: string;
  /** The words the piece touches, and whether that is more than one. */
  readonly touched: ReadonlyArray<Word>;
  readonly wider: boolean;
  readonly textOf: (w: Word) => string;
  /**
   * `match` for entries the sentence adds: the run of `context` they cover,
   * when it holds the clicked word and more. The word's own entries get none,
   * and neither does a lookup without a sentence, where the word is all
   * there is.
   */
  readonly matchOf: (start: number, end: number) => Pick<LookupEntry, "match">;
  /** The dictionary's rows for a form, cached for the lookup. */
  readonly rows: (form: string) => ReadonlyArray<FormRow>;
  /** The UD parts of speech the language maps the morpheme's tags to. */
  readonly uposOf: (m: Morpheme) => ReadonlySet<string>;
  readonly infoOf: (id: number) => EntryInfo;
  /**
   * `ids` with the entries read as the analyzer reads the word first (`人` as
   * にん in `3人`, not ひと), then by `preferred`, highest first (a
   * counter's counter entries: `年` "years" before `年` "a year"); in their
   * order otherwise.
   */
  readonly byReading: (
    ids: ReadonlyArray<number>,
    readings: ReadonlyArray<string | undefined>,
    preferred?: (id: number) => number,
  ) => ReadonlyArray<number>;
  /** The analyzer's reading of `text`, its morphemes' readings joined. */
  readonly readingOf: (text: string) => string | undefined;
  /** An entry whose lemma is itself several words: a phrase. */
  readonly severalWords: (row: FormRow) => boolean;
};

const knowns = new WeakMap<DictionaryDb, Known>();

/** Whether `db` has a form, cached per dictionary: for the analyzer's `restore`. */
const knownIn = (db: DictionaryDb): Known => {
  let known = knowns.get(db);
  if (known === undefined) {
    const seen = new Map<string, boolean>();
    known = (form) => {
      const key = lookupKey(form);
      let has = seen.get(key);
      if (has === undefined) {
        has = formRows(db, key).length > 0;
        seen.set(key, has);
      }
      return has;
    };
    knowns.set(db, known);
  }
  return known;
};

/** Where the only copy of `word` in `context` starts, or -1 when there is none or more than one. */
const onlyCopy = (context: string, word: string): number => {
  const first = context.indexOf(word);
  return first >= 0 && context.indexOf(word, first + word.length) < 0
    ? first
    : -1;
};

/**
 * The click on `word` in `context`, placed in the analyzer's words, or
 * undefined when the language has no analyzer or the click can't be placed.
 */
export const clickOf = (
  db: DictionaryDb,
  word: string,
  context: string,
  language: Language,
  at?: number,
): Click | undefined => {
  const settings = language.context.analyzer;
  const analyze = analyzerFor(language, knownIn(db));
  if (settings === undefined || analyze === undefined) return undefined;
  // The click by its place in the string, as `at` counts copies of `word`,
  // not by the server's own segmenter: Bun's cuts a sentence otherwise than
  // the browser's (`どう|した|の`, where Chrome sends `どうし`; `な|っ|た`,
  // where it sends `った`), so the piece the client sent need not be one of
  // its words. Without `at`, the only copy; without a sentence, the word is
  // all there is (`5冊`).
  const start =
    context === word
      ? 0
      : at !== undefined
        ? copyStart(context, word, at)
        : onlyCopy(context, word);
  if (word === "" || start < 0) return undefined;
  const piece = { start, end: start + word.length };
  // A word in Latin letters alone (`JOC`, `Don`) is no word of this
  // language. A unit after a number is (`28g`: the analyzer reads `グラム`).
  if (/^[\p{Script=Latin}\p{P}]+$/u.test(word)) return undefined;

  const words = wordsOf(analyze(context), settings);
  // The word the piece starts with, when it starts one (`に` of `における`,
  // `東` of `東日本`). A piece that starts inside a word is cut off from it
  // (`思っ|たより`): then the word holding most of the piece, the first on a
  // tie (`より`; `あります` of `ありま|すか`).
  const overlap = (w: Word) =>
    Math.min(endOf(w), piece.end) - Math.max(startOf(w), piece.start);
  let index = words.findIndex((w) => startOf(w) === piece.start);
  if (index < 0) {
    words.forEach((w, i) => {
      if (
        overlap(w) > 0 &&
        (index < 0 || overlap(w) > overlap(words[index]!))
      ) {
        index = i;
      }
    });
  }
  if (index < 0) return undefined;
  const found = words[index]!;
  const textOf = (w: Word) => context.slice(startOf(w), endOf(w));
  // The piece runs past the word on either side (`たより` for `より`): it
  // touches other words too.
  const touched = words.filter((w) => overlap(w) > 0);

  const cache = new Map<string, ReadonlyArray<FormRow>>();
  const rows = (form: string): ReadonlyArray<FormRow> => {
    const key = lookupKey(form);
    let result = cache.get(key);
    if (result === undefined) {
      result = formRows(db, key);
      cache.set(key, result);
    }
    return result;
  };
  const infos = new Map<number, EntryInfo>();
  const infoOf = (id: number): EntryInfo => {
    let info = infos.get(id);
    if (info === undefined) {
      const found = db.$client
        .query<
          { pos: string; sourcePos: string; reading: string | null },
          [number]
        >(
          `SELECT e.pos AS pos, e.source_pos AS sourcePos, p.value AS reading FROM entries e
           LEFT JOIN pronunciations p ON p.entry_id = e.id AND p.kind = 'reading'
           WHERE e.id = ?1`,
        )
        .all(id);
      info = {
        pos: found[0]?.pos ?? "",
        sourcePos: found[0]?.sourcePos ?? "",
        readings: found.flatMap((row) =>
          row.reading === null ? [] : [hiragana(row.reading)],
        ),
      };
      infos.set(id, info);
    }
    return info;
  };
  /**
   * The entry has one of `readings`. Japanese: the analyzer gives a reading
   * in katakana (`ニン`) and the dictionary in hiragana (`にん`).
   */
  const readAs = (id: number, readings: ReadonlyArray<string | undefined>) => {
    const own = infoOf(id).readings;
    return readings.some(
      (reading) => reading !== undefined && own.includes(hiragana(reading)),
    );
  };

  return {
    db,
    word,
    context,
    target: language.target,
    settings,
    analyze,
    piece,
    words,
    found,
    index,
    text: textOf(found),
    touched,
    wider: touched.length > 1,
    textOf,
    matchOf: (start, end) => {
      const run = context.slice(start, end);
      return start <= piece.start &&
        end >= piece.end &&
        run !== word &&
        run.includes(word)
        ? { match: [run] }
        : {};
    },
    rows,
    uposOf: (m) =>
      new Set(
        Object.entries(settings.upos).flatMap(([tag, tags]) =>
          hasPos(m.pos, [tag]) ? tags : [],
        ),
      ),
    infoOf,
    byReading: (ids, readings, preferred = () => 0) => {
      const score = (id: number) =>
        (readAs(id, readings) ? 10 : 0) + preferred(id);
      return ids
        .map((id, i) => ({ id, i, score: score(id) }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map(({ id }) => id);
    },
    readingOf: (text) => {
      const morphemes = analyze(text);
      return morphemes.every((m) => m.reading !== undefined)
        ? morphemes.map((m) => m.reading).join("")
        : undefined;
    },
    // With spaces, a phrase is written with one (`예를 들다`): the analyzer
    // cuts a lone verb's lemma too (`우리다` as `우리` + `-다`).
    severalWords: (row) =>
      settings.spacedWords
        ? /\s/u.test(row.lemma.trim())
        : wordsOf(analyze(row.lemma), settings).length > 1,
  };
};
