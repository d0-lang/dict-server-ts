import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { lookupKey } from "@dict/core/lookupKey";
import { FormSource, PREFERRED_LETTERS_KEY } from "@dict/core/schema";

/**
 * A language written in two scripts (`import.otherScriptTags`: Chinese,
 * simplified and traditional), whose entries are stored under one and also
 * have the other as a lemma row (`學習` and `学习`). `headword.otherSpellings`
 * shows both, the text's first, and ranks entries by the text's script.
 */

const spellingsByDb = new WeakMap<
  DictionaryDb,
  ReadonlyMap<string, ReadonlyArray<string>>
>();

/**
 * The lemma's spellings stored as its lemma besides itself (`学习` of `學習`),
 * gathered once per file: entries have no index by lemma.
 */
const otherSpellings = (
  db: DictionaryDb,
  lemma: string,
): ReadonlyArray<string> => {
  let byLemma = spellingsByDb.get(db);
  if (byLemma === undefined) {
    const map = new Map<string, Array<string>>();
    const rows = db.$client
      .query<{ lemma: string; form: string }, [number]>(
        `SELECT DISTINCT e.lemma AS lemma, f.form AS form FROM forms f JOIN entries e ON e.id = f.entry_id
         WHERE f.source = ?1 AND f.form <> e.lemma ORDER BY f.form`,
      )
      .all(FormSource.Lemma);
    for (const { lemma, form } of rows) {
      if (form === lookupKey(lemma)) continue;
      map.set(lemma, [...(map.get(lemma) ?? []), form]);
    }
    byLemma = map;
    spellingsByDb.set(db, byLemma);
  }
  return byLemma.get(lemma) ?? [];
};

/**
 * The lemma with its other spellings, the one `texts` use first (the
 * entry's match, its segment, the clicked word, then the sentence), the rest
 * in brackets: `学习 (學習)` for a click in simplified text. `otherScript`:
 * whether the text spells it otherwise than the lemma, undefined when the
 * lemma has no other spelling.
 */
export const withOtherSpellings = (
  db: DictionaryDb,
  lemma: string,
  texts: ReadonlyArray<string>,
): {
  readonly lemma: string;
  readonly otherScript: boolean | undefined;
  readonly used: string;
} => {
  const others = otherSpellings(db, lemma);
  if (others.length === 0)
    return { lemma, otherScript: undefined, used: lemma };
  const spellings = [lemma, ...others];
  const used =
    texts
      .map((text) => spellings.find((spelling) => text.includes(spelling)))
      .find((spelling) => spelling !== undefined) ?? lemma;
  const rest = spellings.filter((spelling) => spelling !== used);
  return {
    lemma: `${used} (${rest.join(", ")})`,
    otherScript: used !== lemma,
    used,
  };
};

/** -1: a letter only the other script writes (`说`), 1: only the lemmas' (`說`), 0: either or neither. */
type LetterScript = -1 | 0 | 1;

const letterScripts = new WeakMap<DictionaryDb, Map<string, LetterScript>>();

const scriptOfLetter = (db: DictionaryDb, letter: string): LetterScript => {
  let known = letterScripts.get(db);
  if (known === undefined) {
    known = new Map();
    letterScripts.set(db, known);
  }
  const cached = known.get(letter);
  if (cached !== undefined) return cached;
  const rows = db.$client
    .query<{ own: number | null; other: number | null }, [string, number]>(
      `SELECT sum(e.lemma = ?1) AS own, sum(e.lemma <> ?1) AS other
       FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND f.source = ?2`,
    )
    .get(letter, FormSource.Lemma);
  const own = rows?.own ?? 0;
  const other = rows?.other ?? 0;
  const script: LetterScript =
    own === 0 && other > 0
      ? -1
      : own > 0 && other === 0 && otherSpellings(db, letter).length > 0
        ? 1
        : 0;
  known.set(letter, script);
  return script;
};

/**
 * Whether `text` is written in the other script than the lemmas (Chinese:
 * simplified): it has more letters only that script writes (`说`, `们`) than
 * letters only the lemmas' writes (`說`, `們`). A text with neither counts as
 * the other script, the one most texts use.
 */
const inOtherScript = (db: DictionaryDb, text: string): boolean => {
  let score = 0;
  for (const letter of new Set(text)) {
    if (/\p{Script=Han}/u.test(letter)) score += scriptOfLetter(db, letter);
  }
  return score <= 0;
};

const preferredByDb = new WeakMap<
  DictionaryDb,
  Readonly<Record<string, ReadonlyArray<string>>>
>();

/** The file's `PREFERRED_LETTERS_KEY`: letters of the other script to the lemma letters they mostly spell. */
const preferredLetters = (
  db: DictionaryDb,
): Readonly<Record<string, ReadonlyArray<string>>> => {
  let preferred = preferredByDb.get(db);
  if (preferred === undefined) {
    const row = db.$client
      .query<{ value: string }, [string]>(
        "SELECT value FROM meta WHERE key = ?1",
      )
      .get(PREFERRED_LETTERS_KEY);
    preferred = row === null ? {} : JSON.parse(row.value);
    preferredByDb.set(db, preferred!);
  }
  return preferred!;
};

/**
 * The order of `entries` by the text's script, within each group (a
 * segment, or the word itself). In text of the other script, the entries it
 * spells in that script come first where a word does (`后来` is `後來`) or the
 * letter mostly stands for theirs (`后` in simplified text: `後` "after"
 * before `后` "empress"), else after the entries spelled as written (`面`
 * "face" before `麵` "noodles"). In the lemmas' script, the entries spelled as
 * written come first.
 */
export const inScriptOrder = (
  db: DictionaryDb,
  text: string,
  entries: ReadonlyArray<{
    readonly group: string;
    readonly otherScript: boolean | undefined;
    /** The spelling the text uses, and the stored lemma. */
    readonly used: string;
    readonly lemma: string;
  }>,
): ReadonlyArray<number> => {
  const other = inOtherScript(db, text);
  const preferred = preferredLetters(db);
  const rank = (i: number) => {
    const { otherScript, used, lemma } = entries[i]!;
    if (otherScript !== true) return other ? 1 : 0;
    if (!other) return 2;
    return [...used].length > 1 || preferred[used]?.includes(lemma) === true
      ? 0
      : 2;
  };
  const groups = new Map<string, Array<number>>();
  entries.forEach((entry, i) => {
    groups.set(entry.group, [...(groups.get(entry.group) ?? []), i]);
  });
  const sorted = new Map(
    [...groups.values()].map((members) => [
      members,
      [...members].sort((a, b) => rank(a) - rank(b)),
    ]),
  );
  // Each group keeps the places its entries had, in its new order.
  const order: Array<number> = [];
  const next = new Map<Array<number>, number>();
  entries.forEach((entry) => {
    const members = groups.get(entry.group)!;
    const k = next.get(members) ?? 0;
    next.set(members, k + 1);
    order.push(sorted.get(members)![k]!);
  });
  return order;
};
