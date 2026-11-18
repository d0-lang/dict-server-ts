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
  /** The form's best reading, ranked as lookups rank, is a verb (`faire`, not `dość`, whose rarest reading is one). */
  readonly verbFirst: boolean;
};

export type FormRow = {
  readonly id: number;
  readonly lemma: string;
  readonly pos: UdPos;
  /** `entries.source_pos`: wiktextract's part of speech (`prefix`, `syllable`, ...). */
  readonly sourcePos: string;
  readonly source: number;
};

/**
 * SQL that leaves out an acronym (an all-caps lemma, `e`) for a word written
 * in lowercase, when the word has another entry: `ne` is not `NE`
 * (Neuchâtel), nor `ces` `CES`, while `onu` with nothing else still finds
 * `ONU`. Capitalised lemmas stay, since people type names in lowercase.
 * `form` and `wordClass` are the query's parameters, `sources` a condition
 * on the other entry's form row `o`.
 */
export const notAnAcronym = (
  form: string,
  wordClass: string,
  sources: string,
): string =>
  `NOT (${wordClass} = ${CaseClass.Lower} AND e.case_class = ${CaseClass.AllCaps} AND EXISTS (
     SELECT 1 FROM forms o JOIN entries oe ON oe.id = o.entry_id
     WHERE o.form = ${form} AND oe.case_class <> ${CaseClass.AllCaps} AND ${sources}
   ))`;

/**
 * Most forms whose rows are kept per file. Their rows don't change while the
 * file is open, and the commonest words come back in nearly every sentence:
 * a phrase lookup asks for every word of it. Past this many, the kept rows
 * are dropped and gathered again.
 */
const KEPT_FORMS = 50_000;

const keptRows = new WeakMap<
  DictionaryDb,
  Map<string, ReadonlyArray<FormRow>>
>();

/**
 * Entries a normalized form belongs to, without the abbreviation fallback,
 * ranked like `rankedIds` in `entries.ts` for a word written as `wordClass`,
 * and like it without acronyms for a lowercase word (`notAnAcronym`). Kept
 * per file (`KEPT_FORMS`), so callers must not change the rows.
 */
export const formRows = (
  db: DictionaryDb,
  key: string,
  wordClass: CaseClass = CaseClass.Capitalised,
): ReadonlyArray<FormRow> => {
  let kept = keptRows.get(db);
  if (kept === undefined) {
    kept = new Map();
    keptRows.set(db, kept);
  }
  const keptKey = `${wordClass}\u0000${key}`;
  const found = kept.get(keptKey);
  if (found !== undefined) return found;
  if (kept.size >= KEPT_FORMS) kept.clear();
  const rows = queryFormRows(db, key, wordClass);
  kept.set(keptKey, rows);
  return rows;
};

const queryFormRows = (
  db: DictionaryDb,
  key: string,
  wordClass: CaseClass,
): ReadonlyArray<FormRow> =>
  db.$client
    .query<FormRow, [string, number]>(
      `SELECT e.id AS id, e.lemma AS lemma, e.pos AS pos, e.source_pos AS sourcePos, f.source AS source FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND f.source <> ${FormSource.Abbreviation}
         AND ${notAnAcronym("?1", "?2", `o.source <> ${FormSource.Abbreviation}`)}
       ORDER BY
         CASE
           WHEN ?2 = ${CaseClass.AllCaps} THEN e.case_class <> ${CaseClass.AllCaps}
           WHEN e.case_class = ${CaseClass.AllCaps} THEN 2
           WHEN ?2 = ${CaseClass.Lower} THEN e.case_class <> ${CaseClass.Lower}
           ELSE 0
         END,
         e.source_pos IN ('character', 'letter-name', 'syllable'),
         -- a grammar-file ending that only adds (な after a な-adjective)
         e.source_pos = '${GRAMMAR_SOURCE_POS}' AND e.pos = 'X',
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
        verbFirst: rows[0]?.pos === "VERB" || rows[0]?.pos === "AUX",
      };
      cache.set(cacheKey, info);
    }
    return info;
  };
};

/**
 * Entry ids of the grammar file's lines for `form` (`-го`), and no others:
 * the lines for that word itself, or when it has none, the lines it is
 * another spelling or a form of (`とく` finds `ておく`). `て` has a line, so
 * it is not `ている`, which Wiktionary makes it a form of by the stem of `てる`.
 */
export const grammarIds = (
  db: DictionaryDb,
  form: string,
): ReadonlyArray<number> => {
  const rows = db.$client
    .query<{ id: number; source: number }, [string]>(
      `SELECT e.id AS id, f.source AS source FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND e.source_pos = '${GRAMMAR_SOURCE_POS}' ORDER BY e.id`,
    )
    .all(form);
  const own = rows.filter((row) => row.source === FormSource.Lemma);
  return (own.length > 0 ? own : rows).map((row) => row.id);
};
