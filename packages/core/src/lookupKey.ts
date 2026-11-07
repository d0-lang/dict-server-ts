import { CaseClass } from "./schema.ts";

/** Canonical text of a word: NFC, trimmed, original case kept. */
export const cleanWord = (word: string): string => word.normalize("NFC").trim();

const CYRILLIC = /\p{Script=Cyrillic}/u;
/** Combining acute and grave: stress marks in Cyrillic dictionaries. */
const STRESS = /[̀́]/gu;
/**
 * Typographic apostrophes: right and left single quotation marks and the
 * modifier letter apostrophe (U+02BC, Ukrainian's recommended one). Texts write
 * any of them where the dump writes `'` (`п’ять`, `пʼять`, `п'ять`).
 */
const APOSTROPHES = /[\u2018\u2019\u02BC]/gu;

/**
 * The spelling a word is indexed and searched by: `cleanWord`, lowercased.
 * Diacritics are kept on purpose (Polish "łza" and "lza" are different words),
 * except stress marks on Cyrillic words: Wiktionary writes Russian forms
 * stressed (`соба́ки`) and running text doesn't. `й` and `ё` keep their marks.
 * Typographic apostrophes are written as `'`.
 *
 * Stored `forms` rows are built with this function, so changing it requires
 * bumping `SCHEMA_VERSION` and rebuilding every dictionary file; otherwise
 * lookups silently stop matching old rows.
 */
export const lookupKey = (word: string): string => {
  const clean = cleanWord(word).toLowerCase().replace(APOSTROPHES, "'");
  return CYRILLIC.test(clean)
    ? clean.normalize("NFD").replace(STRESS, "").normalize("NFC").trim()
    : clean;
};

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
