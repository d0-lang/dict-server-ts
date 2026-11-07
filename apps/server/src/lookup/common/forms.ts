import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupKey } from "@dict/core/lookupKey";
import {
  CaseClass,
  FormSource,
  GRAMMAR_SOURCE_POS,
  type UdPos,
} from "@dict/core/schema";

/** Parts of speech that make a word worth anchoring a phrase on. */
const CONTENT_POS: ReadonlySet<UdPos> = new Set([
  "NOUN",
  "PROPN",
  "ADJ",
  "NUM",
  "VERB",
]);

/** What the dictionary knows about a word of the context. */
export type TokenInfo = {
  /** `lookupKey` of every lemma this form belongs to. */
  readonly lemmas: ReadonlySet<string>;
  /** The form's best reading, ranked as lookups rank, is a content word. */
  readonly content: boolean;
  /** The form is itself the lemma of a verb, so it can be a phrase's verb. */
  readonly verbLemma: boolean;
  /** The form can be a conjunction (`что`, `как`, `dass`). */
  readonly conjunction: boolean;
  /** The form can be a verb (`будет`, `могу`). */
  readonly verb: boolean;
};

export type FormRow = { id: number; lemma: string; pos: UdPos; source: number };

/**
 * Entries a normalized form belongs to, without the abbreviation fallback,
 * ranked like `rankedIds` in `entries.ts` for a word written as `wordClass`.
 */
export const formRows = (
  db: DictionaryDb,
  key: string,
  wordClass: CaseClass = CaseClass.Capitalised,
): ReadonlyArray<FormRow> =>
  db.$client
    .query<FormRow, [string, number]>(
      `SELECT e.id AS id, e.lemma AS lemma, e.pos AS pos, f.source AS source FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND f.source <> ${FormSource.Abbreviation}
       ORDER BY
         CASE
           WHEN ?2 = ${CaseClass.AllCaps} THEN e.case_class <> ${CaseClass.AllCaps}
           WHEN e.case_class = ${CaseClass.AllCaps} THEN 2
           WHEN ?2 = ${CaseClass.Lower} THEN e.case_class <> ${CaseClass.Lower}
           ELSE 0
         END,
         e.source_pos IN ('character', 'letter-name', 'syllable'),
         -- a redirect spells the word itself, in kana, so it ranks with the lemma
         f.source NOT IN (${FormSource.Lemma}, ${FormSource.Redirect}),
         f.source = ${FormSource.LetterVariant},
         e.id`,
    )
    .all(key, wordClass);

/** `TokenInfo` per word and capitalisation, cached for one lookup. */
export const tokenInfos = (db: DictionaryDb) => {
  const cache = new Map<string, TokenInfo>();
  return (
    key: string,
    wordClass: CaseClass = CaseClass.Capitalised,
  ): TokenInfo => {
    const cacheKey = `${wordClass}${key}`;
    let info = cache.get(cacheKey);
    if (info === undefined) {
      const rows = formRows(db, key, wordClass);
      info = {
        lemmas: new Set(rows.map((row) => lookupKey(row.lemma))),
        content: rows[0] !== undefined && CONTENT_POS.has(rows[0].pos),
        verbLemma: rows.some(
          (row) =>
            (row.pos === "VERB" || row.pos === "AUX") &&
            lookupKey(row.lemma) === key,
        ),
        conjunction: rows.some(
          (row) => row.pos === "SCONJ" || row.pos === "CCONJ",
        ),
        verb: rows.some((row) => row.pos === "VERB" || row.pos === "AUX"),
      };
      cache.set(cacheKey, info);
    }
    return info;
  };
};

/** Entry ids of the grammar file's lines for `form` (`-го`), and no others. */
export const grammarIds = (
  db: DictionaryDb,
  form: string,
): ReadonlyArray<number> =>
  db.$client
    .query<{ id: number }, [string]>(
      `SELECT e.id AS id FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND e.source_pos = '${GRAMMAR_SOURCE_POS}' ORDER BY e.id`,
    )
    .all(form)
    .map((row) => row.id);
