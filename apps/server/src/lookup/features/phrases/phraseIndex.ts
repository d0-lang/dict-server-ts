import type { DictionaryDb } from "@dict/core/DictionaryDb";
import type { Language } from "@dict/core/language";
import { FormSource, type UdPos } from "@dict/core/schema";
import { tokenize } from "../../common/tokenize.ts";

/** A multi-word form of a multi-word entry, as words. */
export type Phrase = {
  readonly tokens: ReadonlyArray<string>;
  readonly breaks: ReadonlyArray<boolean>;
  readonly entryIds: ReadonlyArray<number>;
  /** Its verb may inflect and stand apart: a verb entry, or an untyped phrase with a verb. */
  readonly verb: boolean;
  /**
   * An entry is tagged as a verb. Only these follow the German bracket (the
   * rest ends the clause, the verb may come first), which untyped phrasebook
   * lines don't (`Wie heißen Sie eigentlich?`).
   */
  readonly verbEntry: boolean;
  /** Every entry is an interjection, which only means that as a clause of its own. */
  readonly interjection: boolean;
};

/** Phrases by each of their words. */
type PhraseIndex = ReadonlyMap<string, ReadonlyArray<Phrase>>;

const indexes = new WeakMap<DictionaryDb, PhraseIndex>();

/**
 * Every multi-word form of a multi-word entry (`in Kraft treten`, `vor allem`,
 * and inflected rows like `Vereinigten Staaten`), indexed by its words. Built
 * once per file, on first use.
 */
export const phraseIndex = (
  db: DictionaryDb,
  language: Language,
): PhraseIndex => {
  const locale = language.code;
  const cached = indexes.get(db);
  if (cached !== undefined) return cached;
  // Wiktionary files many verb idioms as untyped phrases (`стелить соломку`,
  // `ihre Tage haben`), so a phrase with a verb's dictionary form counts as a
  // verb phrase too. Not proverbs, which are quoted, not inflected.
  const verbLemmas = new Set(
    db.$client
      .query<{ form: string }, []>(
        `SELECT DISTINCT f.form AS form FROM forms f JOIN entries e ON e.id = f.entry_id
         WHERE f.source = ${FormSource.Lemma} AND e.pos IN ('VERB', 'AUX')`,
      )
      .all()
      .map((row) => row.form),
  );
  const rows = db.$client
    .query<{ form: string; id: number; pos: UdPos; sourcePos: string }, []>(
      `SELECT f.form AS form, e.id AS id, e.pos AS pos, e.source_pos AS sourcePos FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE instr(f.form, ' ') > 0 AND instr(e.lemma, ' ') > 0 AND f.source <> ${FormSource.Abbreviation}
       ORDER BY f.form, e.id`,
    )
    .all();
  const byForm = new Map<
    string,
    {
      ids: Array<number>;
      verb: boolean;
      verbEntry: boolean;
      interjection: boolean;
    }
  >();
  for (const row of rows) {
    const phrase = byForm.get(row.form) ?? {
      ids: [],
      verb: false,
      verbEntry: false,
      interjection: true,
    };
    phrase.ids.push(row.id);
    phrase.verbEntry ||= row.pos === "VERB";
    phrase.verb ||=
      row.pos === "VERB" ||
      (row.pos === "X" &&
        row.sourcePos === "phrase" &&
        tokenize(row.form, locale).some((token) => verbLemmas.has(token.key)));
    phrase.interjection &&= row.pos === "INTJ";
    byForm.set(row.form, phrase);
  }
  const index = new Map<string, Array<Phrase>>();
  for (const [form, { ids, verb, verbEntry, interjection }] of byForm) {
    const tokens = tokenize(form, locale);
    if (tokens.length < 2) continue;
    const phrase: Phrase = {
      tokens: tokens.map((token) => token.key),
      breaks: tokens.map((token) => token.breakBefore),
      entryIds: ids,
      verb,
      verbEntry,
      interjection,
    };
    for (const key of new Set(phrase.tokens)) {
      const list = index.get(key);
      if (list === undefined) index.set(key, [phrase]);
      else list.push(phrase);
    }
  }
  indexes.set(db, index);
  return index;
};
