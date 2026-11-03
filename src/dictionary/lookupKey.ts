import { CaseClass } from "./schema.ts";

/** Canonical text of a word: NFC, trimmed, original case kept. */
export const cleanWord = (word: string): string => word.normalize("NFC").trim();

/**
 * The spelling a word is indexed and searched by: `cleanWord`, lowercased.
 * Diacritics are kept on purpose (Polish "łza" and "lza" are different words).
 *
 * Stored `forms` rows are built with this function, so changing it requires
 * bumping `SCHEMA_VERSION` and rebuilding every dictionary file; otherwise
 * lookups silently stop matching old rows.
 */
export const lookupKey = (word: string): string =>
  cleanWord(word).toLowerCase();

const letters = (word: string) => [...word].filter((c) => /\p{L}/u.test(c));

/**
 * `AllCaps` for two or more letters, all uppercase (`EU`, `AM`); `Lower` when
 * the first letter is lowercase; `Capitalised` otherwise, including words
 * without letters.
 */
export const caseClass = (word: string): CaseClass => {
  const ls = letters(word);
  if (
    ls.length >= 2 &&
    ls.every((c) => c !== c.toLowerCase() && c === c.toUpperCase())
  ) {
    return CaseClass.AllCaps;
  }
  const first = ls[0];
  return first !== undefined &&
    first === first.toLowerCase() &&
    first !== first.toUpperCase()
    ? CaseClass.Lower
    : CaseClass.Capitalised;
};
